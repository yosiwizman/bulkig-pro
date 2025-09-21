import crypto from 'crypto';

function compute(email: string, secret: string): string {
  const raw = crypto.createHash('sha256').update(String(email || '').trim().toLowerCase() + secret, 'utf8').digest('hex').toUpperCase();
  const x = raw.slice(0, 16);
  return x.replace(/(.{4})(?=.)/g, '$1-');
}

async function main() {
  const email = process.argv[2] || '';
  if (!email) {
    console.error('Usage: pnpm license:generate you@example.com');
    process.exit(1);
  }
  const secret = process.env.LICENSE_SECRET || 'BULKIGPRO-2025-SECRET';
  const key = compute(email, secret);
  console.log(key);
}

main().catch((e) => { console.error(e); process.exit(1); });
