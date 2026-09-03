const express = require('express'),
  path = require('path');
const { tower, shipment } = require('./data');
function createApp() {
  const app = express();
  app.use(express.json());
  const root = path.join(__dirname, '../frontend-php/public');
  app.use('/assets', express.static(path.join(root, 'assets')));
  app.get('/', (req, res) => res.sendFile(path.join(root, 'index.html')));
  app.get('/api/health', (req, res) =>
    res.json({ ok: true, mode: 'mock', service: 'lianyun-control-tower' }),
  );
  app.post('/api/auth/login', (req, res) =>
    res.json({
      ok: true,
      data: {
        accessToken: 'demo-token-' + (req.body.username || 'guest'),
        user: { name: '演示用户', role: 'CARRIER' },
      },
    }),
  );
  app.get('/api/shipments/:id/control-tower', (req, res) =>
    req.params.id === 'YT20260001'
      ? res.json({ ok: true, data: tower() })
      : res.status(404).json({ ok: false, message: '运单不存在' }),
  );
  app.get('/api/shipments/:id/map', (req, res) =>
    req.params.id === 'YT20260001'
      ? res.json({ ok: true, data: tower() })
      : res.status(404).json({ ok: false, message: '运单不存在' }),
  );
  app.get('/api/shipments/:id/risk-analysis', (req, res) =>
    req.params.id === 'YT20260001'
      ? res.json({ ok: true, data: tower().risks })
      : res.status(404).json({ ok: false, message: '运单不存在' }),
  );
  app.post('/api/shipments/:id/events', (req, res) => {
    if (req.params.id !== 'YT20260001')
      return res.status(404).json({ ok: false, message: '运单不存在' });
    const event = {
      id: 'evt-' + String(shipment.events.length + 1).padStart(3, '0'),
      type: req.body.type || 'IN_TRANSIT',
      hubCode: req.body.hubCode || 'WH-HUB-01',
      hubName: '武汉中转中心',
      actorOrg: 'Org2MSP',
      actorName: '当前操作员',
      remark: req.body.remark || '更新运输节点',
      at: new Date().toISOString(),
      txId: '0xmock' + Date.now().toString(16),
    };
    shipment.events.push(event);
    shipment.status = event.type;
    res.json({ ok: true, data: event });
  });
  return app;
}
if (require.main === module) {
  const port = process.env.PORT || 3100;
  createApp().listen(port, () => console.log('链运协同模拟演示：http://localhost:' + port));
}
module.exports = { createApp };
