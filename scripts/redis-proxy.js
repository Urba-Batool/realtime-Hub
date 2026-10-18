/**
 * Redis proxy: forwards localhost:6379 → WSL Redis (0.0.0.0:6379).
 * Re-resolves the WSL IP on every new connection so it survives WSL restarts.
 */
const net = require('net');
const { execSync } = require('child_process');

function getWslIp() {
  try {
    const ip = execSync('wsl hostname -I', { encoding: 'utf8', timeout: 3000 })
      .trim()
      .split(/\s+/)[0];
    return ip || null;
  } catch {
    return null;
  }
}

const server = net.createServer((src) => {
  const wslIp = getWslIp();
  if (!wslIp) {
    console.error('[proxy] Could not resolve WSL IP, rejecting connection');
    return src.destroy();
  }
  const dst = net.connect(6379, wslIp, () => {
    console.log(`[proxy] ${src.remoteAddress} → ${wslIp}:6379`);
  });
  src.pipe(dst);
  dst.pipe(src);
  const cleanup = () => { try { src.destroy(); } catch {} try { dst.destroy(); } catch {} };
  src.on('error', cleanup);
  dst.on('error', cleanup);
  src.on('close', cleanup);
  dst.on('close', cleanup);
});

server.listen(6379, '0.0.0.0', () => {
  const wslIp = getWslIp();
  console.log(`[proxy] Listening on 0.0.0.0:6379 → ${wslIp}:6379`);
});
server.on('error', (err) => console.error('[proxy] Server error:', err.message));
