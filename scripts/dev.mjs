// npm run dev: the API with reload (tsx watch, :4317) and the Vite dev server (proxies /api to :4317).
// Both stop together. Extra arguments (for example --offline) go to the API server.
import { spawn } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npx, ['tsx', 'watch', 'src/server/main.ts', ...process.argv.slice(2)], { stdio: 'inherit' }),
  spawn(npm, ['--prefix', 'web', 'run', 'dev'], { stdio: 'inherit' }),
];
const stop = (code) => {
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  process.exit(code);
};
for (const c of children) c.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
