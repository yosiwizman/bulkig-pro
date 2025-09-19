/* Test utilities for BulkIG smoke tests */

import fs from 'fs';
import os from 'os';
import path from 'path';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpResult {
  url: string;
  method: HttpMethod;
  status: number;
  timeMs: number;
  headers: Record<string, string>;
  text: string;
}

export interface FetchOpts {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
  body?: any;
}

export function redactToken(token: string, keep = 4): string {
  if (!token) return '';
  const t = String(token);
  if (t.length <= keep) return '*'.repeat(Math.max(0, t.length - 1)) + t.slice(-1);
  return '*'.repeat(Math.max(0, t.length - keep)) + t.slice(-keep);
}

export async function httpFetch(url: string, method: HttpMethod = 'GET', opts: FetchOpts = {}): Promise<HttpResult> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const retries = opts.retries ?? 1;
  const retryDelayMs = opts.retryDelayMs ?? 300;

  let attempt = 0;
  let lastErr: any;

  while (attempt < retries) {
    attempt++;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeoutMs);
    const start = performance.now();
    try {
      const r = await fetch(url, {
        method,
        headers: opts.headers,
        body: opts.body,
        signal: controller.signal,
      } as any);
      const timeMs = Math.round(performance.now() - start);
      const text = await r.text();
      const headers: Record<string, string> = {};
      r.headers.forEach((v, k) => (headers[k] = v));
      clearTimeout(to);
      return { url, method, status: r.status, timeMs, headers, text };
    } catch (e) {
      clearTimeout(to);
      lastErr = e;
      if (attempt >= retries) break;
      await new Promise((res) => setTimeout(res, retryDelayMs));
    }
  }
  throw lastErr;
}

export async function getJson<T = any>(url: string, opts: FetchOpts = {}): Promise<{ res: HttpResult; json: T }>
{
  const res = await httpFetch(url, 'GET', opts);
  let json: any = null;
  try { json = JSON.parse(res.text); } catch {}
  return { res, json };
}

export async function postJson<T = any>(url: string, body: any, opts: FetchOpts = {}): Promise<{ res: HttpResult; json: T }>
{
  const res = await httpFetch(url, 'POST', {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body ?? {}),
  });
  let json: any = null;
  try { json = JSON.parse(res.text); } catch {}
  return { res, json };
}

export async function uploadFile(baseUrl: string, fileName: string, content: Blob): Promise<{ res: HttpResult; json: any }>
{
  const form = new FormData();
  // @ts-ignore - Node 18 supports File via undici
  const file = new File([content], fileName, { type: content.type || 'application/octet-stream' });
  form.append('file', file);
  const res = await httpFetch(`${baseUrl}/ig/upload`, 'POST', { body: form as any });
  let json: any = null;
  try { json = JSON.parse(res.text); } catch {}
  return { res, json };
}

export function writeFileSafe(p: string, data: Buffer | string) {
  fs.writeFileSync(p, data);
}

export function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

export function exists(p: string) { return fs.existsSync(p); }

export function removeIfExists(p: string) { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

export function pick<T>(obj: Record<string, any>, keys: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  keys.forEach(k => { if (obj[k] !== undefined) out[k] = obj[k]; });
  return out;
}

export function nowIso() { return new Date().toISOString(); }

export function mdEscape(s: string) { return s.replace(/`/g, '\\`'); }

export function shortSnippet(s: string, n = 50) {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').slice(0, n);
  return t + (s.length > n ? '…' : '');
}

export function measure<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }>
{
  const start = performance.now();
  return fn().then(value => ({ ms: Math.round(performance.now() - start), value }));
}

export const TMP_DIR = path.join(os.tmpdir(), 'bulkig-smoke');
ensureDir(TMP_DIR);

export function makeTestPng(): Blob {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
  const bytes = Buffer.from(b64, 'base64');
  return new Blob([bytes], { type: 'image/png' });
}

export function makeTestMp4(): Blob {
  // Minimal MP4 ftyp header; not a valid playable file but fine for upload/write detection
  const hex = '000000186674797069736f6d0000020069736f6d69736f3261766331000000086672656500000008';
  const bytes = Buffer.from(hex, 'hex');
  return new Blob([bytes], { type: 'video/mp4' });
}