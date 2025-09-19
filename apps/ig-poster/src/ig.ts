import fetch from 'node-fetch';
import pRetry from 'p-retry';
import { cfg } from './env';

export async function igCreateContainer(igUserId: string, token: string, mediaUrl: string, caption: string) {
  if (cfg.mock) {
    console.log(`[MOCK] Creating container for: ${mediaUrl}`);
    return `mock_creation_${Date.now()}`;
  }

  const url = `https://graph.facebook.com/v20.0/${igUserId}/media`;
  const isVideo = /\.(mp4|mov|avi|webm)$/i.test(mediaUrl);
  const body = new URLSearchParams();
  if (isVideo) {
    body.set('media_type', 'REELS');
    body.set('video_url', mediaUrl);
  } else {
    body.set('image_url', mediaUrl);
  }
  body.set('caption', caption || '');

  const r = await pRetry(
    () => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body }),
    { retries: 5, minTimeout: 2000 }
  );
  const j: any = await r.json();
  if (!j.id) throw new Error(`createContainer failed: ${JSON.stringify(j)}`);
  return j.id as string;
}

export async function igWaitFinished(creation_id: string, token: string) {
  if (cfg.mock) {
    console.log(`[MOCK] Container ${creation_id} instantly "finished"`);
    return;
  }

  const url = `https://graph.facebook.com/v20.0/${creation_id}?fields=status_code`;
  await pRetry(async () => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j: any = await r.json();
    if (j.status_code === 'FINISHED') return;
    if (j.status_code === 'ERROR') throw new pRetry.AbortError('IG processing error');
    throw new Error('not ready');
  }, { retries: 20, minTimeout: 3000 });
}

export async function igPublish(igUserId: string, token: string, creation_id: string) {
  if (cfg.mock) {
    console.log(`[MOCK] Publishing container ${creation_id}`);
    return `mock_media_${creation_id}_${Math.floor(Math.random() * 1e6)}`;
  }

  const url = `https://graph.facebook.com/v20.0/${igUserId}/media_publish`;
  const body = new URLSearchParams({ creation_id });
  const r = await pRetry(
    () => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body }),
    { retries: 5, minTimeout: 2000 }
  );
  const j: any = await r.json();
  if (!j.id) throw new Error(`publish failed: ${JSON.stringify(j)}`);
  return j.id as string;
}
