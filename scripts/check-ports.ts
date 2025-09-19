import net from 'net';

const ports = [
  { name: 'BulkIG Original', port: 4010 },
  { name: 'BulkIG Pro', port: 4011 },
  { name: 'Static Server Original', port: 5005 },
  { name: 'Static Server Pro', port: 5006 },
];

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close();
      resolve(true);
    });
    srv.listen(port);
  });
}

async function main() {
  console.log('Checking port availability...\n');
  for (const p of ports) {
    const ok = await checkPort(p.port);
    console.log(`Port ${p.port} (${p.name}): ${ok ? '✅ Available' : '❌ In Use'}`);
  }
}

main().catch(() => process.exit(1));
