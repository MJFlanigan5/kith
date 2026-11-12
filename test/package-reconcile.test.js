'use strict';
// Boots the real server on a temp DB holding the stuck-package shapes seen in production,
// restarts it so the startup repair runs, and checks which rows end up delivered.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Database = require('better-sqlite3');

const PORT = 7900 + Math.floor(Math.random() * 90);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kith-pkg-'));
let server, log = '';

async function boot() {
  server = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR }, cwd: path.join(__dirname, '..') });
  server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
  for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT}/api/auth/setup-status`); return; } catch { await new Promise(r => setTimeout(r, 200)); } }
  throw new Error('server did not start\n' + log);
}
const stop = () => new Promise(r => { server.once('exit', r); server.kill(); });
after(async () => { if (server && server.exitCode === null) await stop(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

test('startup repair closes delivered Amazon packages and leaves real in-transit ones', async () => {
  await boot(); await stop(); // first boot creates the schema
  const db = new Database(path.join(DATA_DIR, 'kith.db'));
  const add = db.prepare('INSERT INTO packages (carrier,tracking_number,description,expected_date,source_subject) VALUES (?,?,?,?,?)');
  const shipped = add.run('Amazon', '', 'Memory Cards', '', 'Shipped 2 items: Memory Cards, Electrical').lastInsertRowid;
  const delivered = add.run('Amazon', '', 'Memory Cards', '', 'Delivered 2 items: Memory Cards, Electrical').lastInsertRowid;
  const outFor = add.run('Amazon', '', 'Paint', '', 'Out for delivery 1 item: Painting Supplies').lastInsertRowid;
  const paintDone = add.run('Amazon', '', 'Paint', '', 'Delivered 1 item: Painting Supplies').lastInsertRowid;
  const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const inTransit = add.run('Amazon', '', 'Arts', day(0), 'Shipped 1 item: Arts & Crafts').lastInsertRowid;
  const usps = add.run('USPS', '9400150105798136398140', 'Stamps', day(1), 'USPS Expected Delivery on Friday').lastInsertRowid;
  const ebay = add.run('other', '', 'Seagate', '', 'OUT FOR DELIVERY: Seagate SkyHawk 4TB ...').lastInsertRowid;
  const longPast = add.run('USPS', '9434608106245724946761', 'Old', day(-10), 'USPS Expected Delivery on Friday, October 30').lastInsertRowid;
  const undatedOld = add.run('UPS', '1Z4337241321871705', 'Debit Card', '', 'Your Debit Card has Shipped').lastInsertRowid;
  const latexOld = add.run('Amazon', '', 'Latex', '', 'Delay in shipping: Latex Sealants').lastInsertRowid;
  const latexNew = add.run('Amazon', '', 'Latex', '', 'Shipped 1 item: Latex Sealants').lastInsertRowid;
  db.prepare("UPDATE packages SET created_at=datetime('now','-1 days') WHERE id=?").run(latexOld);
  db.prepare("UPDATE packages SET created_at=datetime('now','-40 days') WHERE id=?").run(undatedOld);
  db.prepare("UPDATE packages SET created_at=datetime('now','-2 days') WHERE id=?").run(ebay);
  // delivery emails Kith couldn't match when they arrived: one after the eBay row, one before a new order
  db.prepare("INSERT INTO unmatched_confirmations (type,subject,detail,created_at) VALUES ('delivery','📦PACKAGE DELIVERED: Seagate SkyHawk 4TB ...','other',datetime('now','-1 days'))").run();
  db.prepare("INSERT INTO unmatched_confirmations (type,subject,detail,created_at) VALUES ('delivery','Delivered 1 item: Arts & Crafts','other',datetime('now','-30 days'))").run();
  db.close();

  await boot(); await stop();
  const db2 = new Database(path.join(DATA_DIR, 'kith.db'), { readonly: true });
  const state = id => db2.prepare('SELECT delivered FROM packages WHERE id=?').get(id).delivered;
  const status = id => db2.prepare('SELECT status FROM packages WHERE id=?').get(id).status;
  assert.deepEqual([shipped, delivered, outFor, paintDone].map(state), [1, 1, 1, 1], 'delivered notices and their shipped rows close');
  assert.equal(state(ebay), 1, 'an unmatched delivery email received later closes the package');
  assert.deepEqual([longPast, undatedOld].map(status), ['Assumed delivered', 'Assumed delivered'], 'quiet packages close');
  assert.deepEqual([status(latexOld), state(latexNew)], ['Duplicate', 0], 'older duplicate closes, newest stays');
  assert.deepEqual([inTransit, usps].map(state), [0, 0], 'current packages stay open, even with an older delivery email for the same item');
  db2.close();
  assert.match(log, /reconciled 8 package\(s\), 2 assumed delivered/);
});
