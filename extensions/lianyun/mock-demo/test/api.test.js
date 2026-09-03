const test = require('node:test'),
  assert = require('node:assert/strict');
const { createApp } = require('../server');
let srv, base;
test.before(async () => {
  srv = createApp().listen(0);
  await new Promise((r) => srv.once('listening', r));
  base = 'http://127.0.0.1:' + srv.address().port;
});
test.after(() => srv.close());
test('控制塔返回 GIS、风险与遥测数据', async () => {
  const r = await fetch(base + '/api/shipments/YT20260001/control-tower');
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.data.segments.length, 4);
  assert.equal(j.data.risks.length, 3);
  assert.equal(j.data.temperature.length, 5);
});
test('不存在的运单返回 404', async () => {
  const r = await fetch(base + '/api/shipments/NOPE/control-tower');
  assert.equal(r.status, 404);
});
test('可追加模拟链上事件', async () => {
  const r = await fetch(base + '/api/shipments/YT20260001/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'ARRIVED_HUB', remark: '到达北京分拨中心' }),
  });
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.data.type, 'ARRIVED_HUB');
});
