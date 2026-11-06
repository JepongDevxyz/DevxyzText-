'use strict';
/**
 * DevxyzText backend — zero-dependency Node.js server.
 * Run:  node server.js
 * Env:  PORT (default 3000), DAILY_LIMIT (default 0 = unlimited),
 *       DATA_FILE (default ./data.json)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT || '0', 10);
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(__dirname, 'data.json');

// ---------------------------------------------------------------- storage
function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}
function newToken(prefix) {
  return prefix + crypto.randomBytes(24).toString('hex');
}

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (raw && Array.isArray(raw.apiKeys) && Array.isArray(raw.devices) && Array.isArray(raw.messages)) {
        return raw;
      }
    } catch (e) {
      console.error('Warning: data file unreadable, starting fresh:', e.message);
    }
  }
  return null;
}

let db = loadData();
let firstRunCreated = false;
if (!db) {
  db = { apiKeys: [], devices: [], messages: [], pairingCode: null };
  firstRunCreated = true;
}
if (!db.pairingCode) {
  db.pairingCode = String(crypto.randomInt(100000, 1000000)); // 6 digits
  firstRunCreated = true;
}
if (db.apiKeys.length === 0) {
  // Default API key, created on first run.
  db.apiKeys.push({
    id: newId('key'),
    key: newToken('sk-devxyz-'),
    label: 'default',
    createdAt: new Date().toISOString(),
  });
  firstRunCreated = true;
}

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
if (firstRunCreated) save();

// ---------------------------------------------------------------- time (Asia/Manila)
function manilaDateString(date) {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date || new Date());
}
function isTodayManila(isoString) {
  if (!isoString) return false;
  return manilaDateString(new Date(isoString)) === manilaDateString(new Date());
}
function todaysMessages() {
  return db.messages.filter((m) => isTodayManila(m.createdAt));
}

// ---------------------------------------------------------------- helpers
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, x-device-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}
function apiKeyFrom(req) {
  const key = req.headers['x-api-key'];
  if (!key) return null;
  return db.apiKeys.find((k) => k.key === key) || null;
}
function deviceFrom(req) {
  const token = req.headers['x-device-token'];
  if (!token) return null;
  return db.devices.find((d) => d.token === token) || null;
}
function publicMessage(m) {
  return {
    id: m.id, to: m.to, message: m.message, status: m.status,
    deviceId: m.deviceId || null, error: m.error || null,
    resultCode: m.resultCode != null ? m.resultCode : null,
    createdAt: m.createdAt, updatedAt: m.updatedAt, sentAt: m.sentAt || null,
  };
}
function quotaObject() {
  const todays = todaysMessages();
  const sent = todays.filter((m) => m.status === 'sent').length;
  const total = todays.length;
  return {
    date: manilaDateString(new Date()),
    timezone: 'Asia/Manila',
    today_count: total,
    todayCount: total,
    sent_today: sent,
    sentToday: sent,
    pending_today: todays.filter((m) => m.status === 'pending' || m.status === 'picked').length,
    daily_limit: DAILY_LIMIT,
    dailyLimit: DAILY_LIMIT,
    remaining: DAILY_LIMIT > 0 ? Math.max(0, DAILY_LIMIT - total) : null,
  };
}

// ---------------------------------------------------------------- dashboard (single page)
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DevxyzText Dashboard</title>
<style>
  :root{--bg:#f8f8f8;--card:#ffffff;--ink:#16181d;--line:#e3e5e8;--muted:#6b7280;--accent:#2563eb;--chip:#eef2ff}
  @media (prefers-color-scheme: dark){:root{--bg:#0e0e10;--card:#1a1a1e;--ink:#f3f4f6;--line:#2c2c31;--muted:#9ca3af;--accent:#60a5fa;--chip:#23232a}}
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
  .wrap{max-width:860px;margin:0 auto;padding:20px 16px 40px}
  h1{font-size:22px;margin:4px 0 2px} .sub{color:var(--muted);font-size:13px;margin-bottom:16px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:14px}
  .card h2{font-size:15px;margin:0 0 10px}
  .kv{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}
  code{background:var(--chip);padding:3px 8px;border-radius:8px;font-size:13px;word-break:break-all}
  label{font-size:13px;color:var(--muted);display:block;margin:10px 0 4px}
  input,textarea{width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);font-size:14px}
  button{background:var(--accent);color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:14px;cursor:pointer}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{border-bottom:1px solid var(--line);padding:7px 6px;text-align:left;vertical-align:top}
  .pill{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--chip);font-size:12px}
  .muted{color:var(--muted)} #toast{min-height:20px;font-size:13px;margin-top:8px}
</style>
</head>
<body>
<div class="wrap">
  <h1>DevxyzText</h1>
  <div class="sub">Own-SIM SMS gateway &middot; Powered by Jepong Devxyz</div>

  <div class="card">
    <h2>Credentials</h2>
    <div class="kv"><span class="muted">API key:</span> <code id="apiKey">loading…</code></div>
    <div class="kv"><span class="muted">Pairing code:</span> <code id="pairingCode">loading…</code></div>
    <div class="kv"><span class="muted">Device:</span> <span id="deviceInfo" class="muted">—</span></div>
    <div class="kv"><span class="muted">Today (Asia/Manila):</span> <span id="todayCount">0</span> <span class="muted">sent:</span> <span id="sentCount">0</span></div>
  </div>

  <div class="card">
    <h2>Send test SMS</h2>
    <label for="to">To (e.g. 09171234567 or +639171234567)</label>
    <input id="to" placeholder="09xxxxxxxxx">
    <label for="msg">Message</label>
    <textarea id="msg" rows="3" placeholder="Hello from DevxyzText"></textarea>
    <div style="margin-top:12px"><button id="sendBtn" type="button">Send</button></div>
    <div id="toast"></div>
  </div>

  <div class="card">
    <h2>Message history</h2>
    <table>
      <thead><tr><th>Time</th><th>To</th><th>Message</th><th>Status</th></tr></thead>
      <tbody id="rows"><tr><td colspan="4" class="muted">No messages yet.</td></tr></tbody>
    </table>
  </div>
</div>
<script>
var API_KEY = '';
function toast(t){ document.getElementById('toast').textContent = t; }
function refreshInfo(){
  fetch('/api/dashboard-info').then(function(r){return r.json();}).then(function(d){
    API_KEY = d.apiKey || '';
    document.getElementById('apiKey').textContent = API_KEY || '—';
    document.getElementById('pairingCode').textContent = d.pairingCode || '—';
    var dev = (d.devices && d.devices[0]) ? d.devices[0] : null;
    document.getElementById('deviceInfo').textContent = dev
      ? (dev.name + ' · last seen ' + (dev.lastSeen || 'never')) : 'no device paired yet';
    if (d.quota){
      document.getElementById('todayCount').textContent = d.quota.today_count;
      document.getElementById('sentCount').textContent = d.quota.sent_today;
    }
  }).catch(function(){});
}
function refreshMessages(){
  if (!API_KEY) return;
  fetch('/api/messages', {headers:{'x-api-key':API_KEY}}).then(function(r){return r.json();}).then(function(d){
    var rows = document.getElementById('rows');
    var list = d.messages || [];
    if (!list.length){ rows.innerHTML = '<tr><td colspan="4" class="muted">No messages yet.</td></tr>'; return; }
    rows.innerHTML = list.map(function(m){
      return '<tr><td>' + m.createdAt + '</td><td>' + m.to + '</td><td>' + String(m.message).replace(/</g,'&lt;') + '</td><td><span class="pill">' + m.status + '</span></td></tr>';
    }).join('');
  }).catch(function(){});
}
document.getElementById('sendBtn').addEventListener('click', function(){
  var to = document.getElementById('to').value.trim();
  var message = document.getElementById('msg').value;
  if (!to || !message){ toast('Fill in To and Message first.'); return; }
  fetch('/api/send', {method:'POST', headers:{'Content-Type':'application/json','x-api-key':API_KEY}, body: JSON.stringify({to:to, message:message})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok, j:j};});})
    .then(function(x){ toast(x.ok ? ('Queued: ' + x.j.id) : ('Error: ' + (x.j.error || 'send failed'))); refreshMessages(); refreshInfo(); })
    .catch(function(e){ toast('Error: ' + e.message); });
});
refreshInfo();
setInterval(function(){ refreshInfo(); refreshMessages(); }, 3000);
setTimeout(refreshMessages, 800);
</script>
</body>
</html>`;

// ---------------------------------------------------------------- routes
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') { sendJson(res, 204, {}); return; }

  try {
    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DASHBOARD_HTML);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'devxyztext' });
      return;
    }

    // Local/trusted dashboard bootstrap: exposes the default API key + pairing
    // code so the single-page dashboard (same origin) can work without login.
    // Do NOT expose this server publicly without putting auth in front of it.
    if (req.method === 'GET' && pathname === '/api/dashboard-info') {
      sendJson(res, 200, {
        apiKey: db.apiKeys[0] ? db.apiKeys[0].key : null,
        pairingCode: db.pairingCode,
        devices: db.devices.map((d) => ({
          id: d.id, name: d.name, lastSeen: d.lastSeen, createdAt: d.createdAt,
        })),
        quota: quotaObject(),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/devices/pair') {
      const body = await readBody(req);
      const code = body.code != null ? String(body.code) : (body.pairingCode != null ? String(body.pairingCode) : '');
      if (!code || code !== db.pairingCode) {
        sendJson(res, 401, { error: 'invalid_pairing_code' });
        return;
      }
      const device = {
        id: newId('dev'),
        token: newToken('dt-'),
        name: body.name ? String(body.name) : 'Android Gateway',
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      db.devices.push(device);
      save();
      sendJson(res, 201, {
        device_id: device.id,
        deviceId: device.id,
        device_token: device.token,
        deviceToken: device.token,
        api_key: db.apiKeys[0] ? db.apiKeys[0].key : null,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/send') {
      const keyRec = apiKeyFrom(req);
      if (!keyRec) { sendJson(res, 401, { error: 'invalid_api_key' }); return; }
      const body = await readBody(req);
      const to = body.to != null ? String(body.to).trim() : '';
      const message = body.message != null ? String(body.message) : '';
      if (!to || !message) { sendJson(res, 400, { error: 'to_and_message_required' }); return; }
      if (DAILY_LIMIT > 0 && todaysMessages().length >= DAILY_LIMIT) {
        sendJson(res, 429, { error: 'daily_limit_reached', quota: quotaObject() });
        return;
      }
      const msg = {
        id: newId('msg'), to, message, status: 'pending',
        deviceId: null, error: null, resultCode: null, apiKeyId: keyRec.id,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sentAt: null,
      };
      db.messages.push(msg);
      save();
      sendJson(res, 201, publicMessage(msg));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/device/jobs') {
      const device = deviceFrom(req);
      if (!device) { sendJson(res, 401, { error: 'invalid_device_token' }); return; }
      device.lastSeen = new Date().toISOString();
      const now = new Date().toISOString();
      const pending = db.messages.filter((m) => m.status === 'pending');
      pending.forEach((m) => { m.status = 'picked'; m.deviceId = device.id; m.updatedAt = now; });
      save();
      sendJson(res, 200, {
        jobs: pending.map((m) => ({ id: m.id, to: m.to, message: m.message })),
      });
      return;
    }

    const statusMatch = pathname.match(/^\/api\/device\/jobs\/([^/]+)\/status$/);
    if (req.method === 'POST' && statusMatch) {
      const device = deviceFrom(req);
      if (!device) { sendJson(res, 401, { error: 'invalid_device_token' }); return; }
      const msg = db.messages.find((m) => m.id === decodeURIComponent(statusMatch[1]));
      if (!msg) { sendJson(res, 404, { error: 'message_not_found' }); return; }
      const body = await readBody(req);
      const status = body.status === 'sent' ? 'sent' : 'failed';
      msg.status = status;
      msg.deviceId = device.id;
      msg.error = body.error != null ? String(body.error) : null;
      msg.resultCode = body.resultCode != null ? body.resultCode : (body.result_code != null ? body.result_code : null);
      msg.updatedAt = new Date().toISOString();
      if (status === 'sent') msg.sentAt = msg.updatedAt;
      device.lastSeen = msg.updatedAt;
      save();
      sendJson(res, 200, publicMessage(msg));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/messages') {
      const keyRec = apiKeyFrom(req);
      if (!keyRec) { sendJson(res, 401, { error: 'invalid_api_key' }); return; }
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500);
      const list = db.messages.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
      sendJson(res, 200, { messages: list.map(publicMessage) });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/quota') {
      const keyRec = apiKeyFrom(req);
      const device = deviceFrom(req);
      if (!keyRec && !device) { sendJson(res, 401, { error: 'auth_required' }); return; }
      sendJson(res, 200, quotaObject());
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('DevxyzText server listening on http://localhost:' + PORT);
    console.log('Dashboard:        http://localhost:' + PORT + '/');
    console.log('Pairing code:     ' + db.pairingCode + '   (enter this in the Android app)');
    console.log('Default API key:  ' + (db.apiKeys[0] ? db.apiKeys[0].key : '(none)'));
    console.log('Daily limit:      ' + (DAILY_LIMIT > 0 ? String(DAILY_LIMIT) : 'unlimited (DAILY_LIMIT=0)'));
    console.log('Data file:        ' + DATA_FILE);
  });
}

module.exports = server;
