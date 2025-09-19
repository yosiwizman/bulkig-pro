import path from 'path';
import fetch from 'node-fetch';
import { Post } from './types';
import { Scheduler } from './scheduler';
import { igCreateContainer, igWaitFinished, igPublish } from './ig';
import { cfg } from './env';
import { addLog } from './logger';
import { tunnelUrl } from './index';

export class Publisher {
  private scheduler: Scheduler;
  private isRunning = false;

  constructor(scheduler: Scheduler) {
    this.scheduler = scheduler;
  }

  start() {
    if (this.isRunning) {
      console.log('[PUBLISHER] Already running');
      return;
    }

    this.isRunning = true;
    const m = '[PUBLISHER] Starting publish loop';
    console.log(m);
    addLog('info', m);

    this.publishLoop();
    setInterval(() => this.publishLoop(), 60_000);
  }

  public async kick() {
    // Run one immediate pass
    await this.publishLoop();
  }

  private async publishLoop() {
    if (!this.scheduler.isAutorunEnabled()) {
      return;
    }

    const readyPosts = this.scheduler.getReadyPosts();
    for (const post of readyPosts) {
      await this.publishPost(post);
    }
  }

  private async publishPost(post: Post) {
    try {
      const m = `[PUBLISHER] Publishing: ${post.filename}`;
      console.log(m);
      addLog('info', m);

      this.scheduler.updatePost(post.id, { status: 'PUBLISHING' });

      // Determine platform selection (default instagram on)
      const platforms = (post as any).platforms || { instagram: true };

      // Prefer public tunnel URL if available for IG
      const publicUrl = (!cfg.mock && tunnelUrl)
        ? `${tunnelUrl}/static/${encodeURIComponent(path.basename(post.filename))}`
        : post.image_url;

      let igOk = false;
      if (platforms.instagram !== false) {
        try {
          const creationId = await igCreateContainer(
            cfg.igUserId,
            cfg.fbToken,
            publicUrl,
            post.caption
          );
          await igWaitFinished(creationId, cfg.fbToken);
          const mediaId = await igPublish(cfg.igUserId, cfg.fbToken, creationId);

          this.scheduler.updatePost(post.id, {
            status: 'PUBLISHED',
            published_at: new Date(),
            ig_media_id: mediaId,
          });

          // If this post originated from a draft, mark it used
          const draftId = (post as any).draftId as string | undefined;
          if (draftId) {
            try {
              const idx = (require('./index') as any).captionDrafts?.findIndex?.((d: any) => d.id === draftId);
              if (typeof idx === 'number' && idx >= 0) {
                const mod = require('./index') as any;
                mod.captionDrafts[idx].status = 'used';
                mod.saveDraftsToFile?.();
                addLog('info', `[DRAFTS] Post published using ${draftId}`, undefined, 'SUCCESS');
              }
            } catch {}
          }
          const ok = `[PUBLISHER] Successfully published to Instagram: ${post.filename}`;
          console.log(ok);
          addLog('info', ok, undefined, 'SUCCESS');
          igOk = true;
        } catch (e: any) {
          const emsg = `[PUBLISHER] Instagram publish failed for ${post.filename}: ${e?.message || e}`;
          console.error(emsg);
          addLog('error', emsg);
        }
      }

      // Facebook posting (optional)
      let fbOk = false;
      if (platforms.facebook && platforms.facebook.enabled) {
        try {
          const resp = await fetch(`http://localhost:${cfg.port}/fb/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              caption: post.caption,
              filename: post.filename,
              pageId: platforms.facebook.pageId,
              pageAccessToken: platforms.facebook.pageAccessToken || undefined,
            })
          });
          if (!resp.ok) {
            const txt = await resp.text().catch(()=> '');
            throw new Error(`HTTP ${resp.status} ${txt}`);
          }
          addLog('info', `[PUBLISHER] Successfully published to Facebook: ${post.filename}`, undefined, 'SUCCESS');
          fbOk = true;
        } catch (e: any) {
          const emsg = `[PUBLISHER] Facebook publish failed for ${post.filename}: ${e?.message || e}`;
          console.error(emsg);
          addLog('error', emsg);
        }
      }

      // Final status handling: keep PUBLISHED if IG succeeded; set ERROR only if neither succeeded
      if (!igOk && !(platforms.facebook && platforms.facebook.enabled && fbOk)) {
        this.scheduler.updatePost(post.id, { status: 'ERROR', error_message: 'No platform succeeded' });
      }
    } catch (error) {
      const emsg = `[PUBLISHER] Error publishing ${post.filename}`;
      console.error(emsg, error);
      addLog('error', emsg, { error: error instanceof Error ? error.message : String(error) });
      this.scheduler.updatePost(post.id, {
        status: 'ERROR',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
