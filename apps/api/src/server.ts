import { createServer } from 'node:http';
import { loadEnvFile } from 'node:process';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLedger } from './ledger/index.js';

const envFile = process.env.ENV_FILE?.trim();
if (envFile) loadEnvFile(envFile);

const config = loadConfig();
const ledger = await createLedger(config);
const app = createApp({ ledger, config });
const server = createServer(app);

server.listen(config.port, config.host, () => {
  console.log(
    `[jixin-api] listening on http://${config.host}:${config.port} ledger=${ledger.mode}${
      ledger.mode === 'demo' ? ' (DEMO LEDGER — NOT REAL BLOCKCHAIN PROOF)' : ''
    }`,
  );
});

function shutdown(signal: string) {
  console.log(`[jixin-api] ${signal} received, closing server`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
