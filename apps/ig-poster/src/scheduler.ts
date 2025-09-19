import { Post } from './types';
import { generateCaption } from './generator';
import { cfg } from './env';
import { addLog } from './logger';

export type ScheduleMode = 'interval' | 'times';
export interface ScheduleConfig {
  mode: ScheduleMode;
  intervalHours: number; // used when mode === 'interval'
  days: number[]; // 0..6, Sunday=0
  times: string[]; // 'HH:MM', used when mode === 'times'
  autoRepostEnabled?: boolean; // when true, auto repost after 60d
}

export class Scheduler {
  private posts: Post[] = []; // Clear on startup
  private autorun = false;
  private lastPlanRun: Date | null = null;
  private config: ScheduleConfig = {
    mode: 'interval',
    intervalHours: 4,
    days: [0,1,2,3,4,5,6],
    times: [],
    autoRepostEnabled: false,
  };

  getState() {
    return {
      autorun: this.autorun,
      posts: this.posts,
      lastPlanRun: this.lastPlanRun,
      counts: {
        QUEUED: this.posts.filter(p => p.status === 'QUEUED').length,
        SCHEDULED: this.posts.filter(p => p.status === 'SCHEDULED').length,
        PUBLISHING: this.posts.filter(p => p.status === 'PUBLISHING').length,
        PUBLISHED: this.posts.filter(p => p.status === 'PUBLISHED').length,
        ERROR: this.posts.filter(p => p.status === 'ERROR').length,
      },
      next: this.posts
        .filter(p => p.status === 'SCHEDULED')
        .sort((a, b) => a.scheduled_at.getTime() - b.scheduled_at.getTime())
        .slice(0, 10)
        .map(p => ({
          id: p.id,
          filename: p.filename,
          scheduled_at: p.scheduled_at.toISOString(),
          status: p.status,
        })),
    };
  }

  getConfig(): ScheduleConfig {
    return { ...this.config, days: [...this.config.days], times: [...this.config.times] };
  }

  setConfig(update: Partial<ScheduleConfig>) {
    if (update.mode && (update.mode === 'interval' || update.mode === 'times')) this.config.mode = update.mode;
    if (typeof update.intervalHours === 'number' && update.intervalHours > 0) this.config.intervalHours = Math.max(1, Math.floor(update.intervalHours));
    if (Array.isArray(update.days)) this.config.days = update.days.filter(n => n>=0 && n<=6);
    if (Array.isArray(update.times)) this.config.times = update.times.filter(s => /^\d{2}:\d{2}$/.test(s)).sort();
    if (typeof update.autoRepostEnabled === 'boolean') this.config.autoRepostEnabled = update.autoRepostEnabled;
  }

  preview(from: Date, count: number): Date[] {
    const out: Date[] = [];
    const daysSet = new Set(this.config.days);
    const mode = this.config.mode;
    const times = this.config.times.length ? this.config.times : ['09:00','13:00','17:00','21:00'];
    let cursor = new Date(from);

    const addIfAllowed = (d: Date) => {
      if (daysSet.has(d.getDay())) out.push(new Date(d));
    };

    if (mode === 'interval') {
      const hours = Math.max(1, this.config.intervalHours);
      while (out.length < count) {
        addIfAllowed(cursor);
        cursor = new Date(cursor.getTime() + hours*60*60*1000);
        // If next day not allowed, advance to next allowed day at same time
        while (!daysSet.has(cursor.getDay())) {
          cursor.setDate(cursor.getDate() + 1);
        }
      }
      return out;
    }

    // mode === 'times'
    // For each day, iterate times
    while (out.length < count) {
      if (daysSet.has(cursor.getDay())) {
        for (const t of times) {
          const [hh,mm] = t.split(':').map(Number);
          const candidate = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), hh, mm, 0, 0);
          if (candidate >= from) out.push(candidate);
          if (out.length >= count) break;
        }
      }
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0,0,0,0);
    }
    return out.slice(0, count);
  }

  setAutorun(enabled: boolean) {
    this.autorun = enabled;
    const msg = `[SCHEDULER] Autorun ${enabled ? 'enabled' : 'disabled'}`;
    console.log(msg);
    addLog('info', msg);
  }

  queueFile(filename: string, overrides?: Partial<Post> & { draftId?: string }) {
    const existing = this.posts.find(p => p.filename === filename && (p.status === 'QUEUED' || p.status === 'SCHEDULED'));
    if (existing) {
      const msg = `[SCHEDULER] File already queued: ${filename}`;
      console.log(msg);
      addLog('info', msg);
      return existing;
    }

    const encoded = encodeURIComponent(filename);
    // Local URL for thumbnails and local viewing via app
    const localThumbUrl = `http://localhost:${cfg.port}/media/${encoded}`;
    // Public URL for IG publishing when provided
    const igUrl = (!cfg.mock && cfg.publicBaseUrl)
      ? `${cfg.publicBaseUrl}/${encoded}`
      : localThumbUrl;

    const post: Post = {
      id: `post_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      filename,
      image_url: igUrl,
      caption: overrides?.caption ?? generateCaption(filename),
      status: overrides?.status ?? 'QUEUED',
      scheduled_at: overrides?.scheduled_at ?? new Date(),
      created_at: new Date(),
      is_repost: false,
      repost_count: 0,
      ig_media_id: overrides?.ig_media_id,
      published_at: overrides?.published_at,
      error_message: overrides?.error_message,
    };

    // Attach non-typed metadata via type assertion
    if (overrides && 'draftId' in overrides && (overrides as any).draftId) {
      (post as any).draftId = (overrides as any).draftId;
    }

    this.posts.push(post);
    const msg = `[SCHEDULER] Queued: ${filename}`;
    console.log(msg);
    addLog('info', msg);
    return post;
  }

  planPosts() {
    const queuedPosts = this.posts.filter(p => p.status === 'QUEUED');

    if (queuedPosts.length === 0) {
      const msg = '[SCHEDULER] No queued posts to plan';
      console.log(msg);
      addLog('info', msg);
      this.lastPlanRun = new Date();
      return;
    }

    const now = new Date();
    const times = this.preview(now, queuedPosts.length);

    queuedPosts.forEach((post, index) => {
      const scheduledTime = times[index] || new Date(now.getTime() + (index+1)*60*60*1000);
      post.scheduled_at = scheduledTime;
      post.status = 'SCHEDULED';
    });

    this.lastPlanRun = new Date();
    const msg = `[SCHEDULER] Planned ${queuedPosts.length} posts`;
    console.log(msg);
    addLog('info', msg);
  }

  getReadyPosts(): Post[] {
    const now = new Date();
    return this.posts.filter(p => p.status === 'SCHEDULED' && p.scheduled_at <= now);
  }

  updatePost(postId: string, updates: Partial<Post>) {
    const post = this.posts.find(p => p.id === postId);
    if (post) Object.assign(post, updates);
  }

  private getRootOriginalId(p: Post): string {
    return p.is_repost && p.original_post_id ? p.original_post_id : p.id;
  }

  private getRepostStats(rootId: string): { totalReposts: number; pendingReposts: number; lastPublishedAt: Date | null } {
    let totalReposts = 0;
    let pendingReposts = 0;
    let lastPublishedAt: Date | null = null;
    for (const p of this.posts) {
      const belongs = (p.id === rootId) || (p.is_repost && p.original_post_id === rootId);
      if (!belongs) continue;
      if (p.status === 'PUBLISHED' && p.published_at) {
        if (!lastPublishedAt || p.published_at > lastPublishedAt) lastPublishedAt = p.published_at;
      }
      if (p.is_repost && p.original_post_id === rootId) {
        totalReposts++;
        if (p.status === 'QUEUED' || p.status === 'SCHEDULED' || p.status === 'PUBLISHING') pendingReposts++;
      }
    }
    return { totalReposts, pendingReposts, lastPublishedAt };
  }

  scheduleRepostFromId(postId: string, reason: 'manual'|'auto'): Post | null {
    const orig = this.posts.find(p => p.id === postId);
    if (!orig) return null;
    const rootId = this.getRootOriginalId(orig);
    const root = this.posts.find(p => p.id === rootId);
    if (!root) return null;
    if (root.status !== 'PUBLISHED' && reason === 'manual') {
      // allow manual only for published items; history will only show published
      return null;
    }

    const { totalReposts, pendingReposts, lastPublishedAt } = this.getRepostStats(rootId);
    if (totalReposts >= 3) return null; // limit 3
    if (pendingReposts > 0 && reason === 'auto') return null; // avoid duplicates in auto

    // For auto, enforce 60 days since last published of the chain
    if (reason === 'auto') {
      const baseDate = lastPublishedAt || root.published_at || root.created_at;
      const sixtyDays = 60 * 24 * 60 * 60 * 1000;
      if (!baseDate || (Date.now() - baseDate.getTime()) < sixtyDays) {
        return null;
      }
    }

    // create repost post
    const encoded = encodeURIComponent(root.filename);
    const localThumbUrl = `http://localhost:${cfg.port}/media/${encoded}`;
    const igUrl = (!cfg.mock && cfg.publicBaseUrl)
      ? `${cfg.publicBaseUrl}/${encoded}`
      : localThumbUrl;

    const newPost: Post = {
      id: `post_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      filename: root.filename,
      image_url: igUrl,
      caption: root.caption,
      status: 'QUEUED',
      scheduled_at: new Date(),
      created_at: new Date(),
      is_repost: true,
      original_post_id: rootId,
    };

    this.posts.push(newPost);
    // increment root repost_count
    root.repost_count = (root.repost_count || 0) + 1;
    const msg = `[REPOST] Scheduled repost of ${rootId} (${reason})`;
    console.log(msg);
    addLog('info', msg);
    return newPost;
  }

  autoRepostTick() {
    if (!this.config.autoRepostEnabled) return;
    const originals: Post[] = this.posts.filter(p => !p.is_repost && p.status === 'PUBLISHED');
    for (const root of originals) {
      this.scheduleRepostFromId(root.id, 'auto');
    }
    // If we scheduled any, plan them
    const hasNewQueued = this.posts.some(p => p.status === 'QUEUED');
    if (hasNewQueued) this.planPosts();
  }

  removePost(postId: string): Post | null {
    const idx = this.posts.findIndex(p => p.id === postId);
    if (idx >= 0) {
      const [removed] = this.posts.splice(idx, 1);
      return removed;
    }
    return null;
  }

  isAutorunEnabled(): boolean {
    return this.autorun;
  }
}
