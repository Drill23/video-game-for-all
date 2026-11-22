#!/usr/bin/env node
import { spawn } from 'node:child_process';

const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const children = [
  spawn(pnpmBin, ['--filter', '@vgfa/signaling-server', 'dev'], {
    stdio: 'inherit',
  }),
  spawn(pnpmBin, ['--filter', '@vgfa/web', 'dev'], {
    stdio: 'inherit',
  }),
];

function shutdown() {
  for (const child of children) {
    child.kill('SIGTERM');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
