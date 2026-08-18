// 将 seed 产出的演示账本固化为视觉测试夹具：
// 按出现顺序把所有 ISO 时间戳映射为固定值，保证截图逐字节可比。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../../tmp/visual-seed.json');
const target = resolve(here, 'fixtures/demo-ledger.json');

const stampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const base = Date.parse('2026-07-20T08:30:00.000Z');
const stepMs = 90_000;
const mapping = new Map();
let counter = 0;

function fixedStamp(value) {
  if (!mapping.has(value)) {
    mapping.set(value, new Date(base + counter * stepMs).toISOString().replace(/\.\d+Z$/, '.000Z'));
    counter += 1;
  }
  return mapping.get(value);
}

function freeze(value) {
  if (typeof value === 'string') return stampPattern.test(value) ? fixedStamp(value) : value;
  if (Array.isArray(value)) return value.map(freeze);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = freeze(item);
    return result;
  }
  return value;
}

const ledger = JSON.parse(readFileSync(source, 'utf8'));
const frozen = freeze(ledger);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(frozen, null, 2)}\n`, 'utf8');
console.log(`froze ${mapping.size} distinct timestamps (${counter} unique) into ${target}`);
