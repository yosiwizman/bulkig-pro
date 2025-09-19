import fs from 'fs';
import path from 'path';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory = 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS';
export interface LogEntry {
  ts: string; // ISO timestamp
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: any;
}

const MAX_LOGS = 1000;
const logs: LogEntry[] = [];
const LOG_DIR = path.resolve(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'activity.json');

function ensureDir() {
  try { if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}

function computeCategory(level: LogLevel, message: string): LogCategory {
  if (level === 'error') return 'ERROR';
  if (level === 'warn') return 'WARNING';
  // success heuristics
  if (/Successfully published/i.test(message)) return 'SUCCESS';
  return 'INFO';
}

function savePersist() {
  try {
    ensureDir();
    const toWrite = JSON.stringify(logs, null, 2);
    fs.writeFileSync(LOG_FILE, toWrite, 'utf-8');
  } catch {}
}

(function loadPersist(){
  try {
    ensureDir();
    if (fs.existsSync(LOG_FILE)) {
      const raw = fs.readFileSync(LOG_FILE, 'utf-8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        arr.forEach((e) => {
          if (!e || typeof e !== 'object') return;
          const entry: LogEntry = {
            ts: String(e.ts || new Date().toISOString()),
            level: (e.level === 'error' || e.level === 'warn') ? e.level : 'info',
            category: (e.category === 'SUCCESS' || e.category === 'ERROR' || e.category === 'WARNING') ? e.category : 'INFO',
            message: String(e.message || ''),
            data: (e as any).data,
          };
          logs.push(entry);
        });
        if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
      }
    }
  } catch {}
})();

export function addLog(level: LogLevel, message: string, data?: any, category?: LogCategory) {
  const cat = category || computeCategory(level, message);
  const entry: LogEntry = { ts: new Date().toISOString(), level, category: cat, message, data };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
  savePersist();
}

export function getLogs(limit = 50): LogEntry[] {
  const n = Math.max(0, Math.min(limit, logs.length));
  return logs.slice(logs.length - n);
}

export function getAllLogs(): LogEntry[] {
  return logs.slice();
}

export function clearLogs() {
  logs.splice(0, logs.length);
  savePersist();
}
