/// <reference path="./types/ffprobe-static.d.ts" />
import express from 'express';
import cors from 'cors';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import mime from 'mime-types';
import os from 'os';
import { execa } from 'execa';
import ffprobe from 'ffprobe-static';
import fetch from 'node-fetch';
import { cfg } from './env';
// Cloudflare tunnel (dynamic import via require to avoid TS type issues)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cloudflaredLib: any = require('cloudflared');
const cloudflaredTunnel = cloudflaredLib.tunnel as (opts?: Record<string, string|number|null>) => { url: Promise<string>; connections?: Promise<any>[]; child?: any; stop?: () => void };
const cloudflaredBin = cloudflaredLib.bin as string;
const installCloudflared = cloudflaredLib.install as (to: string, version?: string) => Promise<string>;
export let tunnelUrl: string = '';

// Tunnel retry config
const MAX_TUNNEL_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

import { Scheduler } from './scheduler';
import { FileWatcher } from './watcher';
import { Publisher } from './publisher';
import { addLog, getLogs, clearLogs } from './logger';
import { HistoryRequestSchema, KeywordsMutationRequestSchema, CaptionRequestSchema } from './types';

const app = express();

// Basic caption sanitizer to remove camera/file artifacts like IMG_1234, WA0004, date stamps
function sanitizeCaptionServer(text?: string): string {
  try {
    if (!text) return '';
    let out = String(text);
    const patterns = [
      /\b(?:img|vid|pxl|mvimg|dsc|screenshot|photo)\b/gi,
      /\b(?:img|vid|pxl|mvimg|dsc)[-_]?\d+\b/gi,
      /\bwa\d+\b/gi,
      /\b20\d{6,8}\b/gi,
    ];
    for (const re of patterns) out = out.replace(re, ' ');
    return out.replace(/\s{2,}/g, ' ').trim();
  } catch {
    return text || '';
  }
}
app.use(cors());
app.use(express.json());

// API latency metrics
const apiMetrics: Record<string, { count:number; totalMs:number; lastMs:number; lastStatus:number; samples:number[] }> = {};
const serverStartedAt = new Date();
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    const key = `${req.method} ${req.path}`;
    const st = res.statusCode;
    const rec = apiMetrics[key] || { count:0, totalMs:0, lastMs:0, lastStatus:0, samples:[] };
    rec.count += 1; rec.totalMs += ms; rec.lastMs = ms; rec.lastStatus = st;
    rec.samples.push(ms); if (rec.samples.length > 50) rec.samples.shift();
    apiMetrics[key] = rec;
  });
  next();
});

const scheduler = new Scheduler();
const watcher = new FileWatcher(scheduler);
const publisher = new Publisher(scheduler);

// Log configuration mode on startup
console.log('\n' + '='.repeat(60));
console.log('[CONFIG] Instagram Posting Mode:', cfg.mock ? 'MOCK (Test Mode)' : 'PRODUCTION (Real Posts!)');
if (!cfg.mock) {
  console.log('[CONFIG] ✅ Production mode enabled - Real Instagram API calls!');
  console.log('[CONFIG] Account:', cfg.igUserId ? `@livepilatesusa (${cfg.igUserId})` : 'Not configured');
} else {
  console.log('[CONFIG] ⚠️  Mock mode - Posts will not be published to Instagram');
}
console.log('='.repeat(60) + '\n');

// Static dashboard
const publicDir = path.resolve(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
app.use(express.static(publicDir));
// Expose inbox statically for public access via tunnel
app.use('/static', express.static(cfg.inboxPath));
// Also serve media files at /media endpoint for consistency
app.use('/media', express.static(cfg.inboxPath));

// API endpoints
app.get('/ig/status', (_req, res) => {
  res.json(scheduler.getState());
});

// Detailed health endpoint
app.get('/ig/health/detailed', async (req, res) => {
  try {
    const probe = String(req.query.probe || '0') === '1';
    const state = scheduler.getState();

    // Memory
    const mu = process.memoryUsage();
    const mem = {
      rssMB: Math.round(mu.rss/1024/1024),
      heapUsedMB: Math.round(mu.heapUsed/1024/1024),
      heapTotalMB: Math.round(mu.heapTotal/1024/1024),
      externalMB: Math.round(mu.external/1024/1024),
    };

    // Disk / FS health
    const inboxPath = cfg.inboxPath;
    const fsHealth = await checkFilesystemHealth(inboxPath);

    // Logs-based metrics
    const allLogs = require('./logger') as typeof import('./logger');
    const logs = allLogs.getAllLogs();
    const now = Date.now();
    const dayAgo = now - 24*3600*1000;
    const hourAgo = now - 3600*1000;
    let succ24 = 0, err24 = 0, err1h = 0;
    let perHour: Record<number, number> = {};
    let streak = 0; // since last publish error

    for (const l of logs) {
      const t = Date.parse(l.ts);
      const isSucc = /Successfully published/i.test(l.message) || (l.category||'') === 'SUCCESS';
      const isPubErr = /Error publishing/i.test(l.message);
      if (!isNaN(t)) {
        if (t >= dayAgo) {
          if (isSucc) succ24++;
          if (isPubErr || (l.category||'') === 'ERROR') err24++;
          const hour = new Date(t).getHours();
          perHour[hour] = (perHour[hour]||0) + (isSucc ? 1 : 0);
        }
        if (t >= hourAgo && (isPubErr || (l.category||'') === 'ERROR')) err1h++;
      }
    }
    // Compute streak from tail
    for (let i = logs.length - 1; i >= 0; i--) {
      const l = logs[i];
      if (/Error publishing/i.test(l.message) || (l.category||'') === 'ERROR') break;
      if (/Successfully published/i.test(l.message) || (l.category||'') === 'SUCCESS') streak++;
    }
    const total24 = succ24 + err24;
    const successRate24 = total24 ? Math.round((succ24/total24)*100) : 0;
    const postsPerHour = Math.round((succ24/24) * 10) / 10;

    // API metrics summary (avg of last 50)
    const perf = Object.entries(apiMetrics).map(([k,v]) => ({
      route: k,
      count: v.count,
      avgMs: Math.round((v.totalMs / Math.max(1,v.count)) * 10)/10,
      lastMs: v.lastMs,
      lastStatus: v.lastStatus,
      p95Ms: percentile(v.samples, 0.95),
    })).sort((a,b)=> b.count - a.count).slice(0, 20);

    // IG connectivity
    let ig_api = { status: cfg.mock ? 'SKIPPED' : (!cfg.fbToken ? 'NO_TOKEN' : (probe ? 'UNKNOWN' : 'NOT_PROBED')) } as any;
    if (!cfg.mock && cfg.fbToken && probe) {
      try {
        const r = await fetch(`https://graph.facebook.com/v20.0/me?access_token=${encodeURIComponent(cfg.fbToken)}`);
        ig_api = { status: r.ok ? 'OK' : 'ERROR', statusCode: r.status };
      } catch (e:any) {
        ig_api = { status: 'ERROR', error: String(e?.message||e) };
      }
    }

    // Alerts
    const alerts: { severity:'CRITICAL'|'WARNING'; code:string; message:string }[] = [];
    if (state.counts.QUEUED > 100) alerts.push({ severity:'CRITICAL', code:'QUEUE_BACKLOG', message:`Queue backlog ${state.counts.QUEUED}` });
    else if (state.counts.QUEUED > 20) alerts.push({ severity:'WARNING', code:'QUEUE_GROWING', message:`Queue size ${state.counts.QUEUED}` });
    if (successRate24 < 50 && total24 >= 10) alerts.push({ severity:'WARNING', code:'LOW_SUCCESS_RATE', message:`Success rate ${successRate24}% (24h)` });
    if (err1h >= 5) alerts.push({ severity:'WARNING', code:'ERROR_SPIKE', message:`${err1h} errors in last hour` });
    if (fsHealth.disk && typeof fsHealth.disk.freeMB === 'number' && fsHealth.disk.freeMB < 1024) alerts.push({ severity:'CRITICAL', code:'LOW_DISK', message:`Low disk free ${Math.round(fsHealth.disk.freeMB)}MB` });
    if (!fsHealth.writable) alerts.push({ severity:'CRITICAL', code:'INBOX_NOT_WRITABLE', message:'Inbox is not writable' });
    if (ig_api.status === 'ERROR') alerts.push({ severity:'WARNING', code:'IG_API', message:'Instagram API connectivity error' });

    res.json({
      server: {
        startedAt: serverStartedAt.toISOString(),
        uptimeSec: Math.floor((Date.now() - serverStartedAt.getTime())/1000),
        mock: cfg.mock,
        node: process.version,
        platform: os.platform(),
      },
      scheduler: {
        autorun: state.autorun,
        counts: state.counts,
        lastPlanRun: state.lastPlanRun,
      },
      memory: mem,
      fs: fsHealth,
      logs: {
        success24h: succ24,
        errors24h: err24,
        successRate24h: successRate24,
        postsPerHour,
        postingStreak: streak,
      },
      performance: perf,
      ig_api,
      alerts,
      tunnel: { url: tunnelUrl, active: !!tunnelUrl },
    });
  } catch (e:any) {
    res.status(500).json({ error:'server_error', message: String(e?.message||e) });
  }
});

app.get('/ig/logs', (req, res) => {
  const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || '200'), 10) || 200));
  // Optional server-side filter by q
  const q = String(req.query.q || '').toLowerCase();
  const base = getLogs(limit);
  const filtered = q ? base.filter(l => (l.message||'').toLowerCase().includes(q) || JSON.stringify(l.data||{}).toLowerCase().includes(q)) : base;
  res.json(filtered);
});

app.get('/ig/logs/export', (_req, res) => {
  try {
    const all = require('./logger') as typeof import('./logger');
    const data = all.getAllLogs();
    const fname = `activity-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.end(JSON.stringify(data, null, 2));
  } catch (e:any) {
    res.status(500).json({ error:'server_error' });
  }
});

app.post('/ig/logs/clear', (_req, res) => {
  clearLogs();
  addLog('info', '[API] Logs cleared');
  res.json({ success: true });
});

app.post('/ig/autorun', (req, res) => {
  const { enabled } = req.body as { enabled: boolean };
  scheduler.setAutorun(Boolean(enabled));
  res.json({ success: true, autorun: Boolean(enabled) });
});

app.post('/ig/plan', (_req, res) => {
  scheduler.planPosts();
  res.json({ success: true, message: 'Posts planned' });
});

// Scheduling config endpoints
app.get('/ig/schedule-config', (_req, res) => {
  const c = scheduler.getConfig();
  res.json({ ...c, autoRepostEnabled: !!(c as any).autoRepostEnabled });
});

app.post('/ig/schedule-config', (req, res) => {
  const body = req.body as any;
  scheduler.setConfig(body || {});
  addLog('info', '[API] Schedule config updated', body);
  res.json({ success: true, config: scheduler.getConfig() });
});

// Manual repost endpoint
app.post('/ig/repost/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success:false, error:'invalid_id' });
    const newPost = scheduler.scheduleRepostFromId(id, 'manual');
    if (!newPost) return res.status(400).json({ success:false, error:'repost_not_allowed' });
    // schedule
    scheduler.planPosts();
    res.json({ success:true, newPostId: newPost.id });
  } catch (e:any) {
    res.status(500).json({ success:false, error:'server_error' });
  }
});

app.get('/ig/schedule-preview', (req, res) => {
  const raw = parseInt(String(req.query.count || '20'), 10);
  const count = Math.max(1, Math.min(365, isNaN(raw) ? 20 : raw));
  const t0 = Date.now();
  const times = scheduler.preview(new Date(), count).map(d => d.toISOString());
  const dur = Date.now() - t0;
  if (count > 100) addLog('info', `[SCHED] preview count=${count} took ${dur}ms`);
  res.json(times);
});

// Force a specific post to publish ASAP
app.post('/ig/post-now', (req, res) => {
  try {
    const { id, filename, caption, postType, platforms } = req.body as { 
      id?: string; 
      filename?: string; 
      caption?: string;
      postType?: 'POST' | 'STORY' | 'REEL';
      platforms?: any;
    };
    const state = scheduler.getState();
    let post = state.posts.find(p => (id && p.id === id) || (filename && p.filename === filename));
    
    // Validate post type and media compatibility
    const type = postType || 'POST';
    const isVideo = filename?.match(/\.(mp4|mov|avi|webm)$/i);
    
    if (type === 'REEL' && !isVideo) {
      return res.status(400).json({ success: false, error: 'Reels require video content' });
    }
    
    // If no existing post, create one
    if (!post && filename) {
      post = scheduler.queueFile(filename, platforms ? ({ platforms } as any) : undefined);
      if (caption) {
        scheduler.updatePost(post.id, { caption });
      }
    }
    
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    
    // Store post type in caption as a marker (temporary solution)
    // In production, you'd extend the Post type to include postType
    const typeMarker = type !== 'POST' ? `[${type}] ` : '';
    if (caption && !caption.startsWith('[')) {
      const clean = sanitizeCaptionServer(caption);
      scheduler.updatePost(post.id, { caption: typeMarker + clean });
    }
    
    // For videos, ensure we use tunnel URL if available
    if (tunnelUrl && post.filename.match(/\.(mp4|mov|avi|webm)$/i)) {
      const videoUrl = `${tunnelUrl}/media/${encodeURIComponent(post.filename)}`;
      scheduler.updatePost(post.id, { image_url: videoUrl });
      addLog('info', `[VIDEO] Using tunnel URL for video: ${videoUrl}`);
    }
    
    // Move to immediate publish window
    const patch: any = { status: 'SCHEDULED', scheduled_at: new Date(Date.now() - 1000) };
    if (platforms) patch.platforms = platforms;
    scheduler.updatePost(post.id, patch);
    addLog('info', `[API] ${type} Now requested for ${post.filename}`);
    publisher.kick().catch(() => {});
    res.json({ success: true, postType: type });
  } catch (e: any) {
    res.status(500).json({ success: false, error: String(e?.message || e) });
  }
});

// Schedule a post for a specific date/time
app.post('/ig/schedule-post', (req, res) => {
  try {
    const { filename, caption, scheduled_at, platforms } = req.body as { 
      filename: string; 
      caption?: string; 
      scheduled_at: string;
      platforms?: any;
    };
    
    if (!filename || !scheduled_at) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    const scheduledDate = new Date(scheduled_at);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date' });
    }
    
    // Create or find post
    const state = scheduler.getState();
    let post = state.posts.find(p => p.filename === filename && p.status === 'QUEUED');
    
    if (!post) {
      post = scheduler.queueFile(filename);
    }
    
    // Update with schedule info
    const patch: any = {
      caption: sanitizeCaptionServer(caption || post.caption),
      scheduled_at: scheduledDate,
      status: 'SCHEDULED'
    };
    if (platforms) patch.platforms = platforms;
    scheduler.updatePost(post.id, patch);
    
    // For videos, ensure we use tunnel URL if available
    if (tunnelUrl && post.filename.match(/\.(mp4|mov|avi|webm)$/i)) {
      const videoUrl = `${tunnelUrl}/media/${encodeURIComponent(post.filename)}`;
      scheduler.updatePost(post.id, { image_url: videoUrl });
    }
    
    addLog('info', `[SCHEDULE] Post scheduled for ${scheduledDate.toISOString()}`, { filename });
    res.json({ 
      success: true, 
      post: {
        id: post.id,
        filename: post.filename,
        scheduled_at: scheduledDate.toISOString(),
        status: 'SCHEDULED'
      }
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: String(e?.message || e) });
  }
});

// Upload endpoint (drag-and-drop)
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, cfg.inboxPath),
    filename: (_req, file, cb) => cb(null, file.originalname),
  }),
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowedTypes = [
      'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
      'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      addLog('warn', `[UPLOAD] Rejected file type: ${file.mimetype} for ${file.originalname}`);
      cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 }, // up to 100MB for videos
});

app.post('/ig/upload', upload.single('file'), async (req, res) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ success: false, error: 'Missing file' });

  const ext = String(path.extname(file.originalname || '')).toLowerCase();
  const fullPath = path.join(cfg.inboxPath, path.basename(file.originalname));
  const libraryOnly = req.query.library === 'true'; // Flag for library-only uploads
  
// Check autopilot mode for auto-assignment
  if (autopilotConfig.enabled && !libraryOnly && availableSlots.length > 0) {
    // Find next available slot that respects daily limit
    const state = scheduler.getState();
    let nextSlot: string | undefined;
    
    for (let i = 0; i < availableSlots.length; i++) {
      const slot = availableSlots[i];
      const slotDate = new Date(slot);
      const slotDayStr = slotDate.toISOString().split('T')[0];
      
      // Count posts already scheduled for this day
      const postsOnDay = state.posts.filter(p => {
        const postDate = p.scheduled_at || p.published_at;
        if (!postDate) return false;
        const postDayStr = postDate.toISOString().split('T')[0];
        return postDayStr === slotDayStr;
      }).length;
      
      // Check if we haven't exceeded the daily limit
      if (postsOnDay < autopilotConfig.postsPerDay) {
        nextSlot = availableSlots.splice(i, 1)[0];
        break;
      }
    }
    
    // Prefer caption drafts over legacy captionPool
    const nextDraft = captionDrafts.find(d => d.status === 'draft');
    
    if (nextSlot && nextDraft) {
      // Mark draft as assigned
      nextDraft.status = 'assigned';
      nextDraft.assignedAt = new Date();
      saveDraftsToFile();
      
      // Create and schedule the post with autopilot flag & draft caption
      const post = scheduler.queueFile(file.originalname, { caption: sanitizeCaptionServer(nextDraft.text), draftId: nextDraft.id });
      scheduler.updatePost(post.id, {
        scheduled_at: new Date(nextSlot),
        status: 'SCHEDULED',
        isAutopilot: true,
        autopilotBatch: Date.now()
      } as any);
      
      // For videos, ensure we use tunnel URL if available
      if (tunnelUrl && file.originalname.match(/\.(mp4|mov|avi|webm)$/i)) {
        const videoUrl = `${tunnelUrl}/media/${encodeURIComponent(file.originalname)}`;
        scheduler.updatePost(post.id, { image_url: videoUrl });
      }
      
      addLog('info', `[AUTOPILOT] Auto-scheduled ${file.originalname} for ${nextSlot} using draft ${nextDraft.id}`);
      
      return res.json({
        success: true,
        filename: file.originalname,
        autoScheduled: true,
        scheduledFor: nextSlot,
        caption: nextDraft.text.slice(0, 50) + '...',
        draftId: nextDraft.id
      });
    }

    if (nextSlot && !nextDraft) {
      addLog('warn', '[AUTOPILOT] No caption drafts available. Upload stored to library only.');
      return res.json({ success: true, filename: file.originalname, autoScheduled: false, reason: 'no_drafts_available' });
    }
  }
  
  let videoInfo = null;
  if (file.mimetype && file.mimetype.startsWith('video/')) {
    try {
      const meta = await probeVideo(fullPath);
      if (!meta || isNaN(meta.durationSec)) {
        try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch {}
        return res.status(400).json({ success:false, error:'video_metadata_unreadable' });
      }
      
      // Only enforce duration limits for posting, not library storage
      if (!libraryOnly && (meta.durationSec < 3 || meta.durationSec > 60)) {
        try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch {}
        return res.status(400).json({ success:false, error:'invalid_duration', durationSec: meta.durationSec });
      }
      
      const sizeMB = Math.round((file.size/1024/1024)*10)/10;
      videoInfo = {
        duration: Math.round(meta.durationSec),
        width: meta.width,
        height: meta.height,
        sizeMB
      };
      
      addLog('info', `[VIDEO] Processed ${file.originalname} (${Math.round(meta.durationSec)}s, ${meta.width}x${meta.height}, ${sizeMB}MB)`);
      
      // Aspect ratio warn if outside IG limits: 4:5 (0.8) to 1.91:1 (1.91)
      const ratio = meta.width && meta.height ? meta.width / meta.height : 0;
      if (ratio && (ratio < 0.8 || ratio > 1.91)) {
        addLog('warn', `[VIDEO] Aspect ratio non-standard for IG: ${meta.width}x${meta.height} (ratio=${ratio.toFixed(3)})`);
      }
    } catch (e:any) {
      try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch {}
      return res.status(400).json({ success:false, error:'video_probe_failed', message:String(e?.message||e) });
    }
  }

  addLog('info', `[UPLOAD] File uploaded: ${file.originalname}${libraryOnly ? ' (library only)' : ''}`);
  res.json({ 
    success: true, 
    filename: file.originalname,
    isVideo: file.mimetype?.startsWith('video/') || false,
    videoInfo,
    libraryOnly 
  });
});

// Delete a post and its media file
app.delete('/ig/posts/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success:false, error:'invalid_id' });
    const state = scheduler.getState();
    const post = state.posts.find(p => p.id === id);
    if (!post) return res.status(404).json({ success:false, error:'not_found' });
    if (!(post.status === 'QUEUED' || post.status === 'SCHEDULED' || post.status === 'ERROR')) {
      return res.status(400).json({ success:false, error:'cannot_delete_in_this_state' });
    }

    // path traversal protection: only allow basename
    const fileName = path.basename(post.filename);
    const fullPath = path.join(cfg.inboxPath, fileName);

    // Remove from memory
    const removed = scheduler.removePost(id);
    if (!removed) return res.status(500).json({ success:false, error:'remove_failed' });

    // Try to delete the file (ignore if missing)
    try {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch (e:any) {
      addLog('error', '[REMOVE] File delete failed', { id, filename: fileName, error: String(e?.message||e) });
      // proceed; we still removed the post entry
    }

    addLog('info', `[REMOVE] Deleted ${id} ${fileName}`);

    const counts = scheduler.getState().counts;
    res.json({ success:true, counts });
  } catch (e:any) {
    res.status(500).json({ success:false, error:'server_error' });
  }
});

// Reschedule a single post
app.put('/ig/posts/:id/reschedule', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const { scheduled_at } = req.body as { scheduled_at: string };
    
    if (!id) return res.status(400).json({ success:false, error:'invalid_id' });
    if (!scheduled_at) return res.status(400).json({ success:false, error:'missing_scheduled_at' });
    
    const newDate = new Date(scheduled_at);
    if (isNaN(newDate.getTime())) return res.status(400).json({ success:false, error:'invalid_date' });
    
    const state = scheduler.getState();
    const post = state.posts.find(p => p.id === id);
    if (!post) return res.status(404).json({ success:false, error:'not_found' });
    if (post.status !== 'SCHEDULED') return res.status(400).json({ success:false, error:'can_only_reschedule_scheduled_posts' });
    
    scheduler.updatePost(id, { scheduled_at: newDate });
    addLog('info', `[RESCHEDULE] Post ${id} rescheduled to ${newDate.toISOString()}`);
    
    res.json({ success:true, scheduled_at: newDate.toISOString() });
  } catch (e:any) {
    res.status(500).json({ success:false, error:'server_error' });
  }
});

// Batch reschedule multiple posts
app.put('/ig/posts/batch-reschedule', (req, res) => {
  try {
    const { updates } = req.body as { updates: Array<{ id: string; scheduled_at: string }> };
    
    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({ success:false, error:'invalid_updates' });
    }
    
    const state = scheduler.getState();
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    
    for (const update of updates) {
      const { id, scheduled_at } = update;
      if (!id || !scheduled_at) {
        results.push({ id: id || 'unknown', success: false, error: 'missing_data' });
        continue;
      }
      
      const newDate = new Date(scheduled_at);
      if (isNaN(newDate.getTime())) {
        results.push({ id, success: false, error: 'invalid_date' });
        continue;
      }
      
      const post = state.posts.find(p => p.id === id);
      if (!post) {
        results.push({ id, success: false, error: 'not_found' });
        continue;
      }
      
      if (post.status !== 'SCHEDULED') {
        results.push({ id, success: false, error: 'wrong_status' });
        continue;
      }
      
      scheduler.updatePost(id, { scheduled_at: newDate });
      results.push({ id, success: true });
    }
    
    const successCount = results.filter(r => r.success).length;
    addLog('info', `[BATCH_RESCHEDULE] Updated ${successCount}/${updates.length} posts`);
    
    res.json({ success:true, results, updated: successCount });
  } catch (e:any) {
    res.status(500).json({ success:false, error:'server_error' });
  }
});

// Simple media listing
app.get('/media', (_req, res) => {
  try {
    const files = fs.readdirSync(cfg.inboxPath).filter(f => !f.startsWith('.'));
    const rows = files.map(f => `<li><a href="/media/${encodeURIComponent(f)}" target="_blank">${f}</a></li>`).join('');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><body><h3>Inbox media</h3><ul>${rows}</ul></body></html>`);
  } catch {
    res.status(500).end('Error');
  }
});

// Serve inbox images directly for thumbnails and local viewing
app.get('/media/:filename', (req, res) => {
  try {
    const name = path.basename(String(req.params.filename || ''));
    const filePath = path.join(cfg.inboxPath, name);
    if (!fs.existsSync(filePath)) return res.status(404).end('Not Found');
    const ct = mime.lookup(filePath) || 'application/octet-stream';
    res.setHeader('Content-Type', String(ct));
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).end('Error');
  }
});

// Delete media file
app.delete('/ig/media/:filename', (req, res) => {
  try {
    const name = path.basename(String(req.params.filename || ''));
    const filePath = path.join(cfg.inboxPath, name);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    
    // Remove file from filesystem
    fs.unlinkSync(filePath);
    
    // Also remove any scheduled posts that use this media
    const state = scheduler.getState();
    const postsToRemove = state.posts.filter(p => p.filename === name && p.status === 'SCHEDULED');
    
    postsToRemove.forEach(post => {
      scheduler.removePost(post.id);
      addLog('info', `[DELETE] Removed scheduled post ${post.id} using deleted media ${name}`);
    });
    
    addLog('info', `[DELETE] Media file deleted: ${name}`);
    res.json({ success: true, message: 'Media deleted successfully' });
    
  } catch (e: any) {
    addLog('error', `[DELETE] Failed to delete media: ${e?.message || e}`);
    res.status(500).json({ success: false, error: 'Failed to delete file' });
  }
});

// Get video metadata including duration
app.get('/ig/video-info/:filename', async (req, res) => {
  try {
    const name = path.basename(String(req.params.filename || ''));
    const filePath = path.join(cfg.inboxPath, name);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const mimeType = mime.lookup(filePath) || '';
    if (!mimeType.startsWith('video/')) {
      return res.status(400).json({ error: 'Not a video file' });
    }
    
    try {
      const meta = await probeVideo(filePath);
      res.json({
        success: true,
        filename: name,
        duration: meta.durationSec,
        width: meta.width,
        height: meta.height,
        aspectRatio: meta.width && meta.height ? meta.width / meta.height : 0
      });
    } catch (e: any) {
      res.json({
        success: true,
        filename: name,
        duration: 0,
        width: 0,
        height: 0,
        aspectRatio: 0,
        error: 'Could not probe video'
      });
    }
  } catch (e: any) {
    res.status(500).json({ error: 'server_error', message: String(e?.message || e) });
  }
});

// Keywords management endpoints
app.get('/ig/keywords', (_req, res) => {
  try {
    const { listKeywords } = require('./keywords') as typeof import('./keywords');
    res.json({ categories: listKeywords() });
  } catch (e:any) {
    res.status(500).json({ error:'server_error' });
  }
});

app.post('/ig/keywords', (req, res) => {
  try {
    const parsed = KeywordsMutationRequestSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error:'bad_request' });
    const { category, action, keyword } = parsed.data;
    const kw = require('./keywords') as typeof import('./keywords');
    const result = action === 'add' ? kw.addKeyword(category, keyword) : kw.removeKeyword(category, keyword);
    if (!result.ok) return res.status(400).json({ error: result.error || 'failed' });
    res.json({ success:true, categories: kw.listKeywords() });
  } catch (e:any) {
    res.status(500).json({ error:'server_error' });
  }
});

// Caption generation endpoint
app.post('/ig/caption', (req, res) => {
  try {
    const parsed = CaptionRequestSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error:'bad_request' });
    const { filename, mediaType, keywords } = parsed.data;
    const { generateSmartCaption } = require('./caption') as typeof import('./caption');
    const out = generateSmartCaption(filename, mediaType as any, keywords || []);
    res.json(out);
  } catch (e:any) {
    res.status(500).json({ error:'server_error' });
  }
});

// AI Magic Writer endpoint for manual post creation
app.post('/ig/magic-writer', (req, res) => {
  try {
    const { description, tone = 'medium', keywords = [] } = req.body as {
      description: string;
      tone: 'short' | 'medium' | 'long';
      keywords?: string[];
    };
    
    if (!description || description.trim().length < 10) {
      return res.status(400).json({ error: 'Description too short' });
    }
    
    // Generate AI caption based on user description
    const baseCaption = `Welcome to the world of cutting-edge Pilates innovation at Live Pilates USA! 🌟 `;
    
    // Build caption based on tone
    let caption = '';
    
    if (tone === 'short') {
      caption = baseCaption + description.slice(0, 100) + '\n\n';
      caption += '💪 #LivePilatesUSA #PilatesInnovation';
    } else if (tone === 'long') {
      caption = baseCaption + '\n\n';
      caption += `Our ${description} is designed to take your fitness game to the next level. 🚀 `;
      caption += `Step up your Pilates routine with our expertly engineered machines that blend technology with tradition for maximum quality and performance. 🌟 `;
      caption += `Whether you're a studio owner, fitness pro, or just a Pilates lover, we've got the perfect reformer machine for you! 💪\n\n`;
      caption += '#LivePilatesUSA #PilatesInnovation #FitnessJourney #PilatesLife #StudioEquipment';
    } else { // medium
      caption = baseCaption + '\n';
      caption += `🌟 Our ${description} is designed to take your fitness game to the next level. `;
      caption += `Step up your Pilates routine with our expertly engineered machines that blend technology with tradition for maximum quality and performance. 🌟\n\n`;
      caption += '#LivePilatesUSA #PilatesInnovation #FitnessJourney';
    }
    
    // Add any additional keywords
    if (keywords.length > 0) {
      caption += ' ' + keywords.map(k => `#${k.replace(/\s+/g, '')}`).join(' ');
    }
    
    addLog('info', `[MAGIC] Generated caption for: ${description.slice(0, 50)}...`);
    
    res.json({
      success: true,
      caption,
      length: caption.length,
      hashtags: (caption.match(/#\w+/g) || []).length
    });
  } catch (e: any) {
    res.status(500).json({ error: 'server_error', message: e?.message || e });
  }
});

// Autopilot system state
let autopilotConfig = {
  enabled: false,
  postsPerDay: 3,
  times: ['10:00', '14:00', '18:00'],
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  captionStyle: 'medium',
  captionCount: 100
};

let captionPool: Array<{ id: number; text: string; used: boolean }> = [];
let availableSlots: string[] = [];

// Caption Drafts System
export const captionDrafts: Array<{
  id: string;
  text: string;
  style: 'short' | 'medium' | 'long';
  status: 'draft' | 'assigned' | 'used';
  createdAt: Date;
  assignedAt?: Date;
  assignedToPost?: string;
}> = [];

const DRAFTS_FILE = path.join(__dirname, '../data/drafts.json');

// Drafts API

// Scrape URL for text extraction (basic)
// Enhanced scraping with product/service detection and feature extraction
app.post('/ig/scrape-url', async (req, res) => {
  const url = String((req.body||{}).url||'').trim();
  try {
    if (!url) return res.json({ content: {}, rawText: '' });
    const response = await fetch(url).catch(()=>null);
    if (!response || !response.ok) return res.json({ content: {}, rawText: '' });
    const html = await response.text();

    // Try dynamic cheerio import if present; fall back to regex parsing
    let extracted: any = { title:'', products:[], services:[], prices:[], features:[] };
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cheerio = require('cheerio');
      const $ = cheerio.load(html);
      extracted.title = $('h1').first().text() || $('title').text() || '';
      $('h2, h3, .product-name, .service-title').each((_: number, el: any) => {
        const t = ($(el).text()||'').trim(); if (t) extracted.products.push(t);
      });
      $('.price, .cost, [class*="price"]').each((_: number, el: any) => {
        const t = ($(el).text()||'').trim(); if (t) extracted.prices.push(t);
      });
      $('ul li, .feature, .benefit').each((_: number, el: any) => {
        const t = ($(el).text()||'').trim(); if (t) extracted.features.push(t);
      });
    } catch {
      // Lightweight fallback: pull headings and list items
      const safe = String(html).replace(/\s+/g,' ');
      const h1 = /<h1[^>]*>(.*?)<\/h1>/i.exec(safe)?.[1] || '';
      const h2s = Array.from(safe.matchAll(/<h2[^>]*>(.*?)<\/h2>/gi)).map(m=>m[1]);
      const h3s = Array.from(safe.matchAll(/<h3[^>]*>(.*?)<\/h3>/gi)).map(m=>m[1]);
      const lis = Array.from(safe.matchAll(/<li[^>]*>(.*?)<\/li>/gi)).map(m=>m[1]);
      const prices = Array.from(safe.matchAll(/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g)).map(m=>m[0]);
      extracted = {
        title: h1,
        products: [...h2s, ...h3s].slice(0, 10).map(s => s.replace(/<[^>]+>/g,'').trim()).filter(Boolean),
        services: [],
        prices,
        features: lis.slice(0, 20).map(s => s.replace(/<[^>]+>/g,'').trim()).filter(Boolean)
      };
    }

    const rawText = String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);

    res.json({ content: extracted, rawText });
  } catch (error) {
    res.json({ content: {}, rawText: '' });
  }
});
app.post('/ig/generate-drafts', async (req, res) => {
  try {
    const body = req.body as { count?: number; style?: 'short'|'medium'|'long'; keywords?: string[]; urlContent?: string; urlData?: any };
    const count = Math.max(1, Math.min(500, parseInt(String(body.count || 10), 10)));
    const style = (body.style === 'short' || body.style === 'medium' || body.style === 'long') ? body.style : 'medium';
    let keywords = Array.isArray(body.keywords) ? body.keywords : [];

    // Build urlContent from urlData if provided
    let urlContent = body.urlContent || '';
    const urlData = body.urlData || null;
    if (!urlContent && urlData && urlData.content) {
      try {
        const c = urlData.content;
        const parts: string[] = [];
        if (c.title) parts.push(String(c.title));
        if (Array.isArray(c.products)) parts.push(c.products.slice(0,10).join(' '));
        if (Array.isArray(c.services)) parts.push(c.services.slice(0,10).join(' '));
        if (Array.isArray(c.features)) parts.push(c.features.slice(0,20).join(' '));
        urlContent = parts.join(' \n ').slice(0, 2000);
        // Expand keywords with product-derived tags
        const productTags = (c.products||[]).slice(0,10).map((p:string)=> p.replace(/[^a-z0-9 ]/gi,'').trim()).filter(Boolean).map((p:string)=> p.split(/\s+/).slice(0,3).join(''));
        keywords = [...keywords, ...productTags];
      } catch {}
    }

    const { generateBatchCaptions } = require('./caption') as typeof import('./caption');
    const batch = generateBatchCaptions(count, style, keywords, urlContent || undefined);

    const now = Date.now();
    const drafts = batch.map((c, i) => ({
      id: `draft_${now}_${i}`,
      text: c.caption,
      style,
      status: 'draft' as const,
      createdAt: new Date()
    }));

    captionDrafts.push(...drafts);
    saveDraftsToFile();
    addLog('info', `[DRAFTS] Generated ${drafts.length} drafts`, { style, count });
    res.json({ success: true, count: drafts.length });
  } catch (e:any) {
    res.status(500).json({ success:false, error:'server_error', message: String(e?.message||e) });
  }
});

app.get('/ig/caption-drafts', (_req, res) => {
  try {
    const only = String((_req.query as any).status || 'draft');
    const list = only === 'all' ? captionDrafts : captionDrafts.filter(d => d.status === 'draft');
    res.json({ success:true, drafts: list });
  } catch (e:any) {
    res.status(500).json({ success:false, error:'server_error' });
  }
});

app.put('/ig/caption-drafts/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    const text = String((req.body as any).text || '').trim();
    if (!id || !text) return res.status(400).json({ success:false, error:'invalid_input' });
    const d = captionDrafts.find(x => x.id === id);
    if (!d) return res.status(404).json({ success:false, error:'not_found' });
    d.text = text;
    saveDraftsToFile();
    addLog('info', `[DRAFTS] Edited ${id}`);
    res.json({ success:true });
  } catch (e:any) {
    res.status(500).json({ success:false, error:'server_error' });
  }
});

app.delete('/ig/caption-drafts/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    const idx = captionDrafts.findIndex(x => x.id === id);
    if (idx === -1) return res.status(404).json({ success:false, error:'not_found' });
    captionDrafts.splice(idx, 1);
    saveDraftsToFile();
    addLog('info', `[DRAFTS] Deleted ${id}`);
    res.json({ success:true });
  } catch (e:any) {
    res.status(500).json({ success:false, error:'server_error' });
  }
});

app.post('/ig/caption-drafts/:id/assign', (req, res) => {
  try {
    const id = String(req.params.id || '');
    const postId = String((req.body as any).postId || '');
    const d = captionDrafts.find(x => x.id === id && x.status === 'draft');
    if (!d) return res.status(404).json({ success:false, error:'not_found_or_not_draft' });
    d.status = 'assigned';
    d.assignedAt = new Date();
    d.assignedToPost = postId || undefined;
    saveDraftsToFile();
    addLog('info', `[DRAFTS] Assigned ${id}`, { postId });
    res.json({ success:true });
  } catch (e:any) {
    res.status(500).json({ success:false, error:'server_error' });
  }
});

app.post('/ig/caption-drafts/:id/mark-used', (req, res) => {
  try {
    const id = String(req.params.id || '');
    const d = captionDrafts.find(x => x.id === id);
    if (!d) return res.status(404).json({ success:false, error:'not_found' });
    d.status = 'used';
    saveDraftsToFile();
    addLog('info', `[DRAFTS] Marked used ${id}`, undefined, 'SUCCESS');
    res.json({ success:true });
  } catch (e:any) {
    res.status(500).json({ success:false, error:'server_error' });
  }
});

// Queue existing media with a selected draft
app.post('/ig/queue-with-draft', (req, res) => {
  try {
    const body = req.body as { filename?: string; draftId?: string; schedule_at?: string; force?: boolean };
    const filename = path.basename(String(body.filename || ''));
    const draftId = String(body.draftId || '');
    const force = Boolean((body as any).force);
    if (!filename || !draftId) return res.status(400).json({ success:false, error:'missing_params' });

    // Validate media file exists in inbox
    const fullPath = path.join(cfg.inboxPath, filename);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ success:false, error:'media_not_found' });

    // Find draft
    const d = captionDrafts.find(x => x.id === draftId);
    if (!d) return res.status(404).json({ success:false, error:'draft_not_found' });
    if (d.status === 'used') return res.status(400).json({ success:false, error:'draft_already_used' });

    // If already assigned, allow idempotent reuse or reassignment
    if (d.status === 'assigned' && d.assignedToPost) {
      const state = scheduler.getState();
      const prev = state.posts.find((p: any) => p.id === d.assignedToPost);
      if (prev) {
        // If same filename, treat as success (idempotent)
        if (prev.filename === filename) {
          addLog('info', `[DRAFTS] Reused pairing ${d.id} -> ${filename}`, { postId: prev.id });
          return res.json({ success:true, postId: prev.id, status: prev.status, scheduled_at: prev.scheduled_at?.toISOString() });
        }
        // Otherwise, reassign if allowed or forced (avoid when already publishing)
        const publishing = prev.status === 'PUBLISHING' || prev.status === 'PUBLISHED';
        if (!publishing) {
          // Compute new media URL
          const encoded = encodeURIComponent(filename);
          const localThumbUrl = `http://localhost:${cfg.port}/media/${encoded}`;
          const igUrl = (!cfg.mock && cfg.publicBaseUrl) ? `${cfg.publicBaseUrl}/${encoded}` : localThumbUrl;
          // Update existing post in place
          const patch: any = { filename, image_url: igUrl, caption: d.text };
          (patch as any).draftId = d.id;
          scheduler.updatePost(prev.id, patch as any);
          d.assignedAt = new Date();
          d.assignedToPost = prev.id;
          d.status = 'assigned';
          saveDraftsToFile();
          addLog('info', `[DRAFTS] Reassigned draft ${d.id} from ${prev.filename} -> ${filename}`, { postId: prev.id });
          return res.json({ success:true, postId: prev.id, status: prev.status, scheduled_at: prev.scheduled_at?.toISOString(), reassigned:true });
        }
        if (!force) {
          // Publishing or published and not forced
          return res.status(400).json({ success:false, error:'draft_already_assigned' });
        }
        // Forced path: create a new post and leave the previous intact
      }
    }

    // Create or fetch queued post
    const scheduleAt = body.schedule_at ? new Date(body.schedule_at) : null;
    const post = scheduler.queueFile(filename, { caption: d.text, draftId: d.id, status: scheduleAt ? 'SCHEDULED' : 'QUEUED', scheduled_at: scheduleAt || undefined } as any);

    // Ensure caption and draftId are attached even if queueFile returned an existing post
    const attach: any = { caption: d.text };
    (attach as any).draftId = d.id;
    scheduler.updatePost(post.id, attach);

    // Mark draft assigned now; it will be marked used on publish
    d.status = 'assigned';
    d.assignedAt = new Date();
    d.assignedToPost = post.id;
    saveDraftsToFile();

    const msg = `[DRAFTS] Paired draft ${d.id} with media ${filename}${scheduleAt ? ' (scheduled)' : ''}`;
    addLog('info', msg, { filename, draftId: d.id });

    res.json({ success:true, postId: post.id, status: post.status, scheduled_at: post.scheduled_at?.toISOString() });
  } catch (e:any) {
    res.status(500).json({ success:false, error:'server_error', message: String(e?.message||e) });
  }
});

// Drafts persistence functions
export function saveDraftsToFile() {
  try {
    const dataDir = path.dirname(DRAFTS_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(DRAFTS_FILE, JSON.stringify(captionDrafts, null, 2), 'utf-8');
  } catch (e: any) {
    console.error('[DRAFTS] Failed to save:', e?.message || e);
  }
}

function loadDrafts() {
  try {
    if (fs.existsSync(DRAFTS_FILE)) {
      const data = fs.readFileSync(DRAFTS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        const items = parsed.map((draft: any) => ({
          ...draft,
          createdAt: new Date(draft.createdAt),
          assignedAt: draft.assignedAt ? new Date(draft.assignedAt) : undefined
        }));
        captionDrafts.splice(0, captionDrafts.length, ...items);
        addLog('info', `[DRAFTS] Loaded ${captionDrafts.length} drafts from file`);
      }
    }
  } catch (e: any) {
    console.error('[DRAFTS] Failed to load:', e?.message || e);
    captionDrafts.splice(0, captionDrafts.length);
  }
}

// Load drafts on startup
loadDrafts();

// Autopilot config endpoints
app.get('/ig/autopilot-config', (_req, res) => {
  res.json({
    config: autopilotConfig,
    captionPool: captionPool,
    availableSlots: availableSlots
  });
});

app.post('/ig/autopilot-config', (req, res) => {
  autopilotConfig = { ...autopilotConfig, ...req.body };
  addLog('info', '[AUTOPILOT] Config updated', autopilotConfig);
  res.json({ success: true, config: autopilotConfig });
});

// Get autopilot posts endpoint
app.get('/ig/autopilot-posts', (_req, res) => {
  const state = scheduler.getState();
  const autopilotPosts = state.posts.filter((p: any) => p.isAutopilot === true)
    .map(p => ({
      id: p.id,
      filename: p.filename,
      caption: p.caption,
      scheduled_at: p.scheduled_at?.toISOString() || null,
      published_at: p.published_at?.toISOString() || null,
      status: p.status,
      isAutopilot: true,
      autopilotBatch: (p as any).autopilotBatch || null
    }));
  
  res.json({ 
    success: true, 
    posts: autopilotPosts,
    total: autopilotPosts.length 
  });
});

// Generate caption pool endpoint
app.post('/ig/generate-caption-pool', async (req, res) => {
  try {
    const { count = 100, style = 'medium', keywords = [] } = req.body as {
      count?: number;
      style?: 'short' | 'medium' | 'long';
      keywords?: string[];
    };
    
    const { generateSmartCaption } = require('./caption') as typeof import('./caption');
    const captions = [];
    
    for (let i = 0; i < count; i++) {
      // Generate varied captions
      const caption = generateSmartCaption(
        `pilates-${Date.now()}-${i}.jpg`,
        'image',
        keywords
      );
      
      captions.push({
        id: Date.now() + i,
        text: caption.caption,
        used: false
      });
    }
    
    captionPool = captions;
    addLog('info', `[AUTOPILOT] Generated ${count} captions`);
    
    res.json({
      success: true,
      generated: count,
      captions: captions
    });
  } catch (e: any) {
    res.status(500).json({ error: 'server_error', message: e?.message || e });
  }
});

// Get posts for a specific day (including all statuses)
app.get('/ig/posts/by-day/:date', (req, res) => {
  try {
    const dateStr = String(req.params.date || '');
    // Parse YYYY-MM-DD as a LOCAL date to avoid timezone drift
    let targetDate: Date;
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const d = parseInt(m[3], 10);
      targetDate = new Date(y, mo, d);
    } else {
      targetDate = new Date(dateStr);
    }
    
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ success:false, error:'invalid_date' });
    }
    
    const state = scheduler.getState();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    // Include ALL posts for this day, not just SCHEDULED
    const dayPosts = state.posts
      .filter(p => {
        // Check both scheduled_at and published_at
        const checkDate = p.published_at || p.scheduled_at;
        return checkDate >= startOfDay && checkDate <= endOfDay;
      })
      .sort((a, b) => {
        const dateA = a.published_at || a.scheduled_at;
        const dateB = b.published_at || b.scheduled_at;
        return dateA.getTime() - dateB.getTime();
      })
      .map(p => ({
        id: p.id,
        filename: p.filename,
        scheduled_at: p.scheduled_at?.toISOString() || null,
        published_at: p.published_at?.toISOString() || null,
        status: p.status,
        caption: p.caption,
        is_repost: p.is_repost || false,
        repost_count: p.repost_count || 0,
        mediaType: p.filename.match(/\.(mp4|mov|avi|webm)$/i) ? 'video' : 'image'
      }));
    
    res.json({ success: true, date: dateStr, posts: dayPosts });
  } catch (e:any) {
    res.status(500).json({ success:false, error:'server_error' });
  }
});


// Get saved/published media library
app.get('/ig/saved-media', (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    
    // Get all files from inbox directory
    const filesRaw = fs.readdirSync(cfg.inboxPath)
      .filter(f => !f.startsWith('.'))
      .map(filename => {
        const filePath = path.join(cfg.inboxPath, filename);
        const stats = fs.statSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        const isVideo = ['.mp4', '.mov', '.avi', '.webm'].includes(ext);
        const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        
        if (!isVideo && !isImage) return null;
        
        return {
          id: `file_${Buffer.from(filename).toString('base64').substring(0, 10)}`,
          filename,
          mediaType: isVideo ? 'video' : 'image',
          size: stats.size,
          created_at: stats.birthtime.toISOString(),
          modified_at: stats.mtime.toISOString(),
          times_used: 0,
          caption: '',
          published_at: null as string | null
        };
      });
    
    // Filter out nulls and cast to proper type
    const files = filesRaw.filter((f): f is NonNullable<typeof f> => f !== null);
    
    // Check usage from posts
    const state = scheduler.getState();
    files.forEach(file => {
      if (file) {
        const usedInPosts = state.posts.filter(p => p.filename === file.filename);
        file.times_used = usedInPosts.length;
        if (usedInPosts.length > 0) {
          const publishedPost = usedInPosts.find(p => p.status === 'PUBLISHED');
          if (publishedPost) {
            file.caption = publishedPost.caption || '';
            file.published_at = publishedPost.published_at?.toISOString() || null;
          }
        }
      }
    });
    
    // Sort by modified date (newest first)
    files.sort((a, b) => {
      if (a && b) {
        return new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime();
      }
      return 0;
    });
    
    const total = files.length;
    const pages = Math.ceil(total / limit);
    const items = files.slice(offset, offset + limit);
    
    res.json({
      success: true,
      page,
      pages,
      total,
      items
    });
  } catch (e:any) {
    res.status(500).json({ success:false, error:'server_error' });
  }
});

// Posted history endpoint
app.get('/ig/history', (req, res) => {
  try {
    const parsed = HistoryRequestSchema.safeParse({
      page: req.query.page,
      limit: req.query.limit,
      from: req.query.from,
      to: req.query.to,
    });
    if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
    const { page, limit, from, to } = parsed.data;

    const all = scheduler.getState().posts
      .filter(p => p.status === 'PUBLISHED' && p.published_at)
      .sort((a, b) => (b.published_at!.getTime()) - (a.published_at!.getTime()));

    let filtered = all;
    const fromTs = from ? Date.parse(String(from)) : NaN;
    const toTs = to ? Date.parse(String(to)) : NaN;
    if (!isNaN(fromTs)) filtered = filtered.filter(p => p.published_at!.getTime() >= fromTs);
    if (!isNaN(toTs)) filtered = filtered.filter(p => p.published_at!.getTime() <= toTs);

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit).map(p => ({
      id: p.id,
      filename: p.filename,
      caption: p.caption,
      published_at: p.published_at!.toISOString(),
      ig_media_id: p.ig_media_id || '',
      thumbnail_url: `/media/${encodeURIComponent(p.filename)}`,
      is_repost: Boolean(p.is_repost),
    }));

    res.json({ total, page, limit, items });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), tunnel: { url: tunnelUrl, active: !!tunnelUrl } });
});

// ==============================
// Facebook API endpoints (Pro)
// ==============================
app.get('/fb/pages', async (_req, res) => {
  try {
    if (!cfg.fbToken) {
      return res.status(400).json({ error: 'missing_facebook_token' });
    }
    const r = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${encodeURIComponent(cfg.fbToken)}`);
    const data = await r.json();
    if (!r.ok || (data && data.error)) {
      const msg = (data && data.error && data.error.message) || `status_${r.status}`;
      addLog('error', `[FACEBOOK] Failed to fetch pages: ${msg}`);
      return res.status(500).json({ error: msg });
    }
    const pages = Array.isArray(data.data) ? data.data : [];
    addLog('info', `[FACEBOOK] Fetched ${pages.length} pages`);
    res.json({ pages });
  } catch (e: any) {
    addLog('error', `[FACEBOOK] Failed to fetch pages: ${e?.message || e}`);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/fb/publish', async (req, res) => {
  try {
    const { caption, filename, pageId, pageAccessToken } = req.body as { caption: string; filename: string; pageId: string; pageAccessToken?: string };
    if (!cfg.fbToken && !pageAccessToken) return res.status(400).json({ error: 'missing_facebook_token' });
    if (!pageId) return res.status(400).json({ error: 'missing_page_id' });
    if (!filename) return res.status(400).json({ error: 'missing_filename' });

    const token = pageAccessToken || cfg.fbToken;
    const ext = String(path.extname(filename || '')).toLowerCase();
    const isVideo = ['.mp4', '.mov', '.avi', '.webm'].includes(ext);
    const localUrl = `http://localhost:${cfg.port}/media/${encodeURIComponent(filename)}`;
    const mediaUrl = tunnelUrl ? `${tunnelUrl}/media/${encodeURIComponent(filename)}` : localUrl;

    const endpoint = isVideo ? `https://graph.facebook.com/v18.0/${encodeURIComponent(pageId)}/videos` : `https://graph.facebook.com/v18.0/${encodeURIComponent(pageId)}/photos`;
    const payload = isVideo ? { file_url: mediaUrl, description: caption || '', access_token: token } : { url: mediaUrl, message: caption || '', access_token: token };

    const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!r.ok || (j && j.error)) {
      const msg = (j && j.error && j.error.message) || `status_${r.status}`;
      addLog('error', `[FACEBOOK] Publish failed: ${msg}`);
      return res.status(500).json({ error: msg });
    }

    addLog('info', `[FACEBOOK] Published ${filename} to page ${pageId}`, { id: j.id || j.post_id }, 'SUCCESS');
    res.json({ success: true, postId: j.id || j.post_id });
  } catch (e: any) {
    addLog('error', `[FACEBOOK] Publish failed: ${e?.message || e}`);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

function startServices() {
  console.log('='.repeat(50));
  console.log('🚀 BulkIG Starting...');
  console.log('='.repeat(50));

  watcher.start();
  publisher.start();

  // Auto-repost periodic task (hourly)
  setInterval(() => {
    try { scheduler.autoRepostTick(); } catch {}
  }, 60 * 60 * 1000);

  // Kill any existing node processes on the port before starting
  if (os.platform() === 'win32') {
    try {
      require('child_process').execSync(`netstat -ano | findstr :${cfg.port} | findstr LISTENING`, { encoding: 'utf8' });
      console.log('[STARTUP] Killing existing process on port', cfg.port);
      require('child_process').execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${cfg.port} ^| findstr LISTENING') do taskkill /F /PID %a`, { shell: 'cmd.exe' });
    } catch {
      // No process found on port, continue
    }
  }

  app.listen(cfg.port, () => {
    console.log(`✅ Server running on http://localhost:${cfg.port}`);
    console.log(`📁 Watching: ${cfg.inboxPath}`);
    console.log(`🖼️  Static server: http://localhost:${cfg.staticPort}`);
    console.log(`🎯 Mock mode: ${cfg.mock ? 'ON' : 'OFF'}`);
    if (!cfg.mock) {
      console.log('[PRODUCTION] Live Instagram posting enabled!');
    }
    console.log('='.repeat(50));
    // Start Cloudflare tunnel asynchronously with retries
    void startTunnelWithRetries();
  });
}

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down BulkIG...');
  watcher.stop();
  process.exit(0);
});

startServices();

async function startTunnelWithRetries() {
  for (let attempt = 1; attempt <= MAX_TUNNEL_ATTEMPTS; attempt++) {
    try {
      console.log(`[TUNNEL] Starting Cloudflare tunnel (attempt ${attempt}/${MAX_TUNNEL_ATTEMPTS})...`);
      addLog('info', '[TUNNEL] Starting Cloudflare tunnel', { attempt, total: MAX_TUNNEL_ATTEMPTS });

      // Ensure cloudflared binary exists (postinstall may not have run in workspace)
      try {
        if (!fs.existsSync(cloudflaredBin)) {
          console.log('[TUNNEL] cloudflared binary missing; installing...');
          addLog('info', '[TUNNEL] Installing cloudflared binary');
          const installedTo = await installCloudflared(cloudflaredBin);
          console.log(`[TUNNEL] cloudflared installed to: ${installedTo}`);
        }
      } catch (instErr: any) {
        console.error('[TUNNEL] Installation failed:', instErr?.message || instErr);
        throw instErr;
      }

      const t = cloudflaredTunnel({ "--url": `http://localhost:${cfg.port}` });
      // Handle child error so process doesn't crash on ENOENT
      if (t.child && typeof t.child.once === 'function') {
        t.child.once('error', (err: any) => {
          console.error('[TUNNEL] Child process error:', err?.message || err);
        });
      }
      // Wait for URL or error/timeout
      const url = await Promise.race([
        t.url,
        new Promise((_, reject) => t.child && t.child.once && t.child.once('error', reject)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for cloudflared URL')), 15000)),
      ]) as string;

      if (!url) {
        throw new Error('No URL returned by cloudflared');
      }

      tunnelUrl = String(url);
      console.log(`🌐 Tunnel active: ${tunnelUrl}`);
      addLog('info', '🌐 Tunnel active', { url: tunnelUrl }, 'SUCCESS');
      return;
    } catch (e: any) {
      const msg = String(e?.message || e);
      console.error(`[TUNNEL] Attempt ${attempt}/${MAX_TUNNEL_ATTEMPTS} failed: ${msg}`);
      addLog('warn', `[TUNNEL] Attempt ${attempt}/${MAX_TUNNEL_ATTEMPTS} failed`, { error: msg });
      if (attempt < MAX_TUNNEL_ATTEMPTS) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }
  console.warn('[TUNNEL] All attempts failed. Continuing without tunnel (will use local/mock URLs).');
  addLog('warn', '[TUNNEL] All attempts failed. Continuing without tunnel');
}

// Helpers
function percentile(arr: number[], p: number): number {
  if (!arr || !arr.length) return 0;
  const a = [...arr].sort((x,y)=> x-y);
  const idx = Math.min(a.length-1, Math.max(0, Math.floor(p * a.length) - 1));
  return a[idx];
}

async function probeVideo(filePath: string): Promise<{durationSec:number, width:number, height:number}> {
  const args = ['-v','error','-print_format','json','-show_entries','format=duration:stream=index,codec_type,width,height',filePath];
  const { stdout } = await execa(ffprobe.path, args, { timeout: 20000 });
  const j = JSON.parse(stdout);
  const durationSec = parseFloat(j?.format?.duration || '0');
  const vstream = (j?.streams||[]).find((s:any)=> s.codec_type==='video');
  const width = Number(vstream?.width||0);
  const height = Number(vstream?.height||0);
  return { durationSec, width, height };
}

async function checkFilesystemHealth(inbox: string): Promise<{ exists:boolean; writable:boolean; disk?: { drive?:string; freeMB?:number; sizeMB?:number } }>{
  const out: any = { exists: false, writable: false, disk: {} };
  try { out.exists = fs.existsSync(inbox); } catch {}
  // writable check
  try {
    fs.accessSync(inbox, fs.constants.W_OK);
    const tmp = path.join(inbox, '.health.tmp');
    fs.writeFileSync(tmp, 'ok');
    fs.unlinkSync(tmp);
    out.writable = true;
  } catch { out.writable = false; }
  // disk usage (Windows)
  try {
    if (os.platform() === 'win32') {
      const drive = String(inbox).slice(0,2).toUpperCase();
      out.disk.drive = drive;
      const { stdout } = await execa('wmic', ['logicaldisk', 'where', `DeviceID='${drive}'`, 'get', 'FreeSpace,Size', '/format:value']);
      // Parse FreeSpace=..., Size=...
      const mFree = stdout.match(/FreeSpace=(\d+)/i);
      const mSize = stdout.match(/Size=(\d+)/i);
      if (mFree && mSize) {
        const freeMB = Math.round(parseInt(mFree[1],10)/1024/1024);
        const sizeMB = Math.round(parseInt(mSize[1],10)/1024/1024);
        out.disk.freeMB = freeMB; out.disk.sizeMB = sizeMB;
      }
    }
  } catch {}
  return out;
}
