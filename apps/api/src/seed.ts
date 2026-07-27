import { loadConfig } from './config.js';
import { DemoLedger, seedDemoLedger } from './ledger/index.js';

const config = loadConfig();
if (config.ledgerMode !== 'demo') {
  throw new Error('The seed command only writes the explicitly marked demo ledger');
}

const force = process.argv.includes('--force');
const ledger = new DemoLedger(config.demoLedgerPath);
const result = await seedDemoLedger(ledger, force);
console.log(
  result.seeded
    ? `[jixin-api] seeded ${result.count} demo shipments at ${config.demoLedgerPath}`
    : `[jixin-api] demo ledger already contains ${result.count} shipments; no changes made`,
);
