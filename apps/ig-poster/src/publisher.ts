import path from 'path';
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

      // Prefer public tunnel URL if available for IG
      const publicUrl = (!cfg.mock && tunnelUrl)
        ? `${tunnelUrl}/static/${encodeURIComponent(path.basename(post.filename))}`
        : post.image_url;

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

      const ok = `[PUBLISHER] Successfully published: ${post.filename} -> ${mediaId}`;
      console.log(ok);
      addLog('info', ok);
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
