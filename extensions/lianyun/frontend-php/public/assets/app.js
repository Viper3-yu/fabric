const API = '/api';
let map,
  nodeMarkers = [],
  segmentLayers = [];

const eventNames = {
  CREATED: '创建运单',
  ACCEPTED: '承运接单',
  HANDOVER_CONFIRMED: '交接确认',
  EXCEPTION: '运输异常',
  EXCEPTION_RESOLVED: '异常解除',
  IN_TRANSIT: '干线运输',
  ARRIVED_HUB: '到达网点',
};
const statusNames = {
  IN_TRANSIT: '运输中',
  EXCEPTION: '运输异常',
  DELIVERED: '已签收',
  ACCEPTED: '待揽收',
};
const $ = (s) => document.querySelector(s);
const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>'"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch],
  );

function point(lat, lng, label, status) {
  return L.marker([lat, lng], {
    icon: L.divIcon({
      className: 'hub-marker',
      html:
        '<span style="display:block;width:12px;height:12px;border:3px solid #fff;border-radius:50%;background:' +
        status +
        ';box-shadow:0 1px 4px #355;"> </span>',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    }),
  }).bindTooltip(label, { direction: 'top' });
}
function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView([34.5, 116.5], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 12,
    attribution: '© OpenStreetMap',
  }).addTo(map);
}
function color(status) {
  return (
    { NORMAL: '#16794c', EXCEPTION: '#b42318', IN_TRANSIT: '#1866c0', PLANNED: '#a8b2be' }[
      status
    ] || '#a8b2be'
  );
}
function drawMap(data) {
  nodeMarkers.forEach((x) => map.removeLayer(x));
  segmentLayers.forEach((x) => map.removeLayer(x));
  nodeMarkers = [];
  segmentLayers = [];
  const bounds = [];
  data.segments.forEach((seg) => {
    const coords = [
      [seg.fromHub.latitude, seg.fromHub.longitude],
      [seg.toHub.latitude, seg.toHub.longitude],
    ];
    const l = L.polyline(coords, {
      color: color(seg.status),
      weight: 5,
      opacity: seg.status === 'PLANNED' ? 0.65 : 0.9,
      dashArray: seg.status === 'PLANNED' ? '8 7' : null,
    }).addTo(map);
    l.on('click', () => selectSegment(seg, data));
    segmentLayers.push(l);
    bounds.push(...coords);
  });
  data.hubs.forEach((h) => {
    const m = point(h.latitude, h.longitude, h.name, '#1866c0').addTo(map);
    m.on('click', () => selectHub(h, data));
    nodeMarkers.push(m);
  });
  if (bounds.length) map.fitBounds(bounds, { padding: [44, 44] });
}
function selectSegment(seg, data) {
  $('#mapHint').textContent =
    seg.fromHub.name +
    ' → ' +
    seg.toHub.name +
    ' · ' +
    { NORMAL: '正常完成', EXCEPTION: '存在异常', IN_TRANSIT: '运输中', PLANNED: '计划未开始' }[
      seg.status
    ];
  const risk = data.risks.find((r) => r.segmentId === seg.id);
  if (risk) selectRisk(risk, data);
  else {
    $('#evidenceTitle').textContent = '该运输段无风险记录';
    $('#evidenceTx').textContent = 'Tx --';
    $('#evidenceHash').textContent = 'Hash --';
  }
}
function selectHub(h, data) {
  $('#mapHint').textContent = h.name + ' · ' + h.city + ' · ' + h.type;
  const event = [...data.shipment.events].reverse().find((e) => e.hubCode === h.code);
  if (event) showEvidence(event);
}
function showEvidence(event) {
  $('#evidenceTitle').textContent = eventNames[event.type] || event.type + ' · ' + event.hubName;
  $('#evidenceTx').textContent = 'Tx ' + event.txId;
  $('#evidenceHash').textContent = 'Hash ' + (event.evidenceHash || '链上事件未附文件哈希');
}
function selectRisk(risk, data) {
  const el = [...document.querySelectorAll('.risk-item')].find((x) => x.dataset.id === risk.id);
  if (el) {
    document.querySelectorAll('.risk-item').forEach((x) => (x.style.background = ''));
    el.style.background = '#f3f7fb';
  }
  const event = data.shipment.events.find((e) => e.id === risk.relatedEventId);
  if (event) showEvidence(event);
  else {
    $('#evidenceTitle').textContent = risk.title;
    $('#evidenceTx').textContent = '风险规则：' + risk.type;
    $('#evidenceHash').textContent = '状态：' + risk.status;
  }
}
function renderRisks(data) {
  const host = $('#riskList');
  host.innerHTML = '';
  data.risks.forEach((r) => {
    const t = $('#riskTemplate').content.cloneNode(true);
    const el = t.querySelector('.risk-item');
    el.dataset.id = r.id;
    el.querySelector('.risk-level').classList.add(r.level.toLowerCase());
    el.querySelector('b').textContent = r.title;
    el.querySelector('p').textContent = r.description;
    el.querySelector('small').textContent =
      '状态：' + (r.status === 'RESOLVED' ? '已处理' : '待处理');
    el.onclick = () => selectRisk(r, data);
    host.append(t);
  });
}
function renderTimeline(events) {
  const host = $('#timeline');
  host.innerHTML = [...events]
    .reverse()
    .map(
      (e) =>
        '<article class="event ' +
        (e.type === 'EXCEPTION' ? 'exception' : '') +
        '"><b>' +
        escapeHTML(eventNames[e.type] || e.type) +
        ' · ' +
        escapeHTML(e.hubName || e.hubCode) +
        '</b><p>' +
        escapeHTML(e.remark) +
        '</p><small>' +
        escapeHTML(new Date(e.at).toLocaleString()) +
        '　' +
        escapeHTML(e.actorOrg) +
        '　' +
        escapeHTML(e.txId) +
        '</small></article>',
    )
    .join('');
}
function renderParcels(parcels) {
  $('#parcelTable').innerHTML = parcels
    .map(
      (p) =>
        '<tr><td>' +
        escapeHTML(p.id) +
        '</td><td>' +
        escapeHTML(p.unitId || '未装箱') +
        '</td><td class="status-cell">' +
        escapeHTML(p.status) +
        '</td><td><button class="text-button" data-parcel="' +
        escapeHTML(p.id) +
        '">追溯包裹</button></td></tr>',
    )
    .join('');
}
function drawTemp(data) {
  const svg = $('#tempChart'),
    points = data.temperature,
    min = 0,
    max = 14,
    w = 520,
    h = 178,
    pad = { l: 34, r: 12, t: 16, b: 30 };
  const x = (i) => pad.l + (i * (w - pad.l - pad.r)) / (points.length - 1),
    y = (v) => pad.t + ((max - v) * (h - pad.t - pad.b)) / (max - min);
  let html =
    '<line x1="' +
    pad.l +
    '" x2="' +
    (w - pad.r) +
    '" y1="' +
    y(data.temperatureRange.max) +
    '" y2="' +
    y(data.temperatureRange.max) +
    '" stroke="#b7791f" stroke-dasharray="4 4"/><text x="' +
    pad.l +
    '" y="' +
    (y(data.temperatureRange.max) - 5) +
    '" fill="#718196" font-size="10">上限 ' +
    data.temperatureRange.max +
    '℃</text>';
  html +=
    '<polyline fill="none" stroke="#1866c0" stroke-width="2.5" points="' +
    points.map((p, i) => x(i) + ',' + y(p.value)).join(' ') +
    '"/>';
  points.forEach(
    (p, i) =>
      (html +=
        '<circle cx="' +
        x(i) +
        '" cy="' +
        y(p.value) +
        '" r="3.5" fill="' +
        (p.value > data.temperatureRange.max ? '#b42318' : '#1866c0') +
        '"><title>' +
        p.at +
        ' ' +
        p.value +
        '℃</title></circle><text x="' +
        x(i) +
        '" y="' +
        (h - 9) +
        '" text-anchor="middle" fill="#718196" font-size="10">' +
        new Date(p.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
        '</text>'),
  );
  svg.innerHTML = html;
  $('#currentTemp').textContent = points.at(-1).value + '℃';
  $('#tempRange').textContent = data.temperatureRange.min + ' - ' + data.temperatureRange.max + '℃';
}
async function load(id) {
  try {
    const r = await fetch(API + '/shipments/' + encodeURIComponent(id) + '/control-tower');
    const j = await r.json();
    if (!j.ok) throw Error(j.message);
    const d = j.data;
    $('#shipmentLabel').textContent = d.shipment.id;
    $('#routeLabel').textContent = d.shipment.origin + ' → ' + d.shipment.destination;
    $('#shipmentStatus').textContent = statusNames[d.shipment.status] || d.shipment.status;
    $('#updatedAt').textContent = '数据更新时间 ' + new Date().toLocaleString();
    drawMap(d);
    renderRisks(d);
    renderTimeline(d.shipment.events);
    renderParcels(d.shipment.parcels);
    drawTemp(d);
    $('#mapHint').textContent = '已加载 ' + d.segments.length + ' 个运输段；红色路线表示异常处理段';
  } catch (e) {
    $('#riskList').innerHTML = '<p style="padding:12px;color:#b42318">' + e.message + '</p>';
  }
}
async function checkHealth() {
  try {
    const r = await fetch(API + '/health');
    const j = await r.json();
    if (!j.ok) throw Error('服务异常');
    const fabric = j.mode === 'fabric';
    $('#serviceMode').textContent = fabric ? 'Fabric 网络已连接' : '模拟账本模式';
    $('#serviceDetail').textContent = fabric ? 'Org1MSP · logisticschannel' : '未连接真实 Fabric';
    if (!fabric) $('#serviceDot').style.background = '#b7791f';
  } catch (e) {
    $('#serviceMode').textContent = 'API 未连接';
    $('#serviceDetail').textContent = e.message;
    $('#serviceDot').style.background = '#b42318';
  }
}
$('#shipmentForm').onsubmit = (e) => {
  e.preventDefault();
  load($('#shipmentId').value.trim());
};
$('#refreshBtn').onclick = () => {
  checkHealth();
  load($('#shipmentId').value.trim());
};
$('#showAllEvents').onclick = () =>
  document.querySelector('.timeline').scrollIntoView({ behavior: 'smooth' });
initMap();
checkHealth();
load('YT20260001');
