// 视觉测试专用 API 服务：冻结账本、禁自动播种、独立端口，跨平台设置环境变量。
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../../..');

const child = spawn('go', ['run', './apps/api/cmd/server'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3101',
    // 浏览器同源 POST 会带 Origin，白名单需覆盖 e2e 前端端口。
    CORS_ORIGIN: 'http://127.0.0.1:5199,http://localhost:5199',
    DEMO_LEDGER_PATH: resolve(here, 'fixtures/demo-ledger.json'),
    DEMO_AUTO_SEED: 'false',
  },
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
