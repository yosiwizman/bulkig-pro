import * as dotenv from 'dotenv';
import path from 'path';
import os from 'os';
// Load .env from repo root (three levels up from src): apps/ig-poster/src -> apps/ig-poster -> apps -> repo root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const defaultInbox = path.join(os.homedir(), 'BulkIG-Pro', 'inbox');

export const cfg = {
  mock: (process.env.IG_MOCK || 'false').toLowerCase() === 'true',
  igUserId: process.env.IG_USER_ID || '',
  fbToken: process.env.FB_LONG_LIVED_PAGE_TOKEN || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  generatorUrl: process.env.GENERATOR_URL || 'http://localhost:4001',
  inboxPath: process.env.INBOX_PATH || defaultInbox,
  staticPort: parseInt(process.env.STATIC_SERVER_PORT || '5006', 10),
  port: parseInt(process.env.IG_POSTER_PORT || '4011', 10),
  publicBaseUrl: process.env.PUBLIC_IMAGE_BASE || '',
};

console.log('[CONFIG] Mock mode:', cfg.mock);
console.log('[CONFIG] Inbox path:', cfg.inboxPath);
console.log('[CONFIG] Server port:', cfg.port);
