'use strict';
const express = require('express');
const path    = require('path');
const cron    = require('node-cron');
const webpush = require('web-push');
const db      = require('./db');

const app  = express();
const PORT = process.env.PORT || 7400;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── VAPID setup ───────────────────────────────────────────────────────────────
{
  let pub  = db.prepare('SELECT value FROM settings WHERE key=?').get('vapid_public')?.value;
  let priv = db.prepare('SELECT value FROM settings WHERE key=?').get('vapid_private')?.value;
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub  = keys.publicKey;
    priv = keys.privateKey;
    const upd = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
    upd.run('vapid_public',  pub);
    upd.run('vapid_private', priv);
  }
  webpush.setVapidDetails('mailto:hearth@local.home', pub, priv);
  app._vapidPublic = pub;
}

// ── ICS parser ────────────────────────────────────────────────────────────────
function parseICS(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const unfolded = [];
  for (const line of lines) {
    if ((line[0] === ' ' || line[0] === '\t') && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  const events = [];
  let inEvent = false, cur = {};
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT')      { inEvent = true; cur = {}; }
    else if (line === 'END:VEVENT')   { inEvent = false; if (cur.SUMMARY) events.push(cur); }
    else if (inEvent) {
      const ci = line.indexOf(':');
      if (ci === -1) continue;
      cur[line.slice(0, ci).split(';')[0].trim()] = line.slice(ci + 1).trim();
    }
  }
  return events.map(e => {
    const raw = (e.DTSTART || '').replace(/[^0-9]/g, '');
    let date = '', time = 'All day';
    if (raw.length >= 8) {
      date = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
      if (raw.length >= 14) {
        const h = parseInt(raw.slice(8,10));
        const m = raw.slice(10,12);
        const ampm = h >= 12 ? 'PM' : 'AM';
        time = `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${m} ${ampm}`;
      }
    }
    return { title: e.SUMMARY || 'Untitled', date, time, external_id: e.UID || null };
  }).filter(e => e.date);
}

// ── ICS sync helper ───────────────────────────────────────────────────────────
async function syncICSSource(source) {
  const text = await fetch(source.url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
  const events = parseICS(text);
  const cal = `ics:${source.name}`;
  db.prepare('DELETE FROM events WHERE source=?').run(`ics-${source.id}`);
  const ins = db.prepare('INSERT INTO events (title,date,time,calendar,color,source,external_id) VALUES (?,?,?,?,?,?,?)');
  for (const ev of events) {
    ins.run(ev.title, ev.date, ev.time, cal, source.color, `ics-${source.id}`, ev.external_id);
  }
  db.prepare('UPDATE ics_sources SET last_synced=datetime("now") WHERE id=?').run(source.id);
  return events.length;
}

// ── Chore status helper ───────────────────────────────────────────────────────
function updateChoreStatuses() {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare("UPDATE chores SET status='overdue'  WHERE next_due < ? AND done=0").run(today);
  db.prepare("UPDATE chores SET status='due'      WHERE next_due = ? AND done=0").run(today);
  db.prepare("UPDATE chores SET status='upcoming' WHERE next_due > ?").run(today);
}
updateChoreStatuses();

function computeNextDue(recurrence) {
  const d = new Date();
  if (recurrence.startsWith('Daily'))      d.setDate(d.getDate() + 1);
  else if (recurrence.startsWith('Bi-w'))  d.setDate(d.getDate() + 14);
  else if (recurrence.startsWith('Month')) d.setMonth(d.getMonth() + 1);
  else                                     d.setDate(d.getDate() + 7); // Weekly
  return d.toISOString().slice(0, 10);
}

// ── Push helper ───────────────────────────────────────────────────────────────
async function sendPushToAll(payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(sub.endpoint);
      }
    }
  }
}

// ── Routes: Events ────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.json(db.prepare('SELECT * FROM events ORDER BY date, time').all());
});

app.post('/api/events', (req, res) => {
  const { title, date, time, duration, calendar, color, notes } = req.body;
  const calColors = { personal:'#007AFF', work:'#5856D6', family:'#32ADE6', hearth:'#34C759' };
  const col = color || calColors[calendar] || '#34C759';
  const r = db.prepare(
    'INSERT INTO events (title,date,time,duration,calendar,color,notes) VALUES (?,?,?,?,?,?,?)'
  ).run(title, date, time||'All day', duration||'1h', calendar||'hearth', col, notes||'');
  res.json({ id: r.lastInsertRowid, title, date, time: time||'All day', calendar: calendar||'hearth', color: col });
});

app.delete('/api/events/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Routes: Chores ────────────────────────────────────────────────────────────
app.get('/api/chores', (req, res) => {
  updateChoreStatuses();
  res.json(db.prepare("SELECT * FROM chores ORDER BY CASE status WHEN 'overdue' THEN 0 WHEN 'due' THEN 1 ELSE 2 END, created_at").all());
});

app.post('/api/chores', (req, res) => {
  const { name, recurrence, start } = req.body;
  const today = new Date().toISOString().slice(0, 10);
  const nextDue = start || today;
  const status = nextDue <= today ? 'due' : 'upcoming';
  const r = db.prepare(
    'INSERT INTO chores (name,recurrence,next_due,status) VALUES (?,?,?,?)'
  ).run(name, recurrence, nextDue, status);
  res.json({ id: r.lastInsertRowid, name, recurrence, last_done: '', next_due: nextDue, status, done: 0 });
});

app.put('/api/chores/:id/done', (req, res) => {
  const c = db.prepare('SELECT * FROM chores WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const done = c.done ? 0 : 1;
  const todayISO = new Date().toISOString().slice(0, 10);
  const todayDisplay = new Date().toLocaleDateString('en-US', { month:'short', day:'numeric' });
  // When marking done: advance next_due. When unmarking: restore to today so it shows as due again.
  const nextDue = done ? computeNextDue(c.recurrence) : todayISO;
  const lastDone = done ? todayDisplay : c.last_done;
  db.prepare('UPDATE chores SET done=?,last_done=?,next_due=? WHERE id=?').run(done, lastDone, nextDue, c.id);
  updateChoreStatuses();
  res.json({ done, next_due: nextDue });
});

app.delete('/api/chores/:id', (req, res) => {
  db.prepare('DELETE FROM chores WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Routes: Grocery ───────────────────────────────────────────────────────────
app.get('/api/grocery', (req, res) => {
  res.json(db.prepare('SELECT * FROM grocery ORDER BY checked, category, created_at').all());
});

app.post('/api/grocery', (req, res) => {
  const { name, category } = req.body;
  const r = db.prepare('INSERT INTO grocery (name,category) VALUES (?,?)').run(name, category||'Other');
  res.json({ id: r.lastInsertRowid, name, category: category||'Other', checked: 0 });
});

app.put('/api/grocery/:id/toggle', (req, res) => {
  const item = db.prepare('SELECT checked FROM grocery WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const checked = item.checked ? 0 : 1;
  db.prepare('UPDATE grocery SET checked=? WHERE id=?').run(checked, req.params.id);
  res.json({ checked });
});

app.delete('/api/grocery/checked', (req, res) => {
  db.prepare('DELETE FROM grocery WHERE checked=1').run();
  res.json({ ok: true });
});

// ── Routes: Meals ─────────────────────────────────────────────────────────────
app.get('/api/meals', (req, res) => {
  const order = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const rows = db.prepare('SELECT * FROM meals').all();
  rows.sort((a,b) => order.indexOf(a.day) - order.indexOf(b.day));
  res.json(rows);
});

app.put('/api/meals/:day', (req, res) => {
  const meal = req.body?.meal ?? '';
  db.prepare('INSERT OR REPLACE INTO meals (day,meal) VALUES (?,?)').run(req.params.day, meal);
  res.json({ ok: true });
});

// ── Routes: Inbox ─────────────────────────────────────────────────────────────
app.get('/api/inbox', (req, res) => {
  res.json({
    pending: db.prepare('SELECT * FROM inbox ORDER BY created_at DESC').all(),
    recent:  db.prepare('SELECT * FROM recently_added ORDER BY added_at DESC LIMIT 10').all(),
  });
});

app.post('/api/inbox/:id/accept', (req, res) => {
  const item = db.prepare('SELECT * FROM inbox WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  db.prepare('INSERT INTO events (title,date,time,calendar,color,source) VALUES (?,?,?,?,?,?)')
    .run(item.event_name, item.event_date, item.event_time, 'hearth', '#34C759', 'email');
  db.prepare('INSERT INTO recently_added (event_name,event_date,source) VALUES (?,?,?)')
    .run(item.event_name, item.event_date, 'Email');
  db.prepare('DELETE FROM inbox WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/inbox/:id', (req, res) => {
  db.prepare('DELETE FROM inbox WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Routes: ICS ───────────────────────────────────────────────────────────────
app.get('/api/ics/sources', (req, res) => {
  res.json(db.prepare('SELECT * FROM ics_sources ORDER BY created_at').all());
});

app.post('/api/ics/sources', async (req, res) => {
  const { name, url, color } = req.body;
  try {
    const r = db.prepare('INSERT INTO ics_sources (name,url,color) VALUES (?,?,?)').run(name, url, color||'#3B82F6');
    const source = db.prepare('SELECT * FROM ics_sources WHERE id=?').get(r.lastInsertRowid);
    const count = await syncICSSource(source);
    res.json({ ...source, events_imported: count });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/ics/sources/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE source=?').run(`ics-${req.params.id}`);
  db.prepare('DELETE FROM ics_sources WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/ics/sync', async (req, res) => {
  const sources = db.prepare('SELECT * FROM ics_sources WHERE enabled=1').all();
  let total = 0;
  for (const src of sources) {
    try { total += await syncICSSource(src); } catch (e) { /* skip */ }
  }
  res.json({ ok: true, total_events: total });
});

// ── Routes: Push ──────────────────────────────────────────────────────────────
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: app._vapidPublic });
});

app.post('/api/push/subscribe', (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Invalid subscription' });
  db.prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint,p256dh,auth) VALUES (?,?,?)').run(endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint);
  res.json({ ok: true });
});

app.post('/api/push/test', async (req, res) => {
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  await sendPushToAll({ title: 'Hearth', body: 'Push notifications are working!', tag: 'test' });
  res.json({ ok: true, sent: subs.length });
});

// ── Routes: Settings ──────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

app.put('/api/settings', (req, res) => {
  const upd = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  for (const [k, v] of Object.entries(req.body)) upd.run(k, String(v));
  res.json({ ok: true });
});

// ── Cron jobs ─────────────────────────────────────────────────────────────────

// Update chore statuses at midnight
cron.schedule('0 0 * * *', updateChoreStatuses);

// Push chore reminders at 8am
cron.schedule('0 8 * * *', async () => {
  updateChoreStatuses();
  const due = db.prepare("SELECT * FROM chores WHERE status IN ('due','overdue') AND done=0").all();
  if (!due.length) return;
  await sendPushToAll({
    title: 'Hearth — Chores Due',
    body: `${due.length} chore${due.length > 1 ? 's' : ''} need attention: ${due.map(c => c.name).join(', ')}`,
    tag: 'chores',
  });
});

// Event reminders — check every 15 min, push 30 min before
cron.schedule('*/15 * * * *', async () => {
  const now   = new Date();
  const soon  = new Date(now.getTime() + 30 * 60 * 1000);
  const dateStr = soon.toISOString().slice(0, 10);
  const h = soon.getHours(), m = String(soon.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const timeStr = `${h12}:${m} ${ampm}`;

  const upcoming = db.prepare('SELECT * FROM events WHERE date=? AND time=?').all(dateStr, timeStr);
  for (const ev of upcoming) {
    await sendPushToAll({ title: `In 30 min: ${ev.title}`, body: `${ev.time}`, tag: `event-${ev.id}` });
  }
});

// ICS sync every 6 hours
cron.schedule('0 */6 * * *', async () => {
  const sources = db.prepare('SELECT * FROM ics_sources WHERE enabled=1').all();
  for (const src of sources) {
    try { await syncICSSource(src); } catch (e) { /* skip */ }
  }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Hearth running → http://localhost:${PORT}`));
