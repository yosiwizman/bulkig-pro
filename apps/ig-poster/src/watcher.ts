import chokidar from 'chokidar';
import { cfg } from './env';
import { Scheduler } from './scheduler';
import path from 'path';
import { addLog } from './logger';

export class FileWatcher {
  private scheduler: Scheduler;
  private watcher: chokidar.FSWatcher | null = null;

  constructor(scheduler: Scheduler) {
    this.scheduler = scheduler;
  }

  start() {
    const msg = `[WATCHER] Starting file watcher on: ${cfg.inboxPath}`;
    console.log(msg);
    addLog('info', msg);

    this.watcher = chokidar.watch(cfg.inboxPath, {
      ignored: /^\./,
      persistent: true,
      ignoreInitial: false,
    });

    this.watcher
      .on('add', (filePath) => {
        const filename = path.basename(filePath);
        if (this.isMediaFile(filename)) {
          const m = `[WATCHER] New media detected: ${filename}`;
          console.log(m);
          addLog('info', m);
          this.scheduler.queueFile(filename);
        }
      })
      .on('error', (error) => {
        console.error('[WATCHER] Error:', error);
        addLog('error', '[WATCHER] Error', { error: String(error) });
      });
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      const m = '[WATCHER] File watcher stopped';
      console.log(m);
      addLog('info', m);
    }
  }

  private isImageFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
  }

  private isVideoFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext);
  }

  private isMediaFile(filename: string): boolean {
    return this.isImageFile(filename) || this.isVideoFile(filename);
  }
}
