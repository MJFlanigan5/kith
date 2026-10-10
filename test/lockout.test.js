'use strict';
// End-to-end test of per-account PIN lockout: boots the real server on a temp DB.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Database = require('better-sqlite3');

const PORT = 7600 + Math.floor(Math.random() * 300);
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kith-lock-'));
let server, log = '', adminToken, ipCounter = 0;

// Each request gets its own fake client IP so the pre-existing per-IP limiter never
// interferes — these tests are about the per-ACCOUNT lock.
async function api(method, url, body, token) {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
}
const memberLogin = (id, pin) => api('POST', '/api/auth/login', { member_id: id, pin });
const adminLogin = pin => api('POST', '/api/auth/admin', { pin });
const db = () => new Database(path.join(DATA_DIR, 'kith.db'));
async function newMember(name, pin) {
  const m = await api('POST', '/api/members', { name, color: '#007AFF' }, adminToken);
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.equal((await api('PUT', `/api/members/${m.body.id}/pin`, { pin }, adminToken)).status, 200);
  return m.body.id;
}

before(async () => {
  server = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR }, cwd: path.join(__dirname, '..') });
  server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/auth/setup-status'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  assert.equal((await api('POST', '/api/auth/setup', { pin: '1234' })).status, 400, 'admin PIN under 6 digits must be refused');
  const s = await api('POST', '/api/auth/setup', { pin: '482915' });
  assert.equal(s.status, 200); adminToken = s.body.token;
});
after(() => { server.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

test('5 wrong PINs lock the account; correct PIN is refused while locked; others unaffected', async () => {
  const alice = await newMember('Alice', '1111'), bob = await newMember('Bob', '2222');
  for (let i = 1; i <= 4; i++) assert.deepEqual([(await memberLogin(alice, '0000')).status, 'wrong'], [401, 'wrong']);
  const fifth = await memberLogin(alice, '0000');
  assert.equal(fifth.status, 429); assert.match(fifth.body.error, /locked for 5 more minutes/);
  assert.equal(fifth.headers.get('retry-after'), '300');
  const correctWhileLocked = await memberLogin(alice, '1111');
  assert.equal(correctWhileLocked.status, 429);
  assert.equal((await memberLogin(bob, '2222')).status, 200, 'other members unaffected');
  assert.equal((await adminLogin('482915')).status, 200, 'admin unaffected');
  assert.match(log, /\[auth\] Alice PIN locked for 5 min/, 'lock must be logged/notified');
});

test('a correct PIN resets the failure counter', async () => {
  const carol = await newMember('Carol', '3333');
  for (let i = 0; i < 3; i++) await memberLogin(carol, '0000');
  assert.equal((await memberLogin(carol, '3333')).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await memberLogin(carol, '0000')).status, 401);
  assert.equal((await memberLogin(carol, '3333')).status, 200, 'only 4 fails since reset -> not locked');
});

test('parallel guesses cannot beat the lock', async () => {
  const dan = await newMember('Dan', '4444');
  const results = await Promise.all(Array.from({ length: 25 }, () => memberLogin(dan, '0000')));
  const compared = results.filter(r => r.status === 401).length;
  assert.ok(compared <= 4, `only attempts 1-4 may answer 401, got ${compared}`);
  assert.ok(results.every(r => r.status === 401 || r.status === 429));
  assert.equal((await memberLogin(dan, '4444')).status, 429);
});

test('lock expires, then the next lock is twice as long; success clears strikes', async () => {
  const eve = await newMember('Eve', '5555');
  for (let i = 0; i < 5; i++) await memberLogin(eve, '0000');
  const d = db(); d.prepare('UPDATE login_failures SET locked_until=? WHERE key=?').run(Date.now() - 1, `member:${eve}`);
  for (let i = 0; i < 4; i++) assert.equal((await memberLogin(eve, '0000')).status, 401);
  const second = await memberLogin(eve, '0000');
  assert.equal(second.status, 429); assert.match(second.body.error, /locked for 10 more minutes/);
  d.prepare('UPDATE login_failures SET locked_until=? WHERE key=?').run(Date.now() - 1, `member:${eve}`);
  assert.equal((await memberLogin(eve, '5555')).status, 200);
  assert.equal(d.prepare('SELECT COUNT(*) c FROM login_failures WHERE key=?').get(`member:${eve}`).c, 0);
  d.close();
});

test('admin resetting a member PIN lifts the lock', async () => {
  const fay = await newMember('Fay', '6666');
  for (let i = 0; i < 5; i++) await memberLogin(fay, '0000');
  assert.equal((await memberLogin(fay, '6666')).status, 429);
  await api('PUT', `/api/members/${fay}/pin`, { pin: '7777' }, adminToken);
  assert.equal((await memberLogin(fay, '7777')).status, 200);
});

test('admin account locks too, and an unknown member id is not tracked', async () => {
  for (let i = 0; i < 5; i++) await adminLogin('000000');
  const locked = await adminLogin('482915');
  assert.equal(locked.status, 429);
  const d = db();
  d.prepare('DELETE FROM login_failures WHERE key=?').run('admin'); d.close();
  assert.equal((await adminLogin('482915')).status, 200);
  assert.equal((await memberLogin(99999, '0000')).status, 401);
  const d2 = db(); assert.equal(d2.prepare("SELECT COUNT(*) c FROM login_failures WHERE key='member:99999'").get().c, 0); d2.close();
});
