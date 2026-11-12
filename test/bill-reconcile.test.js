'use strict';
// Boots the real server on a temp DB holding the bill shapes seen in production,
// restarts it so the startup reconcile runs, and checks which bills end up paid.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Database = require('better-sqlite3');

const PORT = 7800 + Math.floor(Math.random() * 90);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kith-bill-'));
let server, log = '';

async function boot() {
  server = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR }, cwd: path.join(__dirname, '..') });
  server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
  for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT}/api/auth/setup-status`); return; } catch { await new Promise(r => setTimeout(r, 200)); } }
  throw new Error('server did not start\n' + log);
}
const stop = () => new Promise(r => { server.once('exit', r); server.kill(); });
after(async () => { if (server && server.exitCode === null) await stop(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

test('unmatched payment emails close bills by name; autopay bills close after their due day', async () => {
  await boot(); await stop(); // first boot creates the schema
  const db = new Database(path.join(DATA_DIR, 'kith.db'));
  const add = db.prepare('INSERT INTO bills (name,amount,due_day,due_date,recurrence,autopay) VALUES (?,?,?,?,?,?)');
  const gas = add.run('Georgia Natural Gas', 134.17, 21, '', 'monthly', 0).lastInsertRowid;
  const affirm = add.run('Affirm', 61.72, 17, '', 'monthly', 0).lastInsertRowid;
  const lifx = add.run('Affirm - LIFX Smart Lighting', 102.58, 20, '', 'monthly', 0).lastInsertRowid;
  const att = add.run('AT&T', 115.8, 11, '', 'monthly', 0).lastInsertRowid;
  const mortgage = add.run('Rocket Mortgage', 0, 1, '', 'monthly', 1).lastInsertRowid;
  const lateAuto = add.run('Late Autopay', 0, 28, '', 'monthly', 1).lastInsertRowid;
  const untouched = add.run('Discover', 404, 18, '', 'monthly', 0).lastInsertRowid;
  const u = db.prepare("INSERT INTO unmatched_confirmations (type,subject,detail,created_at) VALUES ('payment',?,?,?)");
  const thisMonth = new Date().toISOString().slice(0, 7);
  const lastMonthDate = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d; })();
  const lastMonth = lastMonthDate.toISOString().slice(0, 7);
  u.run('Payment Processed for Georgia Natural Gas', 'Payment Processed for Georgia Natural Gas', `${lastMonth}-15 12:00:00`);
  u.run('Thank you for your payment', 'Affirm - LIFX Smart Lighting — $102.58', `${thisMonth}-01 12:00:00`);
  u.run('Your AT&amp;T payment was received', '', `${thisMonth}-01 12:00:00`);
  const generic = u.run('Payment received', 'Payment received', `${thisMonth}-01 12:00:00`).lastInsertRowid;
  db.close();

  await boot(); await stop();
  const db2 = new Database(path.join(DATA_DIR, 'kith.db'), { readonly: true });
  const periods = id => db2.prepare('SELECT period FROM bill_payments WHERE bill_id=?').all(id).map(r => r.period);
  assert.deepEqual(periods(gas), [lastMonth], 'paid in the month the email arrived');
  assert.deepEqual([periods(lifx), periods(affirm)], [[thisMonth], []], 'the longer, more specific bill name wins');
  assert.deepEqual(periods(att), [thisMonth], 'HTML codes in the subject still match');
  assert.deepEqual(periods(mortgage), [thisMonth], 'autopay bill past its due day is paid');
  const day = new Date().getDate();
  assert.deepEqual(periods(lateAuto), day >= 28 ? [thisMonth] : [], 'autopay bill before its due day stays open');
  assert.deepEqual(periods(untouched), [], 'bills with no email and no autopay stay open');
  const left = db2.prepare("SELECT id FROM unmatched_confirmations WHERE type='payment'").all().map(r => r.id);
  assert.deepEqual(left, [generic], 'matched emails leave Needs Review; the nameless one stays');
  db2.close();
  assert.match(log, /\[bills\] reconciled \d+ payment\(s\)/);
});
