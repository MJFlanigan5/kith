'use strict';
// Photos are served behind a short-lived photo-only token; the login JWT never goes in a URL.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const PORT = 7900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kith-photo-'));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let server, login, filename;

const call = (url, opts = {}) => fetch(BASE + url, opts);
const authed = (token, extra = {}) => ({ headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...extra });

before(async () => {
  server = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR }, cwd: path.join(__dirname, '..') });
  for (let i = 0; i < 50; i++) { try { await call('/api/auth/setup-status'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  login = (await (await call('/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '482915' }) })).json()).token;
  const up = await call('/api/photos', authed(login, { method: 'POST', body: JSON.stringify({ filename: 'a.png', data: PNG }) }));
  filename = (await up.json()).filename;
});
after(() => { server.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

const secret = () => { const d = new Database(path.join(DATA_DIR, 'kith.db')); const v = d.prepare("SELECT value FROM settings WHERE key='jwt_secret'").get().value; d.close(); return v; };

test('token endpoint requires login and returns a 1h photo-scoped JWT', async () => {
  assert.equal((await call('/api/photos/token')).status, 401);
  const r = await (await call('/api/photos/token', authed(login))).json();
  assert.equal(r.expires_in, 3600);
  const claims = jwt.verify(r.token, secret());
  assert.equal(claims.typ, 'photo');
  assert.ok(claims.exp - claims.iat <= 3600);
  assert.equal(claims.role, undefined, 'photo token carries no role/identity claims');
});

test('photo token fetches the photo; nosniff + image type', async () => {
  const { token } = await (await call('/api/photos/token', authed(login))).json();
  const r = await call(`/photos/${filename}?t=${token}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('login JWT, missing, garbage, expired and wrong-secret tokens are all refused for photos', async () => {
  assert.equal((await call(`/photos/${filename}`)).status, 401);
  assert.equal((await call(`/photos/${filename}?t=garbage`)).status, 401);
  assert.equal((await call(`/photos/${filename}?t=${login}`)).status, 401, 'the 30-day login token must not work in a URL');
  const expired = jwt.sign({ typ: 'photo' }, secret(), { expiresIn: -10 });
  assert.equal((await call(`/photos/${filename}?t=${expired}`)).status, 401);
  const forged = jwt.sign({ typ: 'photo' }, 'x'.repeat(64), { expiresIn: '1h' });
  assert.equal((await call(`/photos/${filename}?t=${forged}`)).status, 401);
});

test('a leaked photo token cannot be used against the API or the event stream', async () => {
  const { token } = await (await call('/api/photos/token', authed(login))).json();
  for (const url of ['/api/auth/me', '/api/events', '/api/members', '/api/chores']) {
    assert.equal((await call(url, authed(token))).status, 401, `photo token must not authenticate ${url}`);
  }
  assert.equal((await call(`/api/events/stream?token=${token}`)).status, 401);
});

test('legacy non-image files stay unservable even with a valid photo token', async () => {
  fs.writeFileSync(path.join(DATA_DIR, 'photos', 'planted.html'), '<script>1</script>');
  const { token } = await (await call('/api/photos/token', authed(login))).json();
  assert.equal((await call(`/photos/planted.html?t=${token}`)).status, 404);
});
