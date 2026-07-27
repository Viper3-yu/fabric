import type { AppConfig } from '../config.js';
import { DemoLedger, seedDemoLedger } from './demo-ledger.js';
import { FabricLedger } from './fabric-ledger.js';
import type { Ledger } from './types.js';

export type { Ledger } from './types.js';
export { DemoLedger, FabricLedger, seedDemoLedger };

export async function createLedger(config: AppConfig): Promise<Ledger> {
  if (config.ledgerMode === 'fabric') return new FabricLedger(config.fabric);
  const ledger = new DemoLedger(config.demoLedgerPath);
  if (config.demoAutoSeed) await seedDemoLedger(ledger);
  return ledger;
}
