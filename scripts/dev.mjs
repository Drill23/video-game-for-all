#!/usr/bin/env node
import { spawn } from 'node:child_process';

const children = [
  spawn('pnpm', ['--filter', '@vgfa/signaling-server', 'dev'], {
    stdio: 'inherit',
    shell: true,
  }),
  spawn('pnpm', ['--filter', '@vgfa/web', 'dev'], {
    stdio: 'inherit',
    shell: true,
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
