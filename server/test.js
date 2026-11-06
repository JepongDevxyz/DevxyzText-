'use strict';
/**
 * DevxyzText automated server test.
 * Boots the server on a test port with a throwaway data file, then:
 *   pair (simulated device) -> POST /api/send -> device polls jobs ->
 *   device posts status "sent" -> assert GET /api/messages + GET /api/quota.
 * Run:  node test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 31079;
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_FILE = path.join(os.tmpdir(), 'devxyztext-test-' + process.pid + '.json');

let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log('  PASS  ' + name);
  } else {
    failures++;
    console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : ''));
  }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function req(method, urlPath, headers, body) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch (e) { /* non-JSON */ }
  return { status: res.status, json };
}

async function waitForServer(proc) {
  for (let i = 0; i < 50; i++) {
    if (proc.exitCode !== null) throw new Error('server exited early with code ' + proc.exitCode);
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('server did not start in time');
}

async function main() {
  console.log('DevxyzText server test — booting on port ' + PORT + ' …');
  const proc = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATA_FILE, DAILY_LIMIT: '0',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  proc.stderr.on('data', (d) => process.stdout.write('[server-err] ' + d));

  try {
    await waitForServer(proc);
    check('server health endpoint responds', true);

    // 1) Discover pairing code + default API key (dashboard bootstrap endpoint)
    const info = await req('GET', '/api/dashboard-info');
    check('dashboard-info returns pairing code', info.status === 200 && !!info.json.pairingCode, JSON.stringify(info.json));
    check('dashboard-info returns default API key', info.status === 200 && !!info.json.apiKey);
    const pairingCode = info.json.pairingCode;
    const apiKey = info.json.apiKey;

    // 2) Pair a simulated device
    const pair = await req('POST', '/api/devices/pair', {}, { code: pairingCode, name: 'Simulated Device' });
    check('pair with correct code succeeds (201)', pair.status === 201, 'status=' + pair.status);
    const deviceToken = pair.json.device_token;
    check('pair returns a device token', !!deviceToken);

    const badPair = await req('POST', '/api/devices/pair', {}, { code: '000000-wrong' });
    check('pair with wrong code is rejected (401)', badPair.status === 401, 'status=' + badPair.status);

    // 3) Send an SMS via the API
    const badSend = await req('POST', '/api/send', { 'x-api-key': 'wrong-key' }, { to: '09171234567', message: 'hi' });
    check('send with wrong API key is rejected (401)', badSend.status === 401, 'status=' + badSend.status);

    const send = await req('POST', '/api/send', { 'x-api-key': apiKey }, {
      to: '09171234567', message: 'DevxyzText automated test message',
    });
    check('send with API key succeeds (201)', send.status === 201, 'status=' + send.status + ' ' + JSON.stringify(send.json));
    check('send returns status "pending"', send.json.status === 'pending', JSON.stringify(send.json));
    const messageId = send.json.id;
    check('send returns a message id', !!messageId);

    // 4) Device polls for jobs and picks the job up
    const jobs = await req('GET', '/api/device/jobs', { 'x-device-token': deviceToken });
    check('device poll succeeds (200)', jobs.status === 200, 'status=' + jobs.status);
    const job = (jobs.json.jobs || []).find((j) => j.id === messageId);
    check('polled jobs contain the queued message', !!job, JSON.stringify(jobs.json));
    check('job carries the right recipient + body', !!job && job.to === '09171234567' && job.message.indexOf('automated test') !== -1);

    const jobsAgain = await req('GET', '/api/device/jobs', { 'x-device-token': deviceToken });
    check('second poll is empty (job already picked, no duplicates)', (jobsAgain.json.jobs || []).length === 0, JSON.stringify(jobsAgain.json));

    // 5) Device reports the SMS as sent
    const status = await req('POST', '/api/device/jobs/' + messageId + '/status', { 'x-device-token': deviceToken }, { status: 'sent', resultCode: -1 });
    check('status callback succeeds (200)', status.status === 200, 'status=' + status.status);
    check('status callback marks message "sent"', status.json.status === 'sent', JSON.stringify(status.json));

    // 6) Assert message history + quota
    const messages = await req('GET', '/api/messages', { 'x-api-key': apiKey });
    const found = (messages.json.messages || []).find((m) => m.id === messageId);
    check('GET /api/messages lists the message', !!found, JSON.stringify(messages.json));
    check('listed message status is "sent"', !!found && found.status === 'sent');

    const quota = await req('GET', '/api/quota', { 'x-api-key': apiKey });
    check('GET /api/quota succeeds (200)', quota.status === 200, 'status=' + quota.status);
    check('quota today_count is 1', quota.json.today_count === 1, JSON.stringify(quota.json));
    check('quota sent_today is 1', quota.json.sent_today === 1, JSON.stringify(quota.json));
    check('quota timezone is Asia/Manila', quota.json.timezone === 'Asia/Manila', JSON.stringify(quota.json));
  } catch (err) {
    failures++;
    console.log('  FAIL  unexpected error: ' + err.message);
  } finally {
    proc.kill('SIGTERM');
    await sleep(300);
    try { fs.unlinkSync(DATA_FILE); } catch (e) { /* already gone */ }
  }

  console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main();
