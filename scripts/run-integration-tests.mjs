import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(command, ['run', 'test:integration'], {
  stdio: 'inherit',
  shell: false
});
process.exit(result.status ?? 1);
