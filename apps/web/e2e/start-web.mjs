// 视觉测试专用前端服务：Vite dev 模式（沿用 /api 代理配置），独立端口。
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const viteBin = resolve(here, '../node_modules/vite/bin/vite.js');

const child = spawn(
  process.execPath,
  [viteBin, '--port', '5199', '--strictPort', '--host', '127.0.0.1'],
  {
    cwd: resolve(here, '..'),
    env: {
      ...process.env,
      VITE_API_PROXY_TARGET: 'http://127.0.0.1:3101',
    },
    stdio: 'inherit',
  },
);

child.on('exit', (code) => process.exit(code ?? 0));
