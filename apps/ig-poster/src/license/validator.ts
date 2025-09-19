import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const SECRET = process.env.LICENSE_SECRET || 'BULKIGPRO-2025-SECRET';

function licenseDirDefault() {
  const base = process.env.BULKIG_PRO_DATA_DIR || path.join(os.homedir(), 'BulkIG-Pro');
  return base;
}

export function getLicensePath(): string {
  const explicit = process.env.LICENSE_PATH;
  if (explicit) return explicit;
  return path.join(licenseDirDefault(), 'license.json');
}

function ensureDir(p: string) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

function computeHash(email: string): string {
  const h = crypto.createHash('sha256').update(String(email || '').trim().toLowerCase() + SECRET, 'utf8').digest('hex').toUpperCase();
  return h.slice(0, 16);
}

function fmtKey(k: string): string {
  const x = k.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 16);
  return x.replace(/(.{4})(?=.)/g, '$1-');
}

function sanitizeKey(k: string): string {
  return String(k || '').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 16);
}

export function validateLicense(email: string, key: string): boolean {
  const expected = computeHash(email);
  return sanitizeKey(key) === expected;
}

export function readLicense(): { email: string; key: string } | null {
  const p = getLicensePath();
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    if (j && typeof j.email === 'string' && typeof j.key === 'string') return j;
    return null;
  } catch { return null; }
}

export function writeLicense(email: string, key: string) {
  const p = getLicensePath();
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify({ email: String(email).trim(), key: fmtKey(key) }, null, 2), 'utf8');
}

export function getLicenseStatus(): { valid: boolean; email?: string } {
  const lic = readLicense();
  if (!lic) return { valid: false };
  const ok = validateLicense(lic.email, lic.key);
  return ok ? { valid: true, email: lic.email } : { valid: false };
}

export function activateLicense(email: string, key: string): boolean {
  const ok = validateLicense(email, key);
  if (!ok) return false;
  writeLicense(email, key);
  return true;
}
