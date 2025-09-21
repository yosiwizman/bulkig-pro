import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function computeLicense(email: string, secret: string): string {
  const raw = crypto.createHash('sha256')
    .update(String(email || '').trim().toLowerCase() + secret, 'utf8')
    .digest('hex')
    .toUpperCase();
  const x16 = raw.slice(0, 16);
  return x16.replace(/(.{4})(?=.)/g, '$1-');
}

export function generateLicense(email: string): string {
  const secret = process.env.LICENSE_SECRET || 'BULKIGPRO-2025-SECRET';
  return computeLicense(email, secret);
}

export function generateLicenseBatch(count: number) {
  const licenses: { code: string; note: string }[] = [];
  for (let i = 0; i < count; i++) {
    const email = `customer${i}@pending.com`;
    const code = generateLicense(email);
    licenses.push({ code, note: 'Activate with purchase email' });
  }
  const outDir = path.resolve('release');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
  const csvPath = path.join(outDir, 'gumroad-licenses.csv');
  const header = 'code,note\n';
  const lines = licenses.map(l => `${l.code},${l.note}`).join('\n');
  fs.writeFileSync(csvPath, header + lines, 'utf8');
  console.log(`Wrote ${licenses.length} licenses to ${csvPath}`);
}

// CLI entrypoint
if (require.main === module) {
  const arg = Number(process.argv[2] || '100');
  const count = isNaN(arg) || arg <= 0 ? 100 : Math.floor(arg);
  generateLicenseBatch(count);
}
