'use strict';
const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const cron       = require('node-cron');
const webpush    = require('web-push');
const db         = require('./db');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const WebSocket  = require('ws');
const { io: socketIoClient } = require('socket.io-client');

const app  = express();
const PORT = process.env.PORT || 7400;

// ── SSE push to all connected browser clients ─────────────────────────────────
const _sseClients = new Set();
function broadcastSSE(event, data) {
  if (!_sseClients.size) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of _sseClients) {
    try { res.write(payload); } catch { _sseClients.delete(res); }
  }
}

const PHOTOS_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'photos');
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
app.use('/photos', express.static(PHOTOS_DIR));

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

// ── Auth helpers ──────────────────────────────────────────────────────────────

function getJwtSecret() {
  let s = db.prepare('SELECT value FROM settings WHERE key=?').get('jwt_secret')?.value;
  if (!s) {
    s = require('crypto').randomBytes(32).toString('hex');
    db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('jwt_secret', s);
  }
  return s;
}

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { req.user = jwt.verify(token, getJwtSecret()); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const user = jwt.verify(token, getJwtSecret());
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
    req.user = user; next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

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
  const vapidContact = process.env.VAPID_CONTACT
    || db.prepare("SELECT value FROM settings WHERE key='forwarding_address'").get()?.value
    || 'mailto:kith@local.home';
  webpush.setVapidDetails(vapidContact.includes('@') && !vapidContact.startsWith('mailto:') ? `mailto:${vapidContact}` : vapidContact, pub, priv);
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
    const dtRaw = e.DTSTART || '';
    const isUtc = dtRaw.endsWith('Z');
    const raw = dtRaw.replace(/[^0-9]/g, '');
    let date = '', time = 'All day';
    if (raw.length >= 8) {
      if (raw.length >= 14 && isUtc) {
        // Convert UTC datetime to server-local datetime
        const utcMs = Date.UTC(
          parseInt(raw.slice(0,4)), parseInt(raw.slice(4,6))-1, parseInt(raw.slice(6,8)),
          parseInt(raw.slice(8,10)), parseInt(raw.slice(10,12)), 0
        );
        const local = new Date(utcMs);
        date = localDate(local);
        const h = local.getHours(), m = local.getMinutes();
        const ampm = h >= 12 ? 'PM' : 'AM';
        time = `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${String(m).padStart(2,'0')} ${ampm}`;
      } else {
        date = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
        if (raw.length >= 14) {
          const h = parseInt(raw.slice(8,10));
          const m = raw.slice(10,12);
          const ampm = h >= 12 ? 'PM' : 'AM';
          time = `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${m} ${ampm}`;
        }
      }
    }
    let recurrence = 'One-time';
    if (e.RRULE) {
      const freq = (e.RRULE.match(/FREQ=(\w+)/) || [])[1];
      const interval = parseInt((e.RRULE.match(/INTERVAL=(\d+)/) || [])[1] || '1');
      if (freq === 'DAILY')   recurrence = interval >= 2 ? `Every ${interval} days` : 'Daily';
      else if (freq === 'WEEKLY')  recurrence = interval >= 2 ? 'Bi-weekly' : 'Weekly';
      else if (freq === 'MONTHLY') recurrence = interval >= 2 ? `Every ${interval} months` : 'Monthly';
      else if (freq === 'YEARLY')  recurrence = 'Annually';
    }
    return { title: e.SUMMARY || 'Untitled', date, time, recurrence, external_id: e.UID || null };
  }).filter(e => e.date);
}

// ── Time normalizer — canonical "H:MM AM/PM" for push matching ────────────────
function normalizeTime(t) {
  if (!t || t === 'All day') return 'All day';
  const s = t.trim();
  const canonical = s.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (canonical) return `${parseInt(canonical[1])}:${canonical[2]} ${canonical[3].toUpperCase()}`;
  const h24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) { let h=parseInt(h24[1]),m=h24[2],ap=h>=12?'PM':'AM'; if(h>12)h-=12; if(h===0)h=12; return `${h}:${m} ${ap}`; }
  const nospace = s.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (nospace) return `${parseInt(nospace[1])}:${nospace[2]} ${nospace[3].toUpperCase()}`;
  const compact = s.match(/^(\d{1,2})(am|pm)$/i);
  if (compact) return `${parseInt(compact[1])}:00 ${compact[2].toUpperCase()}`;
  return s;
}

// ── ICS sync helper ───────────────────────────────────────────────────────────
async function syncICSSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let text;
  try {
    text = await fetch(source.url, { signal: controller.signal }).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    });
  } finally {
    clearTimeout(timer);
  }
  const events = parseICS(text);
  const cal = `ics:${source.name}`;
  const ins = db.prepare('INSERT INTO events (title,date,time,calendar,color,source,external_id) VALUES (?,?,?,?,?,?,?)');
  db.transaction(() => {
    db.prepare('DELETE FROM events WHERE source=?').run(`ics-${source.id}`);
    for (const ev of events) ins.run(ev.title, ev.date, ev.time, cal, source.color, `ics-${source.id}`, ev.external_id);
  })();
  db.prepare("UPDATE ics_sources SET last_synced=datetime('now') WHERE id=?").run(source.id);
  return events.length;
}

// ── Local date helper (avoids UTC-vs-local timezone flip) ─────────────────────
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Chore status helper ───────────────────────────────────────────────────────
function updateChoreStatuses() {
  const today = localDate();
  // Recurring chores must never stay done — reset any that slipped through
  db.prepare("UPDATE chores SET done=0 WHERE done=1 AND recurrence != 'One-time'").run();
  // Reset streak for chores that went overdue without being completed
  db.prepare("UPDATE chores SET streak=0 WHERE next_due < ? AND done=0 AND streak > 0 AND recurrence != 'One-time'").run(today);
  db.prepare("UPDATE chores SET status='overdue'  WHERE next_due < ? AND done=0").run(today);
  db.prepare("UPDATE chores SET status='due'      WHERE next_due = ? AND done=0").run(today);
  db.prepare("UPDATE chores SET status='upcoming' WHERE next_due > ? AND done=0").run(today);
}
updateChoreStatuses();

function addMonths(d) {
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
}

function computeNextDue(recurrence) {
  const d = new Date();
  if (recurrence.startsWith('Daily'))       d.setDate(d.getDate() + 1);
  else if (recurrence.startsWith('Bi-w'))   d.setDate(d.getDate() + 14);
  else if (recurrence.startsWith('Month'))  addMonths(d);
  else if (recurrence.startsWith('Annual')) d.setFullYear(d.getFullYear() + 1);
  else if (recurrence.startsWith('Weekday')) {
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  } else if (recurrence === 'One-time') return '9999-12-31';
  else d.setDate(d.getDate() + 7); // Weekly
  return localDate(d);
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

// ── Weather ───────────────────────────────────────────────────────────────────
let _weatherCache = null;
let _weatherCacheAt = 0;
const WEATHER_TTL = 30 * 60 * 1000;

function wmoInfo(code) {
  if (code === 0)       return ['☀️',  'Clear'];
  if (code <= 2)        return ['⛅',  'Partly Cloudy'];
  if (code === 3)       return ['☁️',  'Overcast'];
  if (code <= 48)      return ['🌫️', 'Fog'];
  if (code <= 55)      return ['🌦️', 'Drizzle'];
  if (code <= 65)      return ['🌧️', 'Rain'];
  if (code <= 77)      return ['🌨️', 'Snow'];
  if (code <= 82)      return ['🌦️', 'Showers'];
  if (code <= 99)      return ['⛈️',  'Thunderstorm'];
  return ['🌡️', '--'];
}

app.get('/api/weather/geocode', async (req, res) => {
  const { city } = req.query;
  if (!city) return res.status(400).json({ error: 'city required' });
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
    const data = await fetch(url).then(r => r.json());
    const r = (data.results || [])[0];
    if (!r) return res.status(404).json({ error: 'City not found' });
    res.json({
      name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
      lat: r.latitude,
      lon: r.longitude,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/weather', async (req, res) => {
  if (_weatherCache && Date.now() - _weatherCacheAt < WEATHER_TTL) {
    return res.json(_weatherCache);
  }
  const getSetting = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
  const lat  = getSetting('weather_lat')      || '33.749';
  const lon  = getSetting('weather_lon')      || '-84.388';
  const unit = getSetting('temperature_unit') || 'F';
  const omUnit = unit === 'C' ? 'celsius' : 'fahrenheit';
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&temperature_unit=${omUnit}&timezone=auto&forecast_days=5`;
    const data = await fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    const [icon, condition] = wmoInfo(data.current.weather_code);
    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const todayISO = localDate();
    const forecast = data.daily.time.map((date, i) => ({
      day: date === todayISO ? 'Today' : DAYS[new Date(date + 'T12:00:00').getDay()],
      icon: wmoInfo(data.daily.weather_code[i])[0],
      hi: Math.round(data.daily.temperature_2m_max[i]),
      lo: Math.round(data.daily.temperature_2m_min[i]),
    }));
    _weatherCache = {
      temp: Math.round(data.current.temperature_2m),
      hi: forecast[0].hi,
      lo: forecast[0].lo,
      condition,
      icon,
      unit,
      forecast,
    };
    _weatherCacheAt = Date.now();
    res.json(_weatherCache);
  } catch (e) {
    if (_weatherCache) return res.json(_weatherCache); // serve stale on error
    res.status(503).json({ error: e.message });
  }
});

app.get('/api/uptime', (req, res) => res.json({ seconds: Math.floor(process.uptime()) }));

// ── Routes: Auth ──────────────────────────────────────────────────────────────

app.get('/api/auth/setup-status', (req, res) => {
  const hash = db.prepare('SELECT value FROM settings WHERE key=?').get('admin_pin_hash')?.value;
  res.json({ configured: !!(hash && hash.length > 0) });
});

app.post('/api/auth/setup', async (req, res) => {
  const existing = db.prepare('SELECT value FROM settings WHERE key=?').get('admin_pin_hash')?.value;
  if (existing) return res.status(403).json({ error: 'Admin already configured' });
  const { pin } = req.body;
  if (!String(pin || '').match(/^\d{4,8}$/)) return res.status(400).json({ error: 'PIN must be 4–8 digits' });
  const hash = await bcrypt.hash(String(pin), 10);
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('admin_pin_hash', hash);
  const token = jwt.sign({ sub: 'admin', role: 'admin' }, getJwtSecret(), { expiresIn: '30d' });
  res.json({ token });
});

app.post('/api/auth/login', async (req, res) => {
  const { member_id, pin } = req.body;
  const member = db.prepare('SELECT * FROM family_members WHERE id=?').get(Number(member_id));
  if (!member) return res.status(401).json({ error: 'Member not found' });
  if (!member.pin_hash) return res.status(401).json({ error: 'PIN not set for this member' });
  if (!await bcrypt.compare(String(pin || ''), member.pin_hash))
    return res.status(401).json({ error: 'Wrong PIN' });
  const token = jwt.sign({ sub: member.id, name: member.name, role: 'member' }, getJwtSecret(), { expiresIn: '30d' });
  res.json({ token, member: { id: member.id, name: member.name, color: member.color, initials: member.initials } });
});

app.post('/api/auth/admin', async (req, res) => {
  const hash = db.prepare('SELECT value FROM settings WHERE key=?').get('admin_pin_hash')?.value;
  if (!hash) return res.status(401).json({ error: 'Admin not configured' });
  if (!await bcrypt.compare(String(req.body.pin || ''), hash))
    return res.status(401).json({ error: 'Wrong PIN' });
  const token = jwt.sign({ sub: 'admin', role: 'admin' }, getJwtSecret(), { expiresIn: '30d' });
  res.json({ token });
});

app.put('/api/auth/admin/pin', requireAdmin, async (req, res) => {
  const { pin } = req.body;
  if (!String(pin || '').match(/^\d{4,8}$/)) return res.status(400).json({ error: 'PIN must be 4–8 digits' });
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('admin_pin_hash', await bcrypt.hash(String(pin), 10));
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json(req.user));

// ── Routes: Events ────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.json(db.prepare('SELECT * FROM events ORDER BY date, time').all());
});

app.post('/api/events', requireAuth, (req, res) => {
  const { title, date, time, end_time, duration, calendar, color, notes, member_id, recurring_rule } = req.body;
  if (!title?.trim() || !date) return res.status(400).json({ error: 'title and date are required' });
  const calColors = { personal:'#007AFF', work:'#5856D6', family:'#32ADE6', kith:'#34C759' };
  const col = color || calColors[calendar] || '#34C759';
  const r = db.prepare(
    'INSERT INTO events (title,date,time,end_time,duration,calendar,color,notes,member_id,recurring_rule) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(title.trim(), date, normalizeTime(time)||'All day', end_time||'', duration||'1h', calendar||'kith', col, notes||'', member_id||null, recurring_rule||'');
  const seriesId = r.lastInsertRowid;

  // Generate recurring occurrences
  const rule = recurring_rule || '';
  if (rule && rule !== 'Does not repeat') {
    const ins2 = db.prepare('INSERT INTO events (title,date,time,end_time,duration,calendar,color,notes,member_id,recurring_rule,source,external_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    const cur = new Date(date + 'T12:00:00');
    const origDay = cur.getDate();
    const limit = rule === 'Annually'
      ? new Date(new Date(date + 'T12:00:00').setFullYear(new Date(date + 'T12:00:00').getFullYear() + 5))
      : new Date(cur.getTime() + 365 * 86400000);
    while (true) {
      if (rule === 'Daily')          cur.setDate(cur.getDate() + 1);
      else if (rule === 'Weekly')    cur.setDate(cur.getDate() + 7);
      else if (rule === 'Bi-weekly') cur.setDate(cur.getDate() + 14);
      else if (rule === 'Monthly')   { cur.setDate(1); cur.setMonth(cur.getMonth() + 1); cur.setDate(Math.min(origDay, new Date(cur.getFullYear(), cur.getMonth()+1, 0).getDate())); }
      else if (rule === 'Annually')  cur.setFullYear(cur.getFullYear() + 1);
      else if (rule === 'Weekdays') {
        cur.setDate(cur.getDate() + 1);
        while (cur.getDay() === 0 || cur.getDay() === 6) cur.setDate(cur.getDate() + 1);
      } else break;
      if (cur > limit) break;
      ins2.run(title.trim(), localDate(cur), normalizeTime(time)||'All day', end_time||'', duration||'1h', calendar||'kith', col, notes||'', member_id||null, recurring_rule||'', 'manual', seriesId);
    }
  }

  res.json({ id: seriesId, title: title.trim(), date, time: time||'All day', end_time: end_time||'', calendar: calendar||'kith', color: col, member_id: member_id||null, recurring_rule: rule });
});

app.put('/api/events/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { title, date, time, end_time, duration, calendar, color, notes, member_id, recurring_rule } = req.body;
  const calColors = { personal:'#007AFF', work:'#5856D6', family:'#32ADE6', kith:'#34C759' };
  const col = color || calColors[calendar] || existing.color;
  db.prepare('UPDATE events SET title=?,date=?,time=?,end_time=?,duration=?,calendar=?,color=?,notes=?,member_id=?,recurring_rule=? WHERE id=?')
    .run(
      title?.trim() || existing.title,
      date || existing.date,
      time !== undefined ? (normalizeTime(time) || 'All day') : existing.time,
      end_time !== undefined ? end_time : existing.end_time,
      duration || existing.duration,
      calendar || existing.calendar,
      col,
      notes !== undefined ? notes : existing.notes,
      member_id !== undefined ? (member_id || null) : existing.member_id,
      recurring_rule !== undefined ? recurring_rule : existing.recurring_rule,
      existing.id
    );
  res.json(db.prepare('SELECT * FROM events WHERE id=?').get(existing.id));
});

app.delete('/api/events/:id', requireAuth, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id=?').get(Number(req.params.id));
  if (!ev) return res.status(404).json({ ok: true });
  const scope = req.query.scope || 'one';
  if (scope === 'one' || !ev.recurring_rule) {
    db.prepare('DELETE FROM events WHERE id=?').run(ev.id);
  } else {
    const seriesId = ev.external_id || ev.id;
    if (scope === 'all') {
      db.prepare('DELETE FROM events WHERE id=? OR external_id=?').run(seriesId, seriesId);
    } else if (scope === 'future') {
      db.prepare('DELETE FROM events WHERE (id=? OR external_id=?) AND date>=?').run(seriesId, seriesId, ev.date);
    }
  }
  res.json({ ok: true });
});

// ── Routes: Chores ────────────────────────────────────────────────────────────
app.get('/api/chores', (req, res) => {
  updateChoreStatuses();
  res.json(db.prepare(`
    SELECT c.*, fm.name as member_name, fm.color as member_color, fm.initials as member_initials
    FROM chores c LEFT JOIN family_members fm ON fm.id = c.member_id
    ORDER BY CASE c.status WHEN 'overdue' THEN 0 WHEN 'due' THEN 1 ELSE 2 END, c.created_at
  `).all());
});

app.get('/api/chores/leaderboard', (req, res) => {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0,0,0,0);
  const rows = db.prepare(`
    SELECT cc.member_id, cc.member_name, SUM(cc.points) as points, fm.color, fm.initials
    FROM chore_completions cc
    LEFT JOIN family_members fm ON fm.id = cc.member_id
    WHERE date(cc.completed_at) >= date(?)
    GROUP BY cc.member_id ORDER BY points DESC
  `).all(localDate(weekStart));
  res.json(rows);
});

app.post('/api/chores', requireAdmin, (req, res) => {
  const { name, recurrence, start, points, outdoor=0, goal_id=null, goal_amount=1, member_id=null } = req.body;
  if (!name?.trim() || !recurrence?.trim()) return res.status(400).json({ error: 'name and recurrence are required' });
  const today = localDate();
  const nextDue = start || today;
  const status = nextDue <= today ? 'due' : 'upcoming';
  const r = db.prepare(
    'INSERT INTO chores (name,recurrence,next_due,status,points,outdoor,goal_id,goal_amount,member_id) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(name.trim(), recurrence.trim(), nextDue, status, Number(points)||1, outdoor?1:0, goal_id||null, Number(goal_amount)||1, member_id||null);
  res.json(db.prepare(`
    SELECT c.*, fm.name as member_name, fm.color as member_color, fm.initials as member_initials
    FROM chores c LEFT JOIN family_members fm ON fm.id = c.member_id WHERE c.id=?
  `).get(r.lastInsertRowid));
});

app.put('/api/chores/:id', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM chores WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const { name, recurrence, next_due, points, outdoor, goal_id, goal_amount, member_id } = req.body;
  const today = localDate();
  const nd = next_due || c.next_due;
  const status = nd < today ? 'overdue' : nd === today ? 'due' : 'upcoming';
  db.prepare('UPDATE chores SET name=?,recurrence=?,next_due=?,status=?,points=?,outdoor=?,goal_id=?,goal_amount=?,member_id=? WHERE id=?')
    .run(
      name || c.name, recurrence || c.recurrence, nd, status,
      points != null ? Number(points) : (c.points||1),
      outdoor != null ? (outdoor?1:0) : (c.outdoor||0),
      goal_id !== undefined ? (goal_id||null) : c.goal_id,
      goal_amount != null ? Number(goal_amount) : (c.goal_amount||1),
      member_id !== undefined ? (member_id||null) : c.member_id,
      c.id
    );
  res.json(db.prepare(`
    SELECT c.*, fm.name as member_name, fm.color as member_color, fm.initials as member_initials
    FROM chores c LEFT JOIN family_members fm ON fm.id = c.member_id WHERE c.id=?
  `).get(c.id));
});

app.put('/api/chores/:id/done', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM chores WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const isRecurring = c.recurrence && c.recurrence !== 'One-time';
  // For recurring chores: always mark complete (never toggle back) and immediately reset done=0
  // so the chore shows as upcoming with the new date. For one-time: toggle done.
  const done = isRecurring ? 1 : (c.done ? 0 : 1);
  const todayISO = localDate();
  const todayDisplay = new Date().toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const nextDue = done ? computeNextDue(c.recurrence) : todayISO;
  const lastDone = done ? todayDisplay : c.last_done;
  const newStreak = done ? (c.streak || 0) + 1 : Math.max(0, (c.streak || 0) - 1);
  // Recurring chores: reset done=0 immediately after logging — they advance to next cycle
  const storedDone = isRecurring ? 0 : done;
  db.prepare('UPDATE chores SET done=?,last_done=?,next_due=?,streak=? WHERE id=?').run(storedDone, lastDone, nextDue, newStreak, c.id);
  if (done && req.user.role !== 'admin') {
    const member = db.prepare('SELECT * FROM family_members WHERE id=?').get(Number(req.user.sub));
    if (member) {
      db.prepare('INSERT INTO chore_completions (chore_id,member_id,member_name,points) VALUES (?,?,?,?)')
        .run(c.id, member.id, member.name, c.points || 1);
    }
  }
  if (done && c.goal_id) {
    const g = db.prepare('SELECT * FROM household_goals WHERE id=?').get(c.goal_id);
    if (g) {
      const newProgress = Math.min(g.progress_target, g.progress_current + (c.goal_amount || 1));
      db.prepare('UPDATE household_goals SET progress_current=? WHERE id=?').run(newProgress, g.id);
    }
  }
  updateChoreStatuses();
  const newStatus = db.prepare('SELECT status FROM chores WHERE id=?').get(c.id)?.status || 'upcoming';
  res.json({ done: storedDone, completed: done === 1, next_due: nextDue, status: newStatus, points_earned: done ? (c.points || 1) : 0, streak: newStreak });
});

app.delete('/api/chores/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM chores WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Routes: Grocery ───────────────────────────────────────────────────────────
app.get('/api/grocery', (req, res) => {
  res.json(db.prepare('SELECT * FROM grocery ORDER BY checked, category, created_at').all());
});

app.get('/api/grocery/history', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT name, count FROM grocery_history ORDER BY count DESC LIMIT 8').all());
});

app.post('/api/grocery', requireAuth, (req, res) => {
  const { name, category } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const r = db.prepare('INSERT INTO grocery (name,category) VALUES (?,?)').run(name.trim(), category||'Other');
  const histName = name.trim().toLowerCase();
  db.prepare('INSERT INTO grocery_history (name,count,last_used) VALUES (?,1,?) ON CONFLICT(name) DO UPDATE SET count=count+1, last_used=?')
    .run(histName, localDate(), localDate());
  const newItem = { id: r.lastInsertRowid, name: name.trim(), category: category||'Other', checked: 0 };
  broadcastSSE('grocery', { action: 'add', item: newItem });
  res.json(newItem);
});

app.put('/api/grocery/:id/toggle', requireAuth, (req, res) => {
  const item = db.prepare('SELECT checked FROM grocery WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const checked = item.checked ? 0 : 1;
  db.prepare('UPDATE grocery SET checked=? WHERE id=?').run(checked, req.params.id);
  broadcastSSE('grocery', { action: 'toggle', id: Number(req.params.id), checked });
  res.json({ checked });
});

app.delete('/api/grocery/checked', requireAuth, (req, res) => {
  db.prepare('DELETE FROM grocery WHERE checked=1').run();
  broadcastSSE('grocery', { action: 'clear_checked' });
  res.json({ ok: true });
});

app.delete('/api/grocery/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM grocery WHERE id=?').run(req.params.id);
  broadcastSSE('grocery', { action: 'remove', id: Number(req.params.id) });
  res.json({ ok: true });
});

// ── Routes: Meals ─────────────────────────────────────────────────────────────
app.get('/api/meals', (req, res) => {
  const order = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const rows = db.prepare('SELECT * FROM meals').all();
  rows.sort((a,b) => order.indexOf(a.day) - order.indexOf(b.day));
  res.json(rows);
});

app.put('/api/meals/:day', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM meals WHERE day=?').get(req.params.day) || {};
  const meal      = req.body?.meal      ?? existing.meal      ?? '';
  const breakfast = req.body?.breakfast ?? existing.breakfast ?? '';
  const lunch     = req.body?.lunch     ?? existing.lunch     ?? '';
  db.prepare('INSERT OR REPLACE INTO meals (day,meal,breakfast,lunch) VALUES (?,?,?,?)').run(req.params.day, meal, breakfast, lunch);
  res.json({ ok: true });
});

// ── Routes: Inbox ─────────────────────────────────────────────────────────────
app.get('/api/inbox', (req, res) => {
  res.json({
    pending: db.prepare('SELECT * FROM inbox ORDER BY created_at DESC').all(),
    recent:  db.prepare('SELECT * FROM recently_added ORDER BY added_at DESC LIMIT 10').all(),
  });
});

app.post('/api/inbox/:id/accept', requireAuth, (req, res) => {
  const item = db.prepare('SELECT * FROM inbox WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const rawDate = req.body?.date || item.event_date;
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  if (!date) return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) required' });
  const time = item.event_time || 'All day';
  db.prepare('INSERT INTO events (title,date,time,calendar,color,source) VALUES (?,?,?,?,?,?)')
    .run(item.event_name, date, time, 'kith', '#34C759', 'email');
  db.prepare('INSERT INTO recently_added (event_name,event_date,source) VALUES (?,?,?)')
    .run(item.event_name, date, 'Email');
  db.prepare('DELETE FROM inbox WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/inbox/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM inbox WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/inbox/upload', requireAuth, async (req, res) => {
  const { filename = '', data } = req.body || {};
  if (!data || typeof data !== 'string') return res.status(400).json({ error: 'data required' });

  const isPdf = filename.toLowerCase().endsWith('.pdf') || data.startsWith('data:application/pdf');
  const isImage = /^data:image\//.test(data);
  if (!isPdf && !isImage) return res.status(400).json({ error: 'only images and PDFs are supported' });

  try {
    let events = [];
    const base64 = data.includes(',') ? data.split(',')[1] : data;

    if (isPdf) {
      const pdfParse = require('pdf-parse');
      const buf = Buffer.from(base64, 'base64');
      const pdf = await pdfParse(buf);
      const text = pdf.text.slice(0, 4000);
      const result = await callAiForEvent(filename, text);
      if (result?.event_name) events = [result];
    } else {
      const mimeType = data.split(';')[0].replace('data:', '') || 'image/jpeg';
      events = await callAiWithMedia(base64, mimeType);
    }

    const insert = db.prepare('INSERT INTO inbox (subject,event_name,event_date,event_time,recurrence,confidence) VALUES (?,?,?,?,?,?)');
    let count = 0;
    for (const ev of events) {
      if (!ev.event_name) continue;
      insert.run(filename || 'Uploaded file', ev.event_name, ev.event_date || '', ev.event_time || 'All day', ev.recurrence || 'One-time', ev.confidence || 'medium');
      count++;
    }
    res.json({ ok: true, count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Routes: ICS ───────────────────────────────────────────────────────────────
app.get('/api/ics/sources', (req, res) => {
  res.json(db.prepare('SELECT * FROM ics_sources ORDER BY created_at').all());
});

app.post('/api/ics/sources', requireAdmin, async (req, res) => {
  const { name, color } = req.body;
  const url = (req.body.url || '').replace(/^webcal:\/\//i, 'https://');
  try {
    const r = db.prepare('INSERT INTO ics_sources (name,url,color) VALUES (?,?,?)').run(name, url, color||'#3B82F6');
    const source = db.prepare('SELECT * FROM ics_sources WHERE id=?').get(r.lastInsertRowid);
    const count = await syncICSSource(source);
    res.json({ ...source, events_imported: count });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/ics/sources/:id', requireAdmin, async (req, res) => {
  const { name, url, color } = req.body || {};
  if (!name?.trim() || !url?.trim()) return res.status(400).json({ error: 'name and url required' });
  db.prepare('UPDATE ics_sources SET name=?,url=?,color=? WHERE id=?').run(name.trim(), url.trim(), color||'#3B82F6', req.params.id);
  const source = db.prepare('SELECT * FROM ics_sources WHERE id=?').get(req.params.id);
  try {
    const count = await syncICSSource(source);
    res.json({ source, count });
  } catch (e) {
    res.status(500).json({ error: `Saved but sync failed: ${e.message}` });
  }
});

app.delete('/api/ics/sources/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM events WHERE source=?').run(`ics-${req.params.id}`);
  db.prepare('DELETE FROM ics_sources WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/ics/sync', requireAuth, async (req, res) => {
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

app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Invalid subscription' });
  db.prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint,p256dh,auth) VALUES (?,?,?)').run(endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body;
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint);
  res.json({ ok: true });
});

app.post('/api/push/test', requireAuth, async (req, res) => {
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  await sendPushToAll({ title: 'Kith', body: 'Push notifications are working!', tag: 'test' });
  res.json({ ok: true, sent: subs.length });
});

// ── Routes: Settings ──────────────────────────────────────────────────────────
const SETTINGS_SENSITIVE = new Set(['email_webhook_secret','anthropic_api_key','ai_api_key','beehiiv_api_key','youtube_api_key','etsy_api_key','teslemetry_api_key','aviationstack_api_key','lastfm_api_key','nextdns_api_key','beszel_user','beszel_pass','jwt_secret','vapid_public','vapid_private','admin_pin_hash','resend_api_key','ha_webhook_secret','smart_home_token','ha_token','homey_token','plex_token','spotify_refresh_token','moen_pass','unifi_pass','wifi_password']);
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  res.json(Object.fromEntries(rows.filter(r=>!SETTINGS_SENSITIVE.has(r.key)).map(r=>[r.key,r.value])));
});

app.put('/api/settings', requireAdmin, (req, res) => {
  const upd = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  for (const [k, v] of Object.entries(req.body)) {
    if (!SETTINGS_SENSITIVE.has(k)) upd.run(k, String(v));
  }
  if ('weather_lat' in req.body || 'weather_lon' in req.body || 'temperature_unit' in req.body) _weatherCache = null;
  if ('news_feed' in req.body) { _newsCache = null; _newsCacheAt = 0; }
  if ('sports_leagues' in req.body) { for (const k of Object.keys(_sportsCache)) delete _sportsCache[k]; }
  res.json({ ok: true });
});

app.get('/api/settings/webhook-secret', requireAdmin, (req, res) => {
  const val = db.prepare("SELECT value FROM settings WHERE key='email_webhook_secret'").get()?.value || '';
  res.json({ secret: val });
});
app.put('/api/settings/webhook-secret', requireAdmin, (req, res) => {
  const secret = req.body?.secret || require('crypto').randomBytes(24).toString('hex');
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('email_webhook_secret', String(secret));
  res.json({ secret });
});

app.put('/api/settings/ai-key', requireAdmin, (req, res) => {
  const { provider, key } = req.body;
  const upd = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  if (provider) upd.run('ai_provider', String(provider));
  if (key !== undefined) upd.run('ai_api_key', String(key));
  res.json({ ok: true });
});

app.get('/api/settings/integrations', requireAdmin, (req, res) => {
  const get = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  res.json({
    has_anthropic:     !!(get('anthropic_api_key') || process.env.ANTHROPIC_API_KEY),
    has_beehiiv:       !!get('beehiiv_api_key'),
    has_youtube:       !!get('youtube_api_key'),
    has_etsy:          !!get('etsy_api_key'),
    has_teslemetry:    !!get('teslemetry_api_key'),
    has_aviationstack: !!get('aviationstack_api_key'),
    has_lastfm:        !!(get('lastfm_api_key') && get('lastfm_user')),
    lastfm_user:       get('lastfm_user') || '',
    has_nextdns:       !!get('nextdns_api_key'),
    has_beszel:        !!(get('beszel_url') && get('beszel_user')),
    beszel_url:        get('beszel_url'),
    has_plex:          !!(get('plex_url') && get('plex_token')),
    plex_url:          get('plex_url'),
    has_moen:          !!(get('moen_user') && get('moen_pass')),
    has_unifi:         !!(get('unifi_url') && get('unifi_user') && get('unifi_pass')),
    unifi_url:         get('unifi_url'),
    unifi_site:        get('unifi_site') || 'default',
    unifi_pull_interval: get('unifi_pull_interval') || '60',
    ha_moen_flow:      get('ha_moen_flow'),
    ha_moen_pressure:  get('ha_moen_pressure'),
    ha_moen_daily:     get('ha_moen_daily'),
    ha_moen_mode:      get('ha_moen_mode'),
    ha_moen_alert:     get('ha_moen_alert'),
    ha_unifi_clients:  get('ha_unifi_clients'),
    ha_unifi_rx:       get('ha_unifi_rx'),
    ha_unifi_tx:       get('ha_unifi_tx'),
    ha_unifi_ap_count: get('ha_unifi_ap_count'),
    ha_person_entities:  get('ha_person_entities'),
    ha_climate_entity:   get('ha_climate_entity'),
    presence_source:     get('presence_source') || 'both',
    ha_sensor_entities:    get('ha_sensor_entities'),
    homey_sensor_devices:  get('homey_sensor_devices'),
    homey_person_devices: get('homey_person_devices'),
    homey_climate_device: get('homey_climate_device'),
  });
});
app.put('/api/settings/integrations', requireAdmin, (req, res) => {
  const upd = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  if (req.body.anthropic_api_key     !== undefined) upd.run('anthropic_api_key',     String(req.body.anthropic_api_key));
  if (req.body.beehiiv_api_key       !== undefined) upd.run('beehiiv_api_key',       String(req.body.beehiiv_api_key));
  if (req.body.youtube_api_key       !== undefined) upd.run('youtube_api_key',       String(req.body.youtube_api_key));
  if (req.body.etsy_api_key          !== undefined) upd.run('etsy_api_key',          String(req.body.etsy_api_key));
  if (req.body.teslemetry_api_key    !== undefined) upd.run('teslemetry_api_key',    String(req.body.teslemetry_api_key));
  if (req.body.aviationstack_api_key !== undefined) upd.run('aviationstack_api_key', String(req.body.aviationstack_api_key));
  if (req.body.lastfm_api_key        !== undefined) upd.run('lastfm_api_key',        String(req.body.lastfm_api_key));
  if (req.body.lastfm_user           !== undefined) upd.run('lastfm_user',           String(req.body.lastfm_user));
  if (req.body.nextdns_api_key       !== undefined) upd.run('nextdns_api_key',       String(req.body.nextdns_api_key));
  if (req.body.beszel_url            !== undefined) upd.run('beszel_url',            String(req.body.beszel_url));
  if (req.body.beszel_user           !== undefined) upd.run('beszel_user',           String(req.body.beszel_user));
  if (req.body.beszel_pass           !== undefined) upd.run('beszel_pass',           String(req.body.beszel_pass));
  if (req.body.plex_url              !== undefined) upd.run('plex_url',              String(req.body.plex_url));
  if (req.body.plex_token            !== undefined) upd.run('plex_token',            String(req.body.plex_token));
  if (req.body.moen_user             !== undefined) upd.run('moen_user',             String(req.body.moen_user));
  if (req.body.moen_pass             !== undefined) upd.run('moen_pass',             String(req.body.moen_pass));
  if (req.body.unifi_url             !== undefined) upd.run('unifi_url',             String(req.body.unifi_url));
  if (req.body.unifi_user            !== undefined) upd.run('unifi_user',            String(req.body.unifi_user));
  if (req.body.unifi_pass            !== undefined) upd.run('unifi_pass',            String(req.body.unifi_pass));
  if (req.body.unifi_site            !== undefined) upd.run('unifi_site',            String(req.body.unifi_site));
  if (req.body.unifi_pull_interval   !== undefined) upd.run('unifi_pull_interval',   String(req.body.unifi_pull_interval));
  let clearMoenCache = false, clearUnifiCache = false;
  if (req.body.ha_moen_flow     !== undefined) { upd.run('ha_moen_flow',     String(req.body.ha_moen_flow));     clearMoenCache = true; }
  if (req.body.ha_moen_pressure !== undefined) { upd.run('ha_moen_pressure', String(req.body.ha_moen_pressure)); clearMoenCache = true; }
  if (req.body.ha_moen_daily    !== undefined) { upd.run('ha_moen_daily',    String(req.body.ha_moen_daily));    clearMoenCache = true; }
  if (req.body.ha_moen_mode     !== undefined) { upd.run('ha_moen_mode',     String(req.body.ha_moen_mode));     clearMoenCache = true; }
  if (req.body.ha_moen_alert    !== undefined) { upd.run('ha_moen_alert',    String(req.body.ha_moen_alert));    clearMoenCache = true; }
  if (req.body.ha_unifi_clients   !== undefined) { upd.run('ha_unifi_clients',   String(req.body.ha_unifi_clients));   clearUnifiCache = true; }
  if (req.body.ha_unifi_rx        !== undefined) { upd.run('ha_unifi_rx',        String(req.body.ha_unifi_rx));        clearUnifiCache = true; }
  if (req.body.ha_unifi_tx        !== undefined) { upd.run('ha_unifi_tx',        String(req.body.ha_unifi_tx));        clearUnifiCache = true; }
  if (req.body.ha_unifi_ap_count  !== undefined) { upd.run('ha_unifi_ap_count',  String(req.body.ha_unifi_ap_count));  clearUnifiCache = true; }
  let clearPersonCache = false, clearClimateCache = false;
  if (req.body.ha_person_entities   !== undefined) { upd.run('ha_person_entities',   String(req.body.ha_person_entities));   clearPersonCache = true; }
  if (req.body.presence_source      !== undefined) { upd.run('presence_source',      String(req.body.presence_source));      clearPersonCache = true; }
  if (req.body.ha_climate_entity    !== undefined) { upd.run('ha_climate_entity',    String(req.body.ha_climate_entity));    clearClimateCache = true; }
  if (req.body.ha_sensor_entities   !== undefined) { upd.run('ha_sensor_entities',   String(req.body.ha_sensor_entities));   delete _wCache['ha_sensors']; }
  if (req.body.homey_sensor_devices !== undefined) { upd.run('homey_sensor_devices', String(req.body.homey_sensor_devices)); delete _wCache['ha_sensors']; }
  if (req.body.homey_person_devices !== undefined) { upd.run('homey_person_devices', String(req.body.homey_person_devices)); clearPersonCache = true; }
  if (req.body.homey_climate_device !== undefined) { upd.run('homey_climate_device', String(req.body.homey_climate_device)); clearClimateCache = true; }
  // Clear widget cache so next poll picks up the new entity IDs immediately
  if (clearMoenCache)   { delete _wCache['moen:ha']; delete _wCache['moen:direct']; }
  if (clearUnifiCache)  { for (const k of Object.keys(_wCache)) if (k.startsWith('unifi:')) delete _wCache[k]; }
  if (clearPersonCache) { delete _wCache['who_home']; }
  if (clearClimateCache){ delete _wCache['thermostat']; }
  res.json({ ok: true });
});

// ── WiFi QR ───────────────────────────────────────────────────────────────────
const QRCode = require('qrcode');

app.put('/api/settings/wifi', requireAdmin, (req, res) => {
  const { wifi_ssid, wifi_password } = req.body;
  const upd = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  if (wifi_ssid    !== undefined) upd.run('wifi_ssid',    String(wifi_ssid));
  if (wifi_password !== undefined) upd.run('wifi_password', String(wifi_password));
  res.json({ ok: true });
});

app.get('/api/wifi/qr', requireAuth, async (req, res) => {
  const gs = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  const ssid = gs('wifi_ssid');
  const password = gs('wifi_password');
  if (!ssid) return res.status(404).json({ error: 'WiFi not configured' });
  // Escape chars that have special meaning in the WiFi QR format
  const esc = s => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/"/g, '\\"').replace(/:/g, '\\:');
  const wifiStr = `WIFI:T:WPA;S:${esc(ssid)};P:${esc(password)};;`;
  const dataUrl = await QRCode.toDataURL(wifiStr, {
    width: 300, margin: 2,
    color: { dark: '#FFFFFF', light: '#1A1B21' },
  });
  res.json({ dataUrl, ssid });
});

app.put('/api/settings/email', requireAdmin, (req, res) => {
  const { resend_api_key, resend_from, email_to, daily_summary_time, kith_url, weekly_digest_enabled, daily_summary_enabled } = req.body;
  const upd = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  if (resend_api_key)       upd.run('resend_api_key',      String(resend_api_key));
  if (resend_from  !== undefined) upd.run('resend_from',   String(resend_from));
  if (email_to     !== undefined) upd.run('email_to',      String(email_to));
  if (daily_summary_time !== undefined) upd.run('daily_summary_time', String(daily_summary_time));
  if (kith_url     !== undefined) upd.run('kith_url',      String(kith_url));
  if (weekly_digest_enabled !== undefined) upd.run('weekly_digest_enabled', weekly_digest_enabled ? '1' : '0');
  if (daily_summary_enabled !== undefined) upd.run('daily_summary_enabled', daily_summary_enabled ? '1' : '0');
  res.json({ ok: true });
});

// ── Sports (ESPN) ─────────────────────────────────────────────────────────────
const _sportsCache = {};
const _sportsCacheAt = {};
const SPORTS_TTL = 2 * 60 * 1000;
const ESPN_PATHS = {
  nfl:'football/nfl', nba:'basketball/nba', mlb:'baseball/mlb', nhl:'hockey/nhl',
  mls:'soccer/usa.1', epl:'soccer/eng.1', ucl:'soccer/uefa.champions',
  wwc:'soccer/fifa.womens.world', wc:'soccer/fifa.world',
  ncaaf:'football/college-football', ncaab:'basketball/mens-college-basketball',
  wnba:'basketball/wnba', pga:'golf/pga', atp:'tennis/atp',
  nascar:'racing/nascar', f1:'racing/f1',
};

app.get('/api/sports', async (req, res) => {
  const getSetting = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
  const leagues = (getSetting('sports_leagues') || 'nba,nfl,mlb,nhl').split(',').filter(Boolean);
  const customPaths = (getSetting('custom_sport_paths') || '').split(',').map(s=>s.trim()).filter(Boolean);
  const customEntries = customPaths.map(p => ({ key: `custom:${p}`, path: p }));
  const now = Date.now();
  const results = [];
  const leagueEntries = leagues.map(l => ({ key: l, path: ESPN_PATHS[l] })).filter(e => e.path);
  await Promise.all([...leagueEntries, ...customEntries].map(async ({ key, path: espnPath }) => {
    const league = key;
    if (_sportsCache[league] && now - _sportsCacheAt[league] < SPORTS_TTL) {
      results.push(..._sportsCache[league]); return;
    }
    try {
      const data = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard`).then(r => r.json());
      const games = (data.events || []).map(ev => {
        const comp = ev.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');
        const st = comp.status?.type;
        return {
          id: ev.id, league: league.toUpperCase(),
          home: { abbr: home?.team?.abbreviation, score: home?.score },
          away: { abbr: away?.team?.abbreviation, score: away?.score },
          state: st?.state, detail: st?.shortDetail,
        };
      });
      _sportsCache[league] = games;
      _sportsCacheAt[league] = now;
      results.push(...games);
    } catch { if (_sportsCache[league]) results.push(..._sportsCache[league]); }
  }));
  res.json(results);
});

// ── News (RSS) ─────────────────────────────────────────────────────────────────
let _newsCache = null;
let _newsCacheAt = 0;
const NEWS_TTL = 15 * 60 * 1000;

function decodeXmlEntities(s) {
  return s.replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCharCode(parseInt(h,16)));
}

function parseRSS(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null && items.length < 5) {
    const block = m[1];
    const rawTitle = (/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s.exec(block)||[])[1]?.trim();
    const title = rawTitle ? decodeXmlEntities(rawTitle) : undefined;
    const link = (/<link>\s*(https?:\/\/[^<]+)\s*<\/link>/s.exec(block)||[])[1]?.trim() ||
                 (/<guid[^>]*>\s*(https?:\/\/[^<]+)\s*<\/guid>/s.exec(block)||[])[1]?.trim();
    if (title && link) items.push({ title, link });
  }
  return items;
}

app.get('/api/news', async (req, res) => {
  if (_newsCache && Date.now() - _newsCacheAt < NEWS_TTL) return res.json(_newsCache);
  const getSetting = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
  const feedUrls = (getSetting('news_feed') || 'https://feeds.npr.org/1001/rss.xml')
    .split(',').map(s => s.trim()).filter(Boolean);
  try {
    const results = await Promise.all(feedUrls.map(async url => {
      try {
        const xml = await fetch(url, { headers: { 'User-Agent': 'Kith/1.0' } }).then(r => r.text());
        return parseRSS(xml);
      } catch { return []; }
    }));
    const flat = results.flat();
    for (let i = flat.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [flat[i], flat[j]] = [flat[j], flat[i]]; }
    _newsCache = flat.slice(0, 20);
    _newsCacheAt = Date.now();
    res.json(_newsCache);
  } catch (e) {
    if (_newsCache) return res.json(_newsCache);
    res.status(500).json({ error: e.message });
  }
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
    title: 'Kith — Chores Due',
    body: `${due.length} chore${due.length > 1 ? 's' : ''} need attention: ${due.map(c => c.name).join(', ')}`,
    tag: 'chores',
  });
});

// Evening nudge at 6pm for anything still uncompleted
cron.schedule('0 18 * * *', async () => {
  updateChoreStatuses();
  const due = db.prepare("SELECT * FROM chores WHERE status IN ('due','overdue') AND done=0").all();
  if (!due.length) return;
  await sendPushToAll({
    title: 'Kith — Still Pending',
    body: `${due.length} chore${due.length > 1 ? 's' : ''} still need attention: ${due.map(c => c.name).join(', ')}`,
    tag: 'chores-pm',
  });
});

// Event reminders — check every 15 min, push 30 min before
cron.schedule('*/15 * * * *', async () => {
  const now   = new Date();
  const soon  = new Date(now.getTime() + 30 * 60 * 1000);
  const dateStr = localDate(soon);
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

// ── Routes: Countdowns ───────────────────────────────────────────────────────
app.get('/api/countdowns', (req, res) => {
  res.json(db.prepare('SELECT * FROM countdowns ORDER BY date').all());
});

app.post('/api/countdowns', requireAuth, (req, res) => {
  const { label, date, emoji = '🎉' } = req.body;
  if (!label?.trim() || !date) return res.status(400).json({ error: 'label and date are required' });
  const r = db.prepare('INSERT INTO countdowns (label,date,emoji) VALUES (?,?,?)').run(label.trim(), date, emoji);
  res.json({ id: r.lastInsertRowid, label: label.trim(), date, emoji });
});

app.put('/api/countdowns/:id', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM countdowns WHERE id=?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found' });
  const label = req.body?.label?.trim() || c.label;
  const date  = req.body?.date  || c.date;
  const emoji = req.body?.emoji || c.emoji;
  db.prepare('UPDATE countdowns SET label=?,date=?,emoji=? WHERE id=?').run(label, date, emoji, c.id);
  res.json({ id: c.id, label, date, emoji });
});

app.delete('/api/countdowns/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM countdowns WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ── Routes: Family Members ────────────────────────────────────────────────────
app.get('/api/members', (req, res) => {
  res.json(db.prepare('SELECT * FROM family_members ORDER BY created_at').all());
});

app.put('/api/members/:id/pin', requireAdmin, async (req, res) => {
  const { pin } = req.body;
  if (!String(pin || '').match(/^\d{4,8}$/)) return res.status(400).json({ error: 'PIN must be 4–8 digits' });
  const hash = await bcrypt.hash(String(pin), 10);
  db.prepare('UPDATE family_members SET pin_hash=? WHERE id=?').run(hash, Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/members', requireAdmin, (req, res) => {
  const { name, color = '#007AFF', initials } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const init = initials || name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const r = db.prepare('INSERT INTO family_members (name,color,initials) VALUES (?,?,?)').run(name.trim(), color, init);
  res.json({ id: r.lastInsertRowid, name: name.trim(), color, initials: init });
});

app.delete('/api/members/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE events SET member_id=NULL WHERE member_id=?').run(id);
  db.prepare('DELETE FROM chore_completions WHERE member_id=?').run(id);
  db.prepare('DELETE FROM family_members WHERE id=?').run(id);
  res.json({ ok: true });
});

app.put('/api/members/:id', requireAdmin, (req, res) => {
  const m = db.prepare('SELECT * FROM family_members WHERE id=?').get(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Not found' });
  const name  = req.body?.name?.trim() || m.name;
  const color = req.body?.color || m.color;
  const initials = name.split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || m.initials;
  db.prepare('UPDATE family_members SET name=?,color=?,initials=? WHERE id=?').run(name, color, initials, m.id);
  res.json(db.prepare('SELECT * FROM family_members WHERE id=?').get(m.id));
});

app.put('/api/members/:id/goal', requireAdmin, (req, res) => {
  const { monthly_goal, reward } = req.body || {};
  db.prepare('UPDATE family_members SET monthly_goal=?,reward=? WHERE id=?')
    .run(Number(monthly_goal) || 0, (reward || '').trim(), Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/members/progress', (req, res) => {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const members = db.prepare('SELECT * FROM family_members ORDER BY created_at').all();
  const rows = db.prepare(
    'SELECT member_id, SUM(points) as points FROM chore_completions WHERE date(completed_at) >= ? GROUP BY member_id'
  ).all(monthStart);
  const ptMap = Object.fromEntries(rows.map(r => [r.member_id, r.points]));
  res.json(members.map(m => ({
    id: m.id, name: m.name, color: m.color, initials: m.initials,
    monthly_goal: m.monthly_goal || 0,
    reward: m.reward || '',
    points: ptMap[m.id] || 0,
  })));
});

// ── Routes: Household Goals ───────────────────────────────────────────────────
app.get('/api/goals', (req, res) => {
  res.json(db.prepare('SELECT * FROM household_goals ORDER BY created_at').all());
});

app.post('/api/goals', requireAdmin, (req, res) => {
  const { name, description='', progress_type='percent', progress_current=0, progress_target=100, unit='', deadline='' } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const target = Number(progress_target) || 100;
  const r = db.prepare(
    'INSERT INTO household_goals (name,description,progress_type,progress_current,progress_target,unit,deadline) VALUES (?,?,?,?,?,?,?)'
  ).run(name.trim(), (description||'').trim(), progress_type||'percent', Number(progress_current)||0, target, (unit||'').trim(), deadline||'');
  res.json(db.prepare('SELECT * FROM household_goals WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/goals/:id', requireAdmin, (req, res) => {
  const g = db.prepare('SELECT * FROM household_goals WHERE id=?').get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  const { name, description, progress_type, progress_current, progress_target, unit, deadline } = req.body || {};
  db.prepare(
    'UPDATE household_goals SET name=?,description=?,progress_type=?,progress_current=?,progress_target=?,unit=?,deadline=? WHERE id=?'
  ).run(
    (name ?? g.name).trim(),
    ((description ?? g.description) || '').trim(),
    progress_type ?? g.progress_type,
    Number(progress_current ?? g.progress_current) || 0,
    Number(progress_target ?? g.progress_target) || 100,
    ((unit ?? g.unit) || '').trim(),
    deadline ?? g.deadline,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM household_goals WHERE id=?').get(req.params.id));
});

app.delete('/api/goals/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM household_goals WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Routes: Notes ─────────────────────────────────────────────────────────────
app.get('/api/notes', (req, res) => {
  res.json(db.prepare('SELECT * FROM notes ORDER BY pinned DESC, created_at DESC').all());
});

app.post('/api/notes', requireAdmin, (req, res) => {
  const { title, content='', color='#FAFAF5', pinned=0 } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  const r = db.prepare('INSERT INTO notes (title,content,color,pinned) VALUES (?,?,?,?)').run(title.trim(), content, color, pinned?1:0);
  res.json(db.prepare('SELECT * FROM notes WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/notes/:id', requireAdmin, (req, res) => {
  const n = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
  if (!n) return res.status(404).json({ error: 'Not found' });
  const { title, content, color, pinned } = req.body || {};
  db.prepare('UPDATE notes SET title=?,content=?,color=?,pinned=? WHERE id=?')
    .run(
      (title ?? n.title).trim(),
      content ?? n.content,
      color ?? n.color,
      pinned != null ? (pinned ? 1 : 0) : n.pinned,
      req.params.id
    );
  res.json(db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id));
});

app.delete('/api/notes/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM notes WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Routes: Polls ─────────────────────────────────────────────────────────────
app.get('/api/polls', (req, res) => {
  res.json(db.prepare('SELECT * FROM polls ORDER BY created_at DESC').all().map(p => {
    try { return { ...p, options: JSON.parse(p.options), votes: JSON.parse(p.votes || '{}') }; }
    catch { return { ...p, options: [], votes: {} }; }
  }));
});

app.post('/api/polls', requireAdmin, (req, res) => {
  const { question, options } = req.body || {};
  if (!question?.trim() || !Array.isArray(options) || options.filter(o=>o?.trim()).length < 2)
    return res.status(400).json({ error: 'question and at least 2 options required' });
  const opts = options.filter(o => o?.trim()).map(o => o.trim());
  const r = db.prepare('INSERT INTO polls (question,options,votes) VALUES (?,?,?)').run(question.trim(), JSON.stringify(opts), '{}');
  const p = db.prepare('SELECT * FROM polls WHERE id=?').get(r.lastInsertRowid);
  res.json({ ...p, options: JSON.parse(p.options), votes: {} });
});

app.post('/api/polls/:id/vote', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM polls WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  let options, votes;
  try { options = JSON.parse(p.options); } catch { return res.status(500).json({ error: 'Corrupt poll data' }); }
  try { votes = JSON.parse(p.votes || '{}'); } catch { votes = {}; }
  const { option } = req.body || {};
  if (typeof option !== 'number' || option < 0 || option >= options.length)
    return res.status(400).json({ error: 'Invalid option index' });
  votes[option] = (votes[option] || 0) + 1;
  db.prepare('UPDATE polls SET votes=? WHERE id=?').run(JSON.stringify(votes), p.id);
  res.json({ votes });
});

app.delete('/api/polls/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM polls WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── SSE stream endpoint ───────────────────────────────────────────────────────
app.get('/api/events/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  _sseClients.add(res);
  // Heartbeat every 25s — cleans up on failed write (handles abrupt disconnects)
  const hb = setInterval(() => {
    try { res.write(':ping\n\n'); }
    catch { clearInterval(hb); _sseClients.delete(res); }
  }, 25000);
  req.on('close', () => { clearInterval(hb); _sseClients.delete(res); });
});

// ── Routes: Home Assistant webhook ───────────────────────────────────────────
app.post('/api/webhook/ha', (req, res) => {
  const secret = db.prepare("SELECT value FROM settings WHERE key='ha_webhook_secret'").get()?.value;
  const provided = req.headers['x-ha-secret'] || req.query.secret;
  if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });
  const { title, message='', icon='🏠' } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  // Auto-clean events older than 24h
  db.prepare("DELETE FROM ha_events WHERE created_at < datetime('now','-24 hours')").run();
  const r = db.prepare('INSERT INTO ha_events (title,message,icon) VALUES (?,?,?)').run(title.trim(), message, icon);
  // Push to all connected browsers immediately
  broadcastSSE('activity', {
    id: r.lastInsertRowid, title: title.trim(), message, icon, source: 'ha',
    created_at: new Date().toISOString(),
  });
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.get('/api/ha/events', (req, res) => {
  db.prepare("DELETE FROM ha_events WHERE created_at < datetime('now','-24 hours')").run();
  res.json(db.prepare("SELECT * FROM ha_events ORDER BY created_at DESC LIMIT 10").all());
});

app.get('/api/ha/secret', requireAdmin, (req, res) => {
  const secret = db.prepare("SELECT value FROM settings WHERE key='ha_webhook_secret'").get()?.value || '';
  res.json({ secret });
});

app.put('/api/settings/smart-home', requireAdmin, (req, res) => {
  const { ha_url, ha_token, homey_url, homey_token } = req.body || {};
  const upd = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  if (ha_url !== undefined) upd.run('ha_url', String(ha_url));
  if (ha_token !== undefined && ha_token !== '') upd.run('ha_token', String(ha_token));
  if (homey_url !== undefined) upd.run('homey_url', String(homey_url));
  if (homey_token !== undefined && homey_token !== '') upd.run('homey_token', String(homey_token));
  // ADV-007: clear presence/thermostat caches when credentials change
  if (homey_url !== undefined || homey_token !== undefined) {
    delete _wCache['who_home'];
    delete _wCache['thermostat'];
  }
  // Reconnect real-time clients when credentials change
  if (ha_url !== undefined || ha_token !== undefined) haWsRestart();
  if (homey_url !== undefined || homey_token !== undefined) setTimeout(homeySocketConnect, 500);
  res.json({ ok: true });
});

app.get('/api/ha/smart-home-status', requireAdmin, (req, res) => {
  const get = k => db.prepare(`SELECT value FROM settings WHERE key=?`).get(k)?.value || '';
  res.json({
    ha: { url: get('ha_url'), hasToken: !!get('ha_token') },
    homey: { url: get('homey_url'), hasToken: !!get('homey_token') },
  });
});

// ── HA entity discovery — finds Moen/Flo and UniFi entities ─────────────────
app.post('/api/ha/discover', requireAdmin, async (req, res) => {
  const get = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  const haUrl = (req.body?.ha_url || get('ha_url')).replace(/\/$/, '');
  const haToken = req.body?.ha_token || get('ha_token');
  if (!haUrl || !haToken) return res.status(400).json({ error: 'HA URL and token required' });

  let states;
  try {
    const r = await fetch(`${haUrl}/api/states`, {
      headers: { 'Authorization': `Bearer ${haToken}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return res.status(400).json({ error: `HA returned ${r.status}: ${body.slice(0, 200)}` });
    }
    states = await r.json();
  } catch (e) {
    return res.status(400).json({ error: `Could not reach HA: ${e.message}` });
  }
  if (!Array.isArray(states)) return res.status(400).json({ error: 'Unexpected HA response format' });

  // Score and filter states for Moen/Flo
  const isMoen = s => /flo|moen/i.test(s.entity_id);
  const moenAll = states.filter(isMoen).map(s => ({
    entity_id: s.entity_id,
    state: s.state,
    unit: s.attributes?.unit_of_measurement || '',
    friendly_name: s.attributes?.friendly_name || s.entity_id,
  }));

  // Auto-map Moen entities by keyword
  const moenFind = (patterns) => moenAll.find(s =>
    patterns.some(p => s.entity_id.toLowerCase().includes(p))
  )?.entity_id || '';

  const moenMap = {
    flow:     moenFind(['flow_rate', 'current_flow']),
    pressure: moenFind(['pressure']),
    daily:    moenFind(['daily', 'consumption', 'usage', 'today']),
    mode:     moenFind(['mode', 'monitoring']),
    alert:    moenFind(['alert', 'leak', 'detector']),
  };

  // All entities for manual mapping — exclude meta/internal HA domains
  const SKIP_DOMAINS = new Set(['automation','script','scene','group','zone','input_boolean',
    'input_select','conversation','tts','media_player','camera','weather']);
  const allSensors = states
    .filter(s => {
      const domain = s.entity_id.split('.')[0];
      return !SKIP_DOMAINS.has(domain);
    })
    .map(s => ({
      entity_id: s.entity_id,
      state: s.state,
      unit: s.attributes?.unit_of_measurement || '',
      friendly_name: s.attributes?.friendly_name || s.entity_id,
    }))
    .sort((a, b) => {
      // sensor.*/binary_sensor.* float to top
      const aS = a.entity_id.startsWith('sensor.') || a.entity_id.startsWith('binary_sensor.');
      const bS = b.entity_id.startsWith('sensor.') || b.entity_id.startsWith('binary_sensor.');
      if (aS !== bS) return aS ? -1 : 1;
      return a.entity_id.localeCompare(b.entity_id);
    })
    .slice(0, 400);

  // Auto-detect likely UniFi entities for pre-selection
  const unifiLikely = allSensors.filter(s =>
    /unifi/i.test(s.entity_id) ||
    /unifi/i.test(s.friendly_name) ||
    s.entity_id.endsWith('_clients') ||
    (s.entity_id.endsWith('_rx') && ['Mbit/s','Mbps','kbps','KB/s','MB/s'].includes(s.unit)) ||
    (s.entity_id.endsWith('_tx') && ['Mbit/s','Mbps','kbps','KB/s','MB/s'].includes(s.unit))
  );

  const unifiFind = (patterns) => unifiLikely.find(s =>
    patterns.some(p => s.entity_id.toLowerCase().includes(p))
  )?.entity_id || '';

  const unifiMap = {
    clients: unifiFind(['_clients', 'clients']),
    rx:      unifiFind(['_rx', '_download', '_down']),
    tx:      unifiFind(['_tx', '_upload', '_up']),
  };

  const persons = states
    .filter(s => s.entity_id.startsWith('person.'))
    .map(s => ({
      entity_id: s.entity_id,
      state: s.state,
      friendly_name: s.attributes?.friendly_name || s.entity_id.replace('person.', ''),
    }));

  const climates = states
    .filter(s => s.entity_id.startsWith('climate.'))
    .map(s => ({
      entity_id: s.entity_id,
      state: s.state,
      current_temp: s.attributes?.current_temperature ?? null,
      friendly_name: s.attributes?.friendly_name || s.entity_id.replace('climate.', ''),
    }));

  res.json({ ok: true, moen: { all: moenAll, map: moenMap }, unifi: { all: unifiLikely, map: unifiMap }, allSensors, persons, climates });
});

// ── Homey device discovery — finds presence and thermostat devices ─────────
app.post('/api/homey/discover', requireAdmin, async (req, res) => {
  const get = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  const homeyUrl = (req.body?.homey_url || get('homey_url')).replace(/\/$/, '');
  const homeyToken = req.body?.homey_token || get('homey_token');
  if (!homeyUrl || !homeyToken) return res.status(400).json({ error: 'Homey URL and token required' });

  let raw;
  try {
    const r = await fetch(`${homeyUrl}/api/manager/devices/device/`, {
      headers: { 'Authorization': `Bearer ${homeyToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return res.status(400).json({ error: `Homey ${r.status}: ${body.slice(0, 200)}` });
    }
    raw = await r.json();
  } catch (e) {
    const detail = e.cause?.message || e.cause?.code || '';
    return res.status(400).json({ error: `Could not reach Homey: ${e.message}${detail ? ` (${detail})` : ''}` });
  }

  // ADV-001/005 fix: use 'result' in check so {result:null} correctly signals missing/scope error
  const devicesData = (raw && typeof raw === 'object' && 'result' in raw) ? raw.result : raw;
  if (!devicesData) {
    return res.status(400).json({ error: 'Homey returned empty device list — check your token has the devices scope (homey.device:read)' });
  }

  // F6 fix: when response is a map keyed by device ID, inject the key as `id` if missing
  const devices = Array.isArray(devicesData)
    ? devicesData
    : Object.entries(devicesData).map(([key, d]) => ({ ...d, id: d.id || key }));

  // Fetch Homey users — presence/who's home is tracked here, not in device capabilities
  let users = [];
  try {
    const ur = await fetch(`${homeyUrl}/api/manager/users/user/`, {
      headers: { 'Authorization': `Bearer ${homeyToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (ur.ok) {
      const urRaw = await ur.json();
      const usersData = (urRaw && typeof urRaw === 'object' && 'result' in urRaw) ? urRaw.result : urRaw;
      if (usersData && typeof usersData === 'object') {
        const usersArr = Array.isArray(usersData)
          ? usersData
          : Object.entries(usersData).map(([key, u]) => ({ ...u, id: u.id || key }));
        users = usersArr.map(u => ({ id: u.id, name: u.name || u.id, present: u.present ?? null }));
      }
    }
  } catch (_) { /* non-fatal — proceed without users */ }

  const thermostats = devices
    .filter(d => Array.isArray(d.capabilities) && d.capabilities.includes('measure_temperature'))
    .map(d => ({
      id: d.id,
      name: d.name || d.id,
      current_temp: d.capabilitiesObj?.measure_temperature?.value ?? null,
      target_temp:  d.capabilitiesObj?.target_temperature?.value ?? null,
    }));

  const allDevices = devices.map(d => ({
    id: d.id,
    name: d.name || d.id,
    zone: d.zoneName || '',
    capabilities: (d.capabilities || []).slice(0, 8), // cap for readability
  }));

  res.json({ ok: true, users, thermostats, allDevices });
});

app.get('/api/ha/pull', async (req, res) => {
  const get = k => db.prepare(`SELECT value FROM settings WHERE key=?`).get(k)?.value;
  const haUrl = get('ha_url'); const haToken = get('ha_token');
  const homeyUrl = get('homey_url'); const homeyToken = get('homey_token');

  const fetchHA = async () => {
    if (!haUrl || !haToken) return [];
    const base = haUrl.replace(/\/$/, '');
    const hdrs = { 'Authorization': `Bearer ${haToken}`, 'Content-Type': 'application/json' };
    // Only pull persistent notifications — these have human-authored titles and messages
    const states = await fetch(`${base}/api/states`, { headers: hdrs, signal: AbortSignal.timeout(6000) }).then(r => r.json()).catch(() => []);
    return (Array.isArray(states) ? states : [])
      .filter(s => s.entity_id?.startsWith('persistent_notification.') && s.state !== 'dismissed')
      .map(s => ({ title: s.attributes?.title || s.entity_id.replace('persistent_notification.', ''), message: s.attributes?.message || '', icon: '🏠', source: 'ha', created_at: s.last_changed || new Date().toISOString() }));
  };

  const fetchHomey = async () => {
    if (!homeyUrl || !homeyToken) return [];
    const base = homeyUrl.replace(/\/$/, '');
    const hdrs = { 'Authorization': `Bearer ${homeyToken}` };
    const unwrap = r => (r && typeof r === 'object' && 'result' in r) ? r.result : r;

    // Timeline — flow execution history with notification messages
    const tlRaw = await fetch(`${base}/api/manager/timeline/timeline/`, { headers: hdrs, signal: AbortSignal.timeout(6000) }).then(r => r.json()).catch(() => null);
    const tlData = unwrap(tlRaw);
    if (tlData && Object.keys(tlData).length) console.log('[homey/timeline] sample entry:', JSON.stringify(Object.values(tlData)[0] ?? {}).slice(0, 300));
    const timeline = tlData && typeof tlData === 'object'
      ? Object.values(tlData).map(n => {
          // dateCreated may be Unix seconds or ms — normalize to ISO string
          let created_at = new Date().toISOString();
          if (n.dateCreated) {
            const num = Number(n.dateCreated);
            if (!isNaN(num)) {
              // Unix seconds if < 1e10, ms if >= 1e10
              created_at = new Date(num < 1e10 ? num * 1000 : num).toISOString();
            } else {
              created_at = n.dateCreated;
            }
          }
          return { title: n.title || n.excerpt || 'Homey', message: n.excerpt || '', icon: '🏡', source: 'homey', created_at };
        })
      : [];

    return timeline.slice(0, 15);
  };

  try {
    const [haEvents, homeyEvents] = await Promise.all([fetchHA().catch(()=>[]), fetchHomey().catch(()=>[])]);
    // Homey first — timeline entries are human-readable flow notifications
    const merged = [...homeyEvents, ...haEvents].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
    res.json(merged);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Routes: Quick Actions ─────────────────────────────────────────────────────
app.get('/api/quick-actions', (req, res) => {
  const raw = db.prepare("SELECT value FROM settings WHERE key='quick_actions'").get()?.value;
  try { res.json(JSON.parse(raw || '[]')); } catch { res.json([]); }
});

app.put('/api/quick-actions', requireAdmin, (req, res) => {
  const { actions } = req.body || {};
  if (!Array.isArray(actions)) return res.status(400).json({ error: 'actions must be an array' });
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('quick_actions',?)").run(JSON.stringify(actions));
  res.json({ ok: true });
});

app.post('/api/quick-actions/trigger', requireAuth, async (req, res) => {
  const { id } = req.body || {};
  const raw = db.prepare("SELECT value FROM settings WHERE key='quick_actions'").get()?.value;
  let actions; try { actions = JSON.parse(raw || '[]'); } catch { actions = []; }
  const action = actions.find(a => a.id === id);
  if (!action) return res.status(404).json({ error: 'Action not found' });
  try {
    let extraHeaders = {};
    try { extraHeaders = JSON.parse(action.headers || '{}'); } catch {}
    const opts = {
      method: action.method || 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
    };
    if (action.body && action.method !== 'GET') opts.body = action.body;
    const r = await fetch(action.url, { ...opts, signal: AbortSignal.timeout(8000) });
    res.json({ ok: r.ok, status: r.status });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Routes: Widgets ───────────────────────────────────────────────────────────
const _wCache = {};
const _wErrors = {};
// Soft-invalidate: force a refetch next call while preserving stale data as fallback
function _wInvalidate(key) { if (_wCache[key]) _wCache[key].at = 0; }
async function _wFetch(key, ttlMs, fn) {
  if (_wCache[key] && Date.now() - _wCache[key].at < ttlMs) return _wCache[key].data;
  try {
    const data = await fn();
    const cacheable = data !== null && data !== undefined;
    if (cacheable) { _wCache[key] = { data, at: Date.now() }; delete _wErrors[key]; }
    return data;
  } catch(e) {
    _wErrors[key] = e?.message || String(e);
    console.error(`[widget:${key}]`, e?.message || e);
    return _wCache[key]?.data ?? null;
  }
}
const gs = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';

app.get('/api/widgets/data', async (req, res) => {
  const result = {};
  const p = [];

  if (gs('widget_quote_enabled') === '1')
    p.push(_wFetch(`quote:${new Date().toISOString().slice(0,10)}`, 86400000, async () => {
      const r = await fetch('https://zenquotes.io/api/random', { signal: AbortSignal.timeout(6000) });
      const d = await r.json(); return { text: d[0].q, author: d[0].a };
    }).then(d => { if (d) result.quote = d; }));

  const tickers = gs('widget_stocks_tickers');
  if (tickers)
    p.push(_wFetch(`stocks:${tickers}`, 300000, async () => {
      // Stooq: free, no key, one request per symbol
      const syms = tickers.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 5);
      const results = (await Promise.all(syms.map(async sym => {
        try {
          const r = await fetch(`https://stooq.com/q/l/?s=${sym.toLowerCase()}.us&f=sd2t2ohlcv&h&e=json`, { signal: AbortSignal.timeout(6000) });
          if (!r.ok) return null;
          const d = await r.json();
          const s = d.symbols?.[0];
          if (!s?.close) return null;
          const change = s.open ? (((s.close - s.open) / s.open) * 100).toFixed(2) : '0.00';
          return { ticker: sym, price: s.close.toFixed(2), change };
        } catch { return null; }
      }))).filter(Boolean);
      return results.length ? results : null;
    }).then(d => { if (d?.length) result.stocks = d; }));

  if (gs('widget_producthunt_enabled') === '1')
    p.push(_wFetch('producthunt', 3600000, async () => {
      const r = await fetch('https://www.producthunt.com/feed', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const text = await r.text();
      // Product Hunt uses Atom format (<entry> not <item>)
      return [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 5).map(m => ({
        title: (m[1].match(/<title>(.*?)<\/title>/)?.[1] || '').trim(),
        tagline: (m[1].match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] || '')
          .replace(/&lt;[^&]*?&gt;/g, '').replace(/&amp;/g, '&')
          .split('\n').map(l => l.trim()).filter(l => l && l !== 'Discuss')[0]?.slice(0, 80) || '',
      })).filter(i => i.title);
    }).then(d => { if (d?.length) result.producthunt = d; }));

  const ghUser = gs('widget_github_username');
  if (ghUser)
    p.push(_wFetch(`github:${ghUser}`, 3600000, async () => {
      const r = await fetch(`https://github-contributions-api.jogruber.de/v4/${ghUser}?y=last`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      const d = await r.json();
      const days = (d.contributions || []).slice(-30);
      if (!days.length) return null;
      return { username: ghUser, days: days.map(c => c.count), total: days.reduce((s, c) => s + c.count, 0) };
    }).then(d => { if (d) result.github = d; }));

  const subRaw = gs('widget_reddit_subreddit');
  const sub = subRaw.split(',').map(s => s.trim().replace(/^r\//i, '')).filter(Boolean).join('+');
  const subLabel = subRaw.split(',').map(s => s.trim().replace(/^r\//i, '')).filter(Boolean).join(', ');
  if (sub)
    p.push(_wFetch(`reddit:${sub}`, 600000, async () => {
      const r = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=8`, { headers: { 'User-Agent': 'kith-dashboard/1.0' }, signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      return { sub: subLabel, posts: (d.data?.children || []).slice(0, 6).map(c => ({ title: c.data.title, score: c.data.score, sub: c.data.subreddit })) };
    }).then(d => { if (d?.posts?.length) result.reddit = d; }));

  const beehiivKey = gs('beehiiv_api_key');
  if (beehiivKey)
    p.push(_wFetch('beehiiv', 3600000, async () => {
      const pr = await fetch('https://api.beehiiv.com/v2/publications', { headers: { 'Authorization': `Bearer ${beehiivKey}` }, signal: AbortSignal.timeout(8000) });
      const pd = await pr.json();
      const pub = pd.data?.[0]; if (!pub) return null;
      const r = await fetch(`https://api.beehiiv.com/v2/publications/${pub.id}`, { headers: { 'Authorization': `Bearer ${beehiivKey}` }, signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      const subscribers = d.data?.stats?.total_active_subscriptions;
      if (typeof subscribers !== 'number') return null;
      return { name: d.data?.name, subscribers };
    }).then(d => { if (d) result.beehiiv = d; }));

  const ytKey = gs('youtube_api_key');
  const ytHandle = gs('widget_youtube_handle');
  if (ytKey && ytHandle) {
    const handle = ytHandle.startsWith('@') ? ytHandle : `@${ytHandle}`;
    p.push(_wFetch(`youtube:${handle}`, 3600000, async () => {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${encodeURIComponent(handle)}&key=${ytKey}`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      const ch = d.items?.[0]; if (!ch) return null;
      return { name: ch.snippet?.title, subscribers: parseInt(ch.statistics?.subscriberCount || 0), views: parseInt(ch.statistics?.viewCount || 0) };
    }).then(d => { if (d) result.youtube = d; }));
  }

  const etsyKey = gs('etsy_api_key');
  const etsyShop = gs('widget_etsy_shop');
  if (etsyKey && etsyShop)
    p.push(_wFetch(`etsy:${etsyShop}`, 3600000, async () => {
      const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${etsyShop}`, { headers: { 'x-api-key': etsyKey }, signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      if (!d.shop_name) return null;
      return { name: d.shop_name, sales: d.transaction_sold_count ?? 0, listings: d.listing_active_count ?? 0 };
    }).then(d => { if (d) result.etsy = d; }));

  const teslaKey = gs('teslemetry_api_key');
  if (teslaKey)
    p.push(_wFetch(`teslemetry`, 60000, async () => {
      // Auto-discover energy site ID
      const _sid = _wCache['teslemetry:site_id'];
      let siteId = (_sid && Date.now() - _sid.at < 86400000) ? _sid.data : null;
      if (!siteId) {
        const pr = await fetch('https://api.teslemetry.com/api/1/products', {
          headers: { 'Authorization': `Bearer ${teslaKey}` }, signal: AbortSignal.timeout(8000),
        });
        const pd = await pr.json();
        siteId = pd.response?.find(p => p.energy_site_id)?.energy_site_id;
        if (!siteId) return null;
        _wCache['teslemetry:site_id'] = { data: siteId, at: Date.now() };
      }
      const r = await fetch(`https://api.teslemetry.com/api/1/energy_sites/${siteId}/live_status`, {
        headers: { 'Authorization': `Bearer ${teslaKey}` }, signal: AbortSignal.timeout(8000),
      });
      const d = await r.json();
      const s = d.response;
      if (!s) return null;
      return {
        battery_pct:  Math.round(s.percentage_charged ?? 0),
        solar_kw:     Math.round((s.solar_power ?? 0) / 100) / 10,
        grid_kw:      Math.round((s.grid_power  ?? 0) / 100) / 10,
        load_kw:      Math.round((s.load_power  ?? 0) / 100) / 10,
        battery_kw:   Math.round((s.battery_power ?? 0) / 100) / 10,
        grid_status:  s.grid_status ?? 'Active',
      };
    }).then(d => { if (d) result.powerwall = d; }));

  const aviationKey = gs('aviationstack_api_key');
  const flightNum = gs('widget_flight_number').toUpperCase().replace(/\s/g, '');
  if (aviationKey && flightNum)
    p.push(_wFetch(`flight:${flightNum}`, 120000, async () => {
      const r = await fetch(`http://api.aviationstack.com/v1/flights?access_key=${aviationKey}&flight_iata=${flightNum}&limit=1`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      const f = d.data?.[0]; if (!f) return null;
      return {
        flight:    f.flight?.iata,
        airline:   f.airline?.name,
        status:    f.flight_status,
        dep_iata:  f.departure?.iata,
        dep_city:  f.departure?.airport,
        dep_sched: f.departure?.scheduled?.slice(11, 16),
        dep_actual:f.departure?.actual?.slice(11, 16) || f.departure?.estimated?.slice(11, 16),
        arr_iata:  f.arrival?.iata,
        arr_city:  f.arrival?.airport,
        arr_sched: f.arrival?.scheduled?.slice(11, 16),
        arr_actual:f.arrival?.actual?.slice(11, 16) || f.arrival?.estimated?.slice(11, 16),
      };
    }).then(d => { if (d) result.flight = d; }));

  const kumaUrl = gs('uptime_kuma_url');
  const kumaSlug = gs('uptime_kuma_slug');
  const uptimeUrls = gs('widget_uptime_urls');
  if (kumaUrl && kumaSlug)
    p.push(_wFetch(`kuma:${kumaUrl}:${kumaSlug}`, 60000, async () => {
      const base = kumaUrl.replace(/\/$/, '');
      const [pageRes, hbRes] = await Promise.all([
        fetch(`${base}/api/status-page/${kumaSlug}`, { signal: AbortSignal.timeout(8000) }),
        fetch(`${base}/api/status-page/heartbeat/${kumaSlug}`, { signal: AbortSignal.timeout(8000) }),
      ]);
      if (!pageRes.ok || !hbRes.ok) return null;
      const [page, hb] = await Promise.all([pageRes.json(), hbRes.json()]);
      const monitors = (page.publicGroupList || []).flatMap(g => g.monitorList || []);
      if (!monitors.length) return null;
      return monitors.map(m => {
        const beats = hb.heartbeatList?.[String(m.id)] || [];
        const latest = beats[beats.length - 1];
        const uptime = hb.uptimeList?.[`${m.id}_24`] ?? null;
        return { name: m.name, ok: latest?.status === 1, ms: latest?.ping ?? null, uptime };
      });
    }).then(d => { if (d?.length) result.uptime = d; }));
  else if (uptimeUrls)
    p.push(_wFetch(`uptime:${uptimeUrls}`, 60000, async () => {
      const urls = uptimeUrls.split(',').map(s => s.trim()).filter(Boolean);
      const checks = await Promise.all(urls.map(async raw => {
        const [labelPart, ...rest] = raw.split('|');
        const hasLabel = rest.length > 0;
        const url = hasLabel ? rest.join('|').trim() : raw;
        const urlFull = /^https?:\/\//.test(url) ? url : `https://${url}`;
        let name = hasLabel ? labelPart.trim() : url;
        if (!hasLabel) { try { name = new URL(urlFull).hostname.replace(/^www\./, ''); } catch {} }
        const start = Date.now();
        try {
          const r = await fetch(urlFull, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
          return { name, ok: r.status < 500, ms: Date.now() - start };
        } catch {
          return { name, ok: false, ms: null };
        }
      }));
      return checks.length ? checks : null;
    }).then(d => { if (d?.length) result.uptime = d; }));

  const nextdnsKey = gs('nextdns_api_key');
  const nextdnsProfile = gs('nextdns_profile_id');
  if (!nextdnsKey || !nextdnsProfile)
    console.log(`[nextdns] skipping — key=${!!nextdnsKey} profile=${JSON.stringify(nextdnsProfile)}`);
  if (nextdnsKey && nextdnsProfile)
    p.push(_wFetch(`nextdns:${nextdnsProfile}`, 300000, async () => {
      const headers = { 'X-Api-Key': nextdnsKey };
      const r = await fetch(`https://api.nextdns.io/profiles/${nextdnsProfile}/analytics/status?from=-24h`, { headers, signal: AbortSignal.timeout(8000) });
      if (!r.ok) {
        console.error(`[nextdns] API error ${r.status} for profile ${nextdnsProfile}`);
        return null;
      }
      const d = await r.json();
      const rows = d.data;
      if (!Array.isArray(rows)) {
        console.error('[nextdns] unexpected response shape:', JSON.stringify(d).slice(0, 200));
        return null;
      }
      const total = rows.reduce((s, x) => s + (x.queries || 0), 0);
      const blocked = rows.find(x => x.status === 'blocked')?.queries ?? 0;
      console.log(`[nextdns] profile=${nextdnsProfile} total=${total} blocked=${blocked}`);
      if (!total) return null;
      return { total, blocked, pct: Math.round((blocked / total) * 100) };
    }).then(d => { if (d) result.nextdns = d; }));

  const beszelUrl = gs('beszel_url');
  const beszelUser = gs('beszel_user');
  const beszelPass = gs('beszel_pass');
  if (beszelUrl && beszelUser && beszelPass)
    p.push(_wFetch(`beszel:${beszelUrl}`, 60000, async () => {
      const base = beszelUrl.replace(/\/$/, '');
      const authR = await fetch(`${base}/api/collections/users/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: beszelUser, password: beszelPass }),
        signal: AbortSignal.timeout(8000),
      });
      if (!authR.ok) return null;
      const { token } = await authR.json();
      const sysR = await fetch(`${base}/api/collections/systems/records?perPage=50&sort=name`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!sysR.ok) return null;
      const { items: systems } = await sysR.json();
      if (!systems?.length) return null;
      const servers = await Promise.all(systems.map(async sys => {
        try {
          const filter = encodeURIComponent(`system='${sys.id}'`);
          const statsR = await fetch(
            `${base}/api/collections/system_stats/records?filter=${filter}&sort=-created&perPage=1`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }
          );
          const statsBody = statsR.ok ? await statsR.json() : {};
          if (!statsR.ok) console.error(`[beszel] ${sys.name} stats HTTP ${statsR.status}`);
          else console.log(`[beszel] ${sys.name} stats keys:`, JSON.stringify(Object.keys(statsBody.items?.[0]?.stats || {})), 'sample:', JSON.stringify(statsBody.items?.[0]?.stats)?.slice(0, 150));
          const s = statsBody.items?.[0]?.stats || {};
          // s.t is a map[string]float64 — prefer any key with "cpu" in it, else average all
          let temp = null;
          if (s.t && typeof s.t === 'object') {
            const entries = Object.entries(s.t).filter(([, v]) => typeof v === 'number' && v > 0);
            const cpu = entries.find(([k]) => k.toLowerCase().includes('cpu'));
            const vals = cpu ? [cpu[1]] : entries.map(([, v]) => v);
            if (vals.length) temp = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
          }
          return {
            name: sys.name,
            status: sys.status || 'unknown',
            cpu: s.cpu != null ? Math.round(s.cpu * 10) / 10 : null,
            memPct: s.mp != null ? Math.round(s.mp) : null,
            diskPct: s.dp != null ? Math.round(s.dp) : null,
            temp,
          };
        } catch {
          return { name: sys.name, status: 'unknown' };
        }
      }));
      return servers;
    }).then(d => { if (d?.length) result.beszel = d; }));

  const plexUrl = gs('plex_url');
  const plexToken = gs('plex_token');
  const _plexThumb = p => p ? `/api/plex/thumb?path=${encodeURIComponent(p)}` : null;
  if (plexUrl && plexToken)
    p.push(_wFetch('plex', 30000, async () => {
      const base = plexUrl.replace(/\/$/, '');
      const headers = { 'X-Plex-Token': plexToken, Accept: 'application/json' };
      const sessR = await fetch(`${base}/status/sessions`, { headers, signal: AbortSignal.timeout(8000) });
      if (!sessR.ok) return null;
      const sessData = await sessR.json();
      const sessions = sessData.MediaContainer?.Metadata || [];
      if (sessions.length) {
        return {
          type: 'playing',
          items: sessions.map(s => ({
            title: s.grandparentTitle ? `${s.grandparentTitle} — ${s.title}` : s.title,
            user: s.User?.title || '',
            thumb: _plexThumb(s.grandparentThumb || s.parentThumb || s.thumb),
            pct: s.viewOffset && s.duration ? Math.round((s.viewOffset / s.duration) * 100) : null,
            state: s.Player?.state || 'playing',
          })),
        };
      }
      // Nothing playing — show recently added
      const recentR = await fetch(`${base}/library/recentlyAdded?X-Plex-Token=${plexToken}&X-Plex-Container-Start=0&X-Plex-Container-Size=6`, { headers, signal: AbortSignal.timeout(8000) });
      if (!recentR.ok) return null;
      const recentData = await recentR.json();
      const recent = recentData.MediaContainer?.Metadata || [];
      if (!recent.length) return null;
      return {
        type: 'recent',
        items: recent.map(r => ({
          title: r.grandparentTitle ? `${r.grandparentTitle} — ${r.title}` : r.title,
          year: r.year || '',
          thumb: _plexThumb(r.grandparentThumb || r.parentThumb || r.thumb),
        })),
      };
    }).then(d => { if (d) result.plex = d; }));

  // ── Moen Flo ───────────────────────────────────────────────────────────────
  // Shared HA fetch helper (reused for UniFi too)
  const haBaseUrl = (gs('ha_url') || '').replace(/\/$/, '');
  const haAuthToken = gs('ha_token');
  const haGet = async (entityId) => {
    if (!entityId || !haBaseUrl || !haAuthToken) return null;
    const r = await fetch(`${haBaseUrl}/api/states/${entityId}`, {
      headers: { 'Authorization': `Bearer ${haAuthToken}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`HA ${r.status} for ${entityId}`);
    const d = await r.json();
    return d;
  };
  const haNum = (s) => { const n = parseFloat(s?.state); return isNaN(n) ? 0 : n; };

  // ── Homey fetch helper ──────────────────────────────────────────────────────
  const homeyBaseUrl = (gs('homey_url') || '').replace(/\/$/, '');
  const homeyAuthToken = gs('homey_token');
  // ADV-001/005 fix: use 'result' in check so {result:null} correctly returns null
  const homeyUnwrap = (body) => (body && typeof body === 'object' && 'result' in body) ? body.result : body;

  const homeyGetDevice = async (deviceId) => {
    if (!deviceId || !homeyBaseUrl || !homeyAuthToken) return null;
    const r = await fetch(`${homeyBaseUrl}/api/manager/devices/device/${deviceId}/`, {
      headers: { 'Authorization': `Bearer ${homeyAuthToken}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error(`Homey ${r.status} for device ${deviceId}`);
    return homeyUnwrap(await r.json());
  };

  const homeyGetUser = async (userId) => {
    if (!userId || !homeyBaseUrl || !homeyAuthToken) return null;
    const r = await fetch(`${homeyBaseUrl}/api/manager/users/user/${userId}/`, {
      headers: { 'Authorization': `Bearer ${homeyAuthToken}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error(`Homey ${r.status} for user ${userId}`);
    return homeyUnwrap(await r.json());
  };

  const haFlowEntity = gs('ha_moen_flow');
  const moenUser = gs('moen_user');
  const moenPass = gs('moen_pass');
  const useMoenHa = !!(haBaseUrl && haAuthToken && haFlowEntity);
  if (useMoenHa || (moenUser && moenPass))
    p.push(_wFetch(useMoenHa ? 'moen:ha' : 'moen:direct', 300000, async () => {
      if (useMoenHa) {
        const [flow, psi, daily, mode, alert] = await Promise.all([
          haGet(haFlowEntity),
          haGet(gs('ha_moen_pressure')),
          haGet(gs('ha_moen_daily')),
          haGet(gs('ha_moen_mode')),
          haGet(gs('ha_moen_alert')),
        ]);
        if (!flow) throw new Error('HA Moen: flow entity returned null — check entity ID and HA connection');
        if (flow.state === 'unavailable') throw new Error(`HA Moen: entity ${haFlowEntity} is unavailable — is the Flo device online?`);
        return {
          flow_gpm:    +haNum(flow).toFixed(2),
          psi:         Math.round(haNum(psi)),
          daily_gal:   Math.round(haNum(daily)),
          system_mode: mode?.state || 'home',
          has_alert:   alert?.state === 'on',
          connected:   true,
          source:      'ha',
        };
      }
      // Direct Moen API fallback
      // Try new OAuth2 endpoint first (Moen migrated to api-gw in late 2024)
      let authHeader = null, apiBase = null, userId = null;
      const oauthR = await fetch('https://api-gw.meetflo.com/api/v1/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'password', username: moenUser, password: moenPass,
          client_id: '3baec26f-0e8b-4e1d-84b0-e178f05ea0a5',
          client_secret: '3baec26f-0e8b-4e1d-84b0-e178f05ea0a5',
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (oauthR.ok) {
        const d = await oauthR.json();
        if (!d.access_token) throw new Error(`Moen OAuth2 ok but no access_token in response`);
        authHeader = `Bearer ${d.access_token}`;
        userId = d.user_id;
        apiBase = 'https://api-gw.meetflo.com';
      } else {
        const oauthBody = await oauthR.text().catch(() => '');
        // Legacy endpoint — bare token, no Bearer prefix
        const legR = await fetch('https://api.meetflo.com/api/v1/users/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: moenUser, password: moenPass }),
          signal: AbortSignal.timeout(8000),
        });
        if (!legR.ok) {
          const legBody = await legR.text().catch(() => '');
          throw new Error(`Moen auth failed — OAuth2 ${oauthR.status}: ${oauthBody.slice(0,120)} | legacy ${legR.status}: ${legBody.slice(0,120)}`);
        }
        const d = await legR.json();
        if (!d.token) throw new Error(`Moen legacy auth ok but no token field in response`);
        authHeader = d.token;
        apiBase = 'https://api.meetflo.com';
      }

      let device = null;
      if (userId) {
        // New API: user → locations → location → devices
        const userR = await fetch(`${apiBase}/api/v2/users/${userId}?expand=locations`, {
          headers: { Authorization: authHeader }, signal: AbortSignal.timeout(8000),
        });
        if (!userR.ok) throw new Error(`Moen users endpoint ${userR.status}`);
        const userData = await userR.json();
        const loc = userData.locations?.[0];
        if (!loc) throw new Error(`Moen: no locations on user ${userId}`);
        const locR = await fetch(`${apiBase}/api/v2/locations/${loc.id}?expand=devices`, {
          headers: { Authorization: authHeader }, signal: AbortSignal.timeout(8000),
        });
        if (!locR.ok) throw new Error(`Moen location endpoint ${locR.status}`);
        device = (await locR.json()).devices?.[0];
      } else {
        // Legacy API: locations returns a direct array
        const locR = await fetch(`${apiBase}/api/v2/locations?expand=devices`, {
          headers: { Authorization: authHeader }, signal: AbortSignal.timeout(8000),
        });
        if (!locR.ok) throw new Error(`Moen legacy locations ${locR.status}`);
        const locs = await locR.json();
        const arr = Array.isArray(locs) ? locs : (locs?.items || []);
        device = arr[0]?.devices?.[0];
        if (!device) throw new Error(`Moen legacy: no device found. Response keys: ${Object.keys(locs||{}).join(',')}`);
      }
      if (!device) throw new Error('Moen: device is null after location fetch');
      return {
        system_mode: device.systemMode?.target || device.systemMode?.lastKnown || 'home',
        has_alert:   (device.notifications?.criticalCount || 0) > 0,
        flow_gpm:    +(device.telemetry?.current?.gpm ?? 0).toFixed(2),
        daily_gal:   Math.round(device.todayGallonsUsed ?? 0),
        psi:         Math.round(device.telemetry?.current?.psi ?? 0),
        connected:   !!device.isConnected,
        source:      'direct',
      };
    }).then(d => { if (d) result.moen = d; }));

  // ── UniFi Network ──────────────────────────────────────────────────────────
  const haClientsEntity = gs('ha_unifi_clients');
  const haRxEntity = gs('ha_unifi_rx');
  const haTxEntity = gs('ha_unifi_tx');
  const haApCountEntity = gs('ha_unifi_ap_count');
  const unifiUrl = gs('unifi_url');
  const unifiUser = gs('unifi_user');
  const unifiPass = gs('unifi_pass');
  const unifiSite = gs('unifi_site') || 'default';
  const unifiIntervalMs = Math.max(30, parseInt(gs('unifi_pull_interval') || '60')) * 1000;
  const useUnifiHa = !!(haBaseUrl && haAuthToken && (haClientsEntity || haRxEntity || haTxEntity));
  if (useUnifiHa || (unifiUrl && unifiUser && unifiPass))
    p.push(_wFetch(`unifi:${useUnifiHa ? 'ha' : unifiUrl}`, unifiIntervalMs, async () => {
      if (useUnifiHa) {
        const [clients, rx, tx, apCount] = await Promise.all([
          haGet(haClientsEntity),
          haGet(haRxEntity),
          haGet(haTxEntity),
          haApCountEntity ? haGet(haApCountEntity) : Promise.resolve(null),
        ]);
        const anchor = clients || rx || tx;
        if (!anchor) throw new Error('HA UniFi: no entities returned — check entity IDs and HA connection');
        if (anchor.state === 'unavailable') throw new Error('HA UniFi: entity is unavailable — is the UniFi controller reachable from HA?');
        return {
          clients:  clients ? Math.round(haNum(clients)) : 0,
          rx_mbps:  +haNum(rx).toFixed(1),
          tx_mbps:  +haNum(tx).toFixed(1),
          ap_count: apCount ? Math.round(haNum(apCount)) : 0,
          status:   anchor.state !== 'unavailable' ? 'up' : 'unknown',
          source:   'ha',
        };
      }
      // Direct UniFi API fallback
      // Use https.request so we can skip self-signed cert validation (common for local controllers)
      const https = require('https');
      const http  = require('http');
      function uReq(url, opts = {}) {
        return new Promise((resolve, reject) => {
          const u = new URL(url);
          const mod = u.protocol === 'https:' ? https : http;
          const body = opts.body || null;
          const req = mod.request({
            hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search, method: opts.method || 'GET',
            headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
            rejectUnauthorized: false,
          }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, headers: res.headers, json: () => JSON.parse(d) }));
          });
          req.on('error', reject);
          if (body) req.write(body);
          req.end();
        });
      }
      // Normalize URL — add https:// if no protocol given
      let rawUrl = unifiUrl.replace(/\/$/, '');
      if (!/^https?:\/\//i.test(rawUrl)) rawUrl = `https://${rawUrl}`;
      const base = rawUrl;
      const loginBody = JSON.stringify({ username: unifiUser, password: unifiPass, remember: false });

      // Helper: extract CSRF token from response headers (3.2+ uses x-updated-csrf-token)
      const pickCsrf = h => h['x-updated-csrf-token'] || h['x-csrf-token'] || null;
      // Helper: parse stats from /stat/health data array
      const parseHealth = (d) => {
        const wan  = (d?.data || []).find(s => s.subsystem === 'wan')  || {};
        const wlan = (d?.data || []).find(s => s.subsystem === 'wlan') || {};
        return {
          clients:  wlan.num_user || 0,
          // API field names use hyphens: rx_bytes-r, tx_bytes-r
          rx_mbps:  +(Math.round((wan['rx_bytes-r'] || 0) / 125000 * 10) / 10).toFixed(1),
          tx_mbps:  +(Math.round((wan['tx_bytes-r'] || 0) / 125000 * 10) / 10).toFixed(1),
          ap_count: wlan.num_ap || 0,
          status:   (wan.status === 'ok' || wan.status === 'connected') ? 'up' : (wan.status || 'unknown'),
          source:   'direct',
        };
      };

      // Try UniFi OS path first (UDM/UDM-Pro/Cloud Key Gen2+)
      // Bootstrap CSRF via GET before login — required on firmware 3.2+ (HA aiounifi pattern)
      let csrfToken = null; let cookieStr = '';
      const bootstrap = await uReq(`${base}/`, { method: 'GET' }).catch(() => null);
      if (bootstrap) csrfToken = pickCsrf(bootstrap.headers);

      const loginHeaders = { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) };
      const osAuth = await uReq(`${base}/api/auth/login`, { method: 'POST', body: loginBody, headers: loginHeaders }).catch(() => null);
      if (osAuth?.ok) {
        const setCookies = Array.isArray(osAuth.headers['set-cookie']) ? osAuth.headers['set-cookie'] : (osAuth.headers['set-cookie'] ? [osAuth.headers['set-cookie']] : []);
        cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');
        csrfToken = pickCsrf(osAuth.headers) || csrfToken;
        const healthR = await uReq(`${base}/proxy/network/api/s/${unifiSite}/stat/health`, {
          headers: { Cookie: cookieStr, ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
        }).catch(e => { throw new Error(`UniFi OS health check network error: ${e.message}`); });
        if (healthR?.ok) return parseHealth(healthR.json());
        throw new Error(`UniFi OS login ok but health check failed ${healthR?.status} — site "${unifiSite}"`);
      }
      // Classic controller fallback (port 8443 by default)
      const authR = await uReq(`${base}/api/login`, { method: 'POST', body: loginBody }).catch(e => { throw new Error(`UniFi classic login network error: ${e.message}`); });
      if (!authR?.ok) throw new Error(`UniFi login failed — OS path: ${osAuth?.status ?? 'network err'}, classic: ${authR?.status ?? 'network err'}`);
      const rawCookies = Array.isArray(authR.headers['set-cookie']) ? authR.headers['set-cookie'] : [authR.headers['set-cookie'] || ''];
      cookieStr = rawCookies.map(c => c.split(';')[0]).join('; ');
      const healthR = await uReq(`${base}/api/s/${unifiSite}/stat/health`, { headers: { Cookie: cookieStr } }).catch(e => { throw new Error(`UniFi health check network error: ${e.message}`); });
      if (!healthR?.ok) throw new Error(`UniFi health endpoint ${healthR?.status} for site "${unifiSite}"`);
      return parseHealth(healthR.json());
    }).then(d => { if (d) result.unifi = d; }));

  // ── Who's Home ────────────────────────────────────────────────────────────
  const personEntitiesStr    = gs('ha_person_entities');
  const homeyPersonDevicesStr = gs('homey_person_devices');
  const presenceSource       = gs('presence_source') || 'both'; // 'ha' | 'homey' | 'both'
  const useHaPersons    = presenceSource !== 'homey' && !!(haBaseUrl && haAuthToken && personEntitiesStr);
  const useHomeyPersons = presenceSource !== 'ha'    && !!(homeyBaseUrl && homeyAuthToken && homeyPersonDevicesStr);
  if (useHaPersons || useHomeyPersons)
    p.push(_wFetch('who_home', 60000, async () => {
      const persons = [];
      if (useHaPersons) {
        const ids = personEntitiesStr.split(',').map(s => s.trim()).filter(Boolean);
        const results = await Promise.all(ids.map(id => haGet(id).catch(() => null)));
        results.forEach((s, i) => {
          if (!s) return;
          persons.push({
            entity_id: ids[i],
            name:  s.attributes?.friendly_name || ids[i].replace('person.', '').replace(/_/g, ' '),
            state: s.state || 'unknown',
            source: 'ha',
          });
        });
      }
      if (useHomeyPersons) {
        const ids = homeyPersonDevicesStr.split(',').map(s => s.trim()).filter(Boolean);
        const users = await Promise.all(ids.map(id => homeyGetUser(id).catch(() => null)));
        users.forEach((u, i) => {
          if (!u) return;
          persons.push({
            entity_id: ids[i],
            name:  u.name || ids[i],
            state: u.present === true ? 'home' : u.present === false ? 'not_home' : 'unknown',
            source: 'homey',
          });
        });
      }
      // Deduplicate: entity_id first, then first+last name (ignores middle name/initial differences)
      const seenId = new Set();
      const seenName = new Set();
      const unique = [];
      for (const p of persons) {
        if (seenId.has(p.entity_id)) continue;
        const parts = (p.name || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
        const nameKey = parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0] || '';
        if (nameKey && seenName.has(nameKey)) continue;
        seenId.add(p.entity_id);
        if (nameKey) seenName.add(nameKey);
        unique.push(p);
      }
      if (!unique.length) return null;
      return { persons: unique };
    }).then(d => { if (d) result.who_home = d; }));

  // ── Thermostat (HA climate or Homey thermostat) ────────────────────────────
  const climateEntity = gs('ha_climate_entity');
  const homeyClimateDevice = gs('homey_climate_device');
  const useHaClimate    = !!(haBaseUrl && haAuthToken && climateEntity);
  const useHomeyClimate = !!(homeyBaseUrl && homeyAuthToken && homeyClimateDevice);
  if (useHaClimate || useHomeyClimate)
    p.push(_wFetch('thermostat', 60000, async () => {
      if (useHaClimate) {
        // F1 fix: catch HA failure and fall through to Homey if available
        try {
          const s = await haGet(climateEntity);
          if (!s) throw new Error(`HA thermostat: entity ${climateEntity} returned null — check entity ID`);
          return {
            name:         s.attributes?.friendly_name || climateEntity.replace('climate.', ''),
            current_temp: s.attributes?.current_temperature ?? null,
            target_temp:  s.attributes?.temperature ?? null,
            mode:         s.state || 'off',
            action:       s.attributes?.hvac_action || '',
            humidity:     s.attributes?.current_humidity ?? s.attributes?.humidity ?? null,
            unit:         gs('temperature_unit') || 'F',
            unavailable:  s.state === 'unavailable',
            source:       'ha',
          };
        } catch(e) {
          if (!useHomeyClimate) throw e; // no fallback — propagate so _wFetch logs the error
          console.warn(`[thermostat] HA failed, trying Homey: ${e.message}`);
          // fall through to Homey below
        }
      }
      // Homey path — reached when HA not configured or HA failed with Homey as backup
      const d = await homeyGetDevice(homeyClimateDevice);
      if (!d) throw new Error(`Homey thermostat: device ${homeyClimateDevice} returned null — check device ID`);
      return {
        name:         d.name || homeyClimateDevice,
        current_temp: d.capabilitiesObj?.measure_temperature?.value ?? null,
        target_temp:  d.capabilitiesObj?.target_temperature?.value ?? null,
        mode:         d.capabilitiesObj?.thermostat_mode?.value || 'auto',
        action:       '',
        humidity:     d.capabilitiesObj?.measure_humidity?.value ?? null,
        unit:         gs('temperature_unit') || 'F',
        unavailable:  false,
        source:       'homey',
      };
    }).then(d => { if (d) result.thermostat = d; }));

  // ── Sensor tiles — HA entities + Homey devices merged ────────────────────
  const sensorEntitiesStr  = gs('ha_sensor_entities');
  const homeyDevicesStr    = gs('homey_sensor_devices');
  const useHaSensors    = !!(haBaseUrl && haAuthToken && sensorEntitiesStr);
  const useHomeySensors = !!(homeyBaseUrl && homeyAuthToken && homeyDevicesStr);
  // Priority order for picking which Homey capability to surface
  const HOMEY_CAP_PRIORITY = ['alarm_motion','alarm_contact','alarm_smoke','alarm_co','alarm_water','locked','onoff','measure_temperature','measure_humidity','measure_power','measure_battery'];
  if (useHaSensors || useHomeySensors) {
    p.push(_wFetch('ha_sensors', 30000, async () => {
      const sensors = [];
      if (useHaSensors) {
        const ids = sensorEntitiesStr.split(',').map(s => s.trim()).filter(Boolean);
        const results = await Promise.all(ids.map(id => haGet(id).catch(() => null)));
        results.forEach((s, i) => {
          if (!s) return;
          sensors.push({
            entity_id: ids[i],
            domain: ids[i].split('.')[0],
            name: s.attributes?.friendly_name || ids[i].replace(/^[^.]+\./, '').replace(/_/g, ' '),
            state: s.state,
            unit: s.attributes?.unit_of_measurement || '',
            device_class: s.attributes?.device_class || '',
            source: 'ha',
          });
        });
      }
      if (useHomeySensors) {
        const ids = homeyDevicesStr.split(',').map(s => s.trim()).filter(Boolean);
        const devices = await Promise.all(ids.map(id => homeyGetDevice(id).catch(() => null)));
        devices.forEach((d, i) => {
          if (!d) return;
          const capObj = d.capabilitiesObj || {};
          // Pick most relevant capability
          let capKey = HOMEY_CAP_PRIORITY.find(k => capObj[k]?.value != null);
          if (!capKey) capKey = Object.keys(capObj).find(k => capObj[k]?.value != null);
          const capData = capKey ? capObj[capKey] : null;
          const rawVal  = capData?.value;
          // locked capability: true=locked (safe), false=unlocked (alert) — preserve as strings so stateColor works correctly
          const state   = capKey === 'locked'
            ? (rawVal === true ? 'locked' : rawVal === false ? 'unlocked' : 'unknown')
            : (rawVal === true ? 'on' : rawVal === false ? 'off' : rawVal != null ? String(rawVal) : 'unknown');
          const unit    = capData?.units || '';
          sensors.push({
            entity_id: ids[i],
            domain: 'homey',
            name: d.name || ids[i],
            state,
            unit,
            device_class: capKey || '',
            source: 'homey',
          });
        });
      }
      if (!sensors.length) return null;
      return { sensors };
    }).then(d => { if (d) result.ha_sensors = d; }));
  }

  // Evict stale dated cache keys (wotd: daily, compliment: hourly) to prevent unbounded memory growth
  const _today = new Date().toISOString().slice(0, 10);
  const _hour  = new Date().toISOString().slice(0, 13);
  for (const k of Object.keys(_wCache)) {
    if ((k.startsWith('wotd:') && k !== `wotd:${_today}`) ||
        (k.startsWith('compliment:') && k !== `compliment:${_hour}`) ||
        (k.startsWith('quote:') && k !== `quote:${_today}`)) {
      delete _wCache[k]; delete _wErrors[k];
    }
  }

  // Word of the day — word list for selection, definition from Free Dictionary API, stale cache as fallback
  p.push(_wFetch(`wotd:${_today}`, 86400000, async () => {
    const words = [
      'serendipity','ephemeral','petrichor','mellifluous','equanimity','laconic','sanguine',
      'ebullient','taciturn','perspicacious','ineffable','magnanimous','pernicious','recalcitrant',
      'propitious','truculent','sagacious','bellicose','vicarious','nonchalant','garrulous',
      'acerbic','fastidious','intrepid','languid','mercurial','nebulous','opulent','quixotic',
      'stoic','ubiquitous','wistful','altruistic','circumspect','erudite','fervent','gregarious',
      'haughty','indolent','judicious','luminous','nascent','pensive','reticent','tenuous',
      'vivacious','whimsical','alacrity','brevity','cogent','diffident','elusive','fortuitous',
      'halcyon','impetuous','jocular','laudable','meticulous','nuanced','oblivious','palpable',
      'quintessential','scrupulous','umbrage','winsome','zephyr','obfuscate','perfidious',
      'loquacious','insouciant','sycophant','verisimilitude','vociferous','tenacious','obstinate',
      'mendacious','lethargic','deferential','rapturous','serene','timorous','unequivocal',
      'exuberant','felicitous','grandiloquent','inscrutable','imperious','kinetic','ostentatious',
      'prudent','querulous','reverent','benevolent','diligent','munificent','resilient','vigilant',
      'zealous','candid','transient','heuristic','melancholy','audacious','diaphanous','cogitate',
    ];
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(),0,0)) / 86400000);
    const word = words[dayOfYear % words.length];
    const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    const entry = d[0];
    const meaning = entry?.meanings?.[0];
    const def = meaning?.definitions?.[0];
    if (!entry?.word || !def?.definition) return null;
    const phonetics = entry.phonetics || [];
    const phonetic = entry.phonetic || phonetics.find(p => p.text)?.text || '';
    const audio = phonetics.find(p => p.audio)?.audio || '';
    return { word: entry.word, partOfSpeech: meaning.partOfSpeech || '', definition: def.definition, example: def.example || '', phonetic, audio };
  }).then(d => { if (d) result.wotd = d; }));

  // Sunrise / sunset + moon phase — sunrisesunset.io (free, no key)
  {
    const lat = gs('weather_lat'); const lon = gs('weather_lon');
    if (lat && lon) {
      p.push(_wFetch(`sun:${lat}:${lon}`, 1800000, async () => {
        const r = await fetch(`https://api.sunrisesunset.io/json?lat=${lat}&lng=${lon}&date=today`, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) return null;
        const d = await r.json();
        if (d.status !== 'OK') return null;
        const x = d.results;
        return { sunrise: x.sunrise, sunset: x.sunset, golden_hour: x.golden_hour, moon_phase: x.moon_phase, moon_illumination: x.moon_illumination };
      }).then(d => { if (d) result.sun = d; }));
    }
  }

  // Daily compliment — affirmations.dev (free, no key)
  p.push(_wFetch(`compliment:${_hour}`, 21600000, async () => {
    const r = await fetch('https://www.affirmations.dev/', { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d.affirmation ? { text: d.affirmation } : null;
  }).then(d => { if (d) result.compliment = d; }));

  await Promise.allSettled(p);
  res.json(result);
});

// Debug: which widgets are loaded and what errors occurred
app.get('/api/widgets/debug', requireAdmin, (req, res) => {
  res.json({
    cached: Object.fromEntries(Object.entries(_wCache).map(([k,v])=>[k,{age_s: Math.round((Date.now()-v.at)/1000), has_data: v.data!==null}])),
    errors: _wErrors,
    settings: {
      has_moen:         !!(gs('moen_user') && gs('moen_pass')),
      has_unifi:        !!(gs('unifi_url') && gs('unifi_user') && gs('unifi_pass')),
      unifi_url:        gs('unifi_url'),
      ha_url:           gs('ha_url'),
      ha_has_token:     !!gs('ha_token'),
      ha_moen_flow:     gs('ha_moen_flow'),
      ha_moen_pressure: gs('ha_moen_pressure'),
      ha_moen_daily:    gs('ha_moen_daily'),
      ha_moen_mode:     gs('ha_moen_mode'),
      ha_moen_alert:    gs('ha_moen_alert'),
      ha_unifi_clients:    gs('ha_unifi_clients'),
      ha_unifi_rx:         gs('ha_unifi_rx'),
      ha_unifi_tx:         gs('ha_unifi_tx'),
      ha_person_entities:   gs('ha_person_entities'),
      ha_climate_entity:    gs('ha_climate_entity'),
      homey_person_devices: gs('homey_person_devices'),
      homey_climate_device: gs('homey_climate_device'),
      moen_source:         !!(gs('ha_url') && gs('ha_token') && gs('ha_moen_flow')) ? 'ha' : 'direct',
      unifi_source:        !!(gs('ha_url') && gs('ha_token') && (gs('ha_unifi_clients')||gs('ha_unifi_rx')||gs('ha_unifi_tx'))) ? 'ha' : 'direct',
    },
  });
});

// ── Routes: Music (Last.fm now-playing) ──────────────────────────────────────
let _lastfmCache = null; let _lastfmCacheAt = 0;

app.get('/api/plex/thumb', async (req, res) => {
  const plexUrl = gs('plex_url');
  const plexToken = gs('plex_token');
  if (!plexUrl || !plexToken) return res.status(404).end();
  const thumbPath = req.query.path;
  if (!thumbPath || !thumbPath.startsWith('/')) return res.status(400).end();
  // Block absolute/external URLs — path must be a relative Plex path
  if (/^\/\/|https?:\/\//.test(thumbPath)) return res.status(400).end();
  try {
    const base = plexUrl.replace(/\/$/, '');
    const sep = thumbPath.includes('?') ? '&' : '?';
    const r = await fetch(`${base}${thumbPath}${sep}X-Plex-Token=${plexToken}`, {
      headers: { 'X-Plex-Token': plexToken, Accept: 'image/*' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.error(`[plex/thumb] ${r.status} for path: ${thumbPath}`);
      return res.status(r.status).end();
    }
    const buf = await r.arrayBuffer();
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(buf));
  } catch { res.status(502).end(); }
});

app.get('/api/music/now-playing', requireAuth, async (req, res) => {
  try {
    if (_lastfmCache && Date.now() - _lastfmCacheAt < 15000) return res.json(_lastfmCache);
    const key  = gs('lastfm_api_key');
    const user = gs('lastfm_user');
    if (!key || !user) return res.json({ playing: false });
    const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(user)}&api_key=${encodeURIComponent(key)}&format=json&limit=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return res.json({ playing: false });
    const d = await r.json();
    const track = d?.recenttracks?.track?.[0];
    if (!track || track['@attr']?.nowplaying !== 'true') {
      _lastfmCache = { playing: false };
      _lastfmCacheAt = Date.now();
      return res.json(_lastfmCache);
    }
    const thumb = track.image?.find(i => i.size === 'medium')?.['#text'] || '';
    _lastfmCache = {
      playing: true,
      title:   track.name || '',
      artist:  track.artist?.['#text'] || '',
      thumb:   thumb && !thumb.includes('2a96cbd8b46e442fc41c2b86b821562f') ? thumb : '',
    };
    _lastfmCacheAt = Date.now();
    return res.json(_lastfmCache);
  } catch { res.json({ playing: false }); }
});

// ── Routes: Photos (screensaver) ──────────────────────────────────────────────
app.get('/api/photos', (req, res) => {
  res.json(db.prepare('SELECT * FROM photos ORDER BY created_at DESC').all());
});

app.post('/api/photos', requireAuth, (req, res) => {
  const { filename, data } = req.body;
  if (!filename || !data?.startsWith('data:image/')) return res.status(400).json({ error: 'filename and image data required' });
  const ext = (filename.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';
  const safe = `${Date.now()}.${ext}`;
  try {
    fs.writeFileSync(path.join(PHOTOS_DIR, safe), Buffer.from(data.split(',')[1], 'base64'));
    const r = db.prepare('INSERT INTO photos (filename) VALUES (?)').run(safe);
    res.json({ id: r.lastInsertRowid, filename: safe });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/photos/:id', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM photos WHERE id=?').get(Number(req.params.id));
  if (p) {
    try { fs.unlinkSync(path.join(PHOTOS_DIR, p.filename)); } catch {}
    db.prepare('DELETE FROM photos WHERE id=?').run(Number(req.params.id));
  }
  res.json({ ok: true });
});

// ── Routes: Bookmarks ─────────────────────────────────────────────────────────
app.get('/api/bookmarks', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM bookmarks ORDER BY category, id').all());
});

app.post('/api/bookmarks', requireAuth, (req, res) => {
  const { title, url, category = '', emoji = '🔗' } = req.body;
  if (!title?.trim() || !url?.trim()) return res.status(400).json({ error: 'title and url required' });
  const r = db.prepare('INSERT INTO bookmarks (title, url, category, emoji) VALUES (?,?,?,?)').run(title.trim(), url.trim(), category.trim(), emoji);
  res.status(201).json({ id: r.lastInsertRowid, title: title.trim(), url: url.trim(), category: category.trim(), emoji });
});

app.delete('/api/bookmarks/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM bookmarks WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/beszel/test', requireAdmin, async (req, res) => {
  const url = gs('beszel_url'); const user = gs('beszel_user'); const pass = gs('beszel_pass');
  if (!url) return res.json({ error: 'beszel_url not configured' });
  if (!user || !pass) return res.json({ error: 'beszel credentials not configured' });
  try {
    const base = url.replace(/\/$/, '');
    const authR = await fetch(`${base}/api/collections/users/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: user, password: pass }), signal: AbortSignal.timeout(8000),
    });
    const authBody = await authR.json();
    if (!authR.ok) return res.json({ error: 'auth failed', detail: authBody });
    const { token } = authBody;
    const sysR = await fetch(`${base}/api/collections/systems/records?perPage=10`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
    });
    const sysBody = await sysR.json();
    if (!sysR.ok) return res.json({ error: 'systems fetch failed', detail: sysBody });
    const firstSys = sysBody.items?.[0];
    let statsBody = null;
    if (firstSys) {
      const statsR = await fetch(
        `${base}/api/collections/system_stats/records?filter=${encodeURIComponent(`system='${firstSys.id}'`)}&sort=-created&perPage=1`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }
      );
      statsBody = await statsR.json();
    }
    res.json({ systems: sysBody, firstStats: statsBody });
  } catch (e) { res.json({ error: e.message }); }
});

app.get('/api/nextdns/test', requireAdmin, async (req, res) => {
  const key = gs('nextdns_api_key'); const profile = gs('nextdns_profile_id');
  if (!key) return res.json({ error: 'nextdns_api_key not configured' });
  if (!profile) return res.json({ error: 'nextdns_profile_id not configured' });
  try {
    const r = await fetch(`https://api.nextdns.io/profiles/${profile}/analytics/status?from=-24h`, {
      headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(10000),
    });
    res.json({ status: r.status, ok: r.ok, body: await r.json() });
  } catch (e) { res.json({ error: e.message }); }
});

// ── Routes: Email inbound (Cloudflare Email Worker webhook) ───────────────────

async function callAiForEvent(subject, body) {
  const getSetting = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  const provider = getSetting('ai_provider') || 'anthropic';
  const apiKey = getSetting('ai_api_key') || getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return null;

  const prompt = `Extract calendar event details from this email. Return JSON only, no other text.\n\nSubject: ${subject}\nBody: ${body.slice(0, 2000)}\n\nReturn: {"event_name":"...","event_date":"YYYY-MM-DD or description","event_time":"H:MM AM/PM or All day","recurrence":"One-time|Weekly|Monthly|etc","confidence":"high|medium|low"}\nIf no event is found return {"event_name":"","confidence":"low"}`;

  try {
    let text;
    if (provider === 'gemini') {
      const data = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
      }).then(r => r.json());
      text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    } else if (provider === 'openai' || provider === 'groq' || provider === 'deepseek') {
      const baseUrl = provider === 'groq' ? 'https://api.groq.com/openai/v1' : provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1';
      const model = provider === 'groq' ? 'llama-3.1-8b-instant' : provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';
      const data = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
      }).then(r => r.json());
      text = data.choices?.[0]?.message?.content;
    } else {
      const data = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
      }).then(r => r.json());
      text = data.content?.[0]?.text;
    }
    return text ? JSON.parse(text) : null;
  } catch { return null; }
}

async function callAiWithMedia(imageBase64, mimeType) {
  const getSetting = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  const provider = getSetting('ai_provider') || 'anthropic';
  const apiKey = getSetting('ai_api_key') || getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return [];
  const prompt = 'Extract all calendar events from this image or document. Return JSON only, no other text.\nReturn: {"events":[{"event_name":"...","event_date":"YYYY-MM-DD or natural language","event_time":"H:MM AM/PM or All day","recurrence":"One-time|Weekly|Monthly|etc","confidence":"high|medium|low"}]}\nReturn {"events":[]} if no events found.';
  try {
    let text;
    if (provider === 'gemini') {
      const data = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
      }).then(r => r.json());
      text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    } else {
      const data = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } }, { type: 'text', text: prompt }] }] }),
      }).then(r => r.json());
      text = data.content?.[0]?.text;
    }
    const parsed = text ? JSON.parse(text) : null;
    return Array.isArray(parsed?.events) ? parsed.events : [];
  } catch { return []; }
}

async function callAiForPackage(subject, body) {
  const getSetting = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  const provider = getSetting('ai_provider') || 'anthropic';
  const apiKey = getSetting('ai_api_key') || getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return null;

  const prompt = `Extract shipping/package information from this email. Return JSON only, no other text.\n\nSubject: ${subject}\nBody: ${body.slice(0, 2000)}\n\nReturn: {"is_shipping":true,"carrier":"UPS|FedEx|USPS|Amazon|DHL|OnTrac|LaserShip|etc","tracking_number":"...","description":"brief item description","expected_date":"YYYY-MM-DD or empty"}\nIf no shipping or package delivery info is present return {"is_shipping":false}`;

  try {
    let text;
    if (provider === 'gemini') {
      const data = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
      }).then(r => r.json());
      text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    } else if (provider === 'openai' || provider === 'groq' || provider === 'deepseek') {
      const baseUrl = provider === 'groq' ? 'https://api.groq.com/openai/v1' : provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1';
      const model = provider === 'groq' ? 'llama-3.1-8b-instant' : provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';
      const data = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
      }).then(r => r.json());
      text = data.choices?.[0]?.message?.content;
    } else {
      const data = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
      }).then(r => r.json());
      text = data.content?.[0]?.text;
    }
    return text ? JSON.parse(text) : null;
  } catch { return null; }
}

app.post('/api/email/inbound', async (req, res) => {
  const secret = db.prepare('SELECT value FROM settings WHERE key=?').get('email_webhook_secret')?.value;
  if (secret && req.headers['x-kith-secret'] !== secret) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  const { subject, from, body, ics } = req.body || {};
  let event_name = '', event_date = '', event_time = '', recurrence = 'One-time', confidence = 'low';

  if (ics) {
    const events = parseICS(ics);
    if (events.length > 0) {
      const ev = events[0];
      event_name = ev.title;
      event_date = ev.date;
      event_time = ev.time;
      recurrence = ev.recurrence || 'One-time';
      confidence = 'high';
    }
  }

  if (!event_name) {
    const result = await callAiForEvent(subject || '', body || '').catch(() => null);
    if (result?.event_name) {
      event_name = result.event_name;
      event_date = result.event_date || '';
      event_time = result.event_time || 'All day';
      recurrence = result.recurrence || 'One-time';
      confidence = result.confidence || 'medium';
    }
  }

  if (!event_name) event_name = subject || '(Unknown event)';

  // run both AI calls in parallel, then do DB writes synchronously
  const pkg = await callAiForPackage(subject || '', body || '').catch(() => null);

  db.prepare('INSERT INTO inbox (subject,event_name,event_date,event_time,recurrence,confidence) VALUES (?,?,?,?,?,?)')
    .run(subject || '', event_name, event_date, event_time, recurrence, confidence);

  if (pkg?.is_shipping) {
    db.prepare('INSERT INTO packages (carrier,tracking_number,description,expected_date,source_subject) VALUES (?,?,?,?,?)')
      .run(pkg.carrier || '', pkg.tracking_number || '', pkg.description || '', pkg.expected_date || '', subject || '');
    broadcastSSE('packages', { action: 'reload' });
  }

  res.json({ ok: true });
});

// ── Routes: Packages ─────────────────────────────────────────────────────────

app.get('/api/packages', (req, res) => {
  const rows = db.prepare("SELECT * FROM packages WHERE delivered=0 ORDER BY created_at DESC").all();
  res.json(rows);
});

app.post('/api/packages', (req, res) => {
  const { carrier='', tracking_number='', description='', expected_date='' } = req.body || {};
  if (!description && !tracking_number) return res.json({ error: 'description or tracking_number required' });
  const row = db.prepare('INSERT INTO packages (carrier,tracking_number,description,expected_date,source_subject) VALUES (?,?,?,?,?) RETURNING *')
    .get(carrier, tracking_number, description, expected_date, '');
  broadcastSSE({ type: 'refresh', key: 'packages' });
  res.json(row);
});

app.put('/api/packages/:id/delivered', (req, res) => {
  const row = db.prepare('UPDATE packages SET delivered=1, status=? WHERE id=? RETURNING *')
    .get('delivered', Number(req.params.id));
  if (!row) return res.json({ error: 'Not found' });
  broadcastSSE({ type: 'refresh', key: 'packages' });
  res.json(row);
});

app.delete('/api/packages/:id', (req, res) => {
  const info = db.prepare('DELETE FROM packages WHERE id=?').run(Number(req.params.id));
  if (!info.changes) return res.json({ error: 'Not found' });
  broadcastSSE({ type: 'refresh', key: 'packages' });
  res.json({ ok: true });
});

// ── Routes: Messages ──────────────────────────────────────────────────────────

app.get('/api/messages', (req, res) => {
  const rows = db.prepare("SELECT * FROM messages WHERE expires_at > datetime('now') ORDER BY created_at DESC").all();
  res.json(rows);
});

app.post('/api/messages', (req, res) => {
  const { text, author='', member_id=null, expiry_preset='4h' } = req.body || {};
  if (!text?.trim()) return res.json({ error: 'text required' });
  let expires_at;
  if (expiry_preset === 'eod') {
    expires_at = db.prepare(`SELECT datetime('now', 'start of day', '+1 day') as t`).get().t;
  } else if (expiry_preset === 'tomorrow') {
    expires_at = db.prepare(`SELECT datetime('now', 'start of day', '+2 days') as t`).get().t;
  } else {
    const offset = expiry_preset === '1h' ? '+1 hour' : '+4 hours';
    expires_at = db.prepare(`SELECT datetime('now', ?) as t`).get(offset).t;
  }
  const row = db.prepare('INSERT INTO messages (text,author,member_id,expires_at) VALUES (?,?,?,?) RETURNING *')
    .get(text.trim(), author, member_id || null, expires_at);
  broadcastSSE('messages', { action: 'reload' });
  res.json(row);
});

app.delete('/api/messages/:id', (req, res) => {
  const info = db.prepare('DELETE FROM messages WHERE id=?').run(Number(req.params.id));
  if (!info.changes) return res.json({ error: 'Not found' });
  broadcastSSE('messages', { action: 'reload' });
  res.json({ ok: true });
});

// ── Email reminders ───────────────────────────────────────────────────────────

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function sendEmail(subject, html, text) {
  const g = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  const apiKey = g('resend_api_key');
  const from   = g('resend_from');
  const to     = g('email_to');
  if (!apiKey) throw new Error('Resend API key not set — add it in Settings → Email Reminders');
  if (!from)   throw new Error('From address not set — add it in Settings → Email Reminders');
  if (!to)     throw new Error('Recipient address not set — add it in Settings → Email Reminders');
  const payload = { from, to, subject, html };
  if (text) payload.text = text;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Resend error ${res.status}`);
  }
}

function getOrCreateUnsubToken() {
  let token = db.prepare("SELECT value FROM settings WHERE key='email_unsubscribe_token'").get()?.value;
  if (!token) {
    token = require('crypto').randomBytes(20).toString('hex');
    db.prepare("INSERT INTO settings (key,value) VALUES ('email_unsubscribe_token',?)").run(token);
  }
  return token;
}

function emailBase(title, subtitle, body, unsubUrl) {
  const ft = unsubUrl
    ? `Kith — your self-hosted family dashboard &nbsp;·&nbsp; <a href="${unsubUrl}" style="color:#8E8E93;text-decoration:underline">Unsubscribe</a>`
    : `Kith — your self-hosted family dashboard`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f7;margin:0;padding:24px}
    .wrap{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
    .hd{background:#1C1C1E;padding:24px 28px}
    .hd h1{color:#fff;margin:0;font-size:22px;font-weight:700;letter-spacing:-.03em}
    .hd p{color:rgba(255,255,255,.55);margin:4px 0 0;font-size:13px}
    .bd{padding:24px 28px}
    .day{font-size:11px;font-weight:700;color:#8E8E93;text-transform:uppercase;letter-spacing:.06em;margin:20px 0 8px}
    .day:first-child{margin-top:0}
    .ev{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#F2F2F7;border-radius:10px;margin-bottom:6px}
    .ev-dot{width:8px;height:8px;border-radius:50%;background:#007AFF;flex-shrink:0}
    .ev-name{font-size:14px;font-weight:600;color:#1C1C1E}
    .ev-time{font-size:12px;color:#8E8E93;margin-left:auto}
    .chore{padding:8px 14px;border-bottom:1px solid #F2F2F7;font-size:13px;color:#3C3C43;display:flex;gap:8px;align-items:center}
    .chore:last-child{border-bottom:none}
    .chore-pts{font-size:11px;color:#FF9500;margin-left:auto}
    .empty{font-size:14px;color:#8E8E93;font-style:italic;padding:10px 0}
    .ft{padding:16px 28px;background:#F2F2F7;font-size:11px;color:#8E8E93;text-align:center}
  </style></head><body>
  <div class="wrap">
    <div class="hd"><h1>${title}</h1><p>${subtitle}</p></div>
    <div class="bd">${body}</div>
    <div class="ft">${ft}</div>
  </div></body></html>`;
}

app.post('/api/email/test', requireAdmin, async (req, res) => {
  try {
    await sendEmail(
      'Kith — Test Email',
      emailBase('Email is working!', new Date().toDateString(), '<p style="font-size:15px;color:#1C1C1E">Your Kith email reminders are configured correctly.</p>'),
      'Kith — Test Email\n\nYour Kith email reminders are configured correctly.'
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/email/unsubscribe', (req, res) => {
  const stored = db.prepare("SELECT value FROM settings WHERE key='email_unsubscribe_token'").get()?.value;
  if (!stored || req.query.t !== stored) {
    return res.status(400).send('<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>Invalid link</h2><p>This unsubscribe link is not valid.</p></body></html>');
  }
  const upd = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  upd.run('daily_summary_enabled', '0');
  upd.run('weekly_digest_enabled', '0');
  res.send('<html><body style="font-family:-apple-system,sans-serif;padding:48px 24px;text-align:center;background:#f5f5f7"><div style="max-width:400px;margin:0 auto;background:#fff;border-radius:16px;padding:36px;box-shadow:0 2px 12px rgba(0,0,0,.08)"><h2 style="margin:0 0 12px;font-size:22px">Unsubscribed</h2><p style="color:#666;margin:0 0 20px">You will no longer receive email reminders from Kith.</p><p style="color:#999;font-size:13px">You can re-enable them any time in Settings → Email Reminders.</p></div></body></html>');
});

// Daily summary — configurable time, fires every minute and checks
let _dailySummarySentDate = '';
cron.schedule('* * * * *', async () => {
  const g = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  if (g('daily_summary_enabled') !== '1') return;

  const configTime = g('daily_summary_time') || '07:00';
  const now = new Date();
  const nowHHMM = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const today = localDate(now);
  if (nowHHMM !== configTime || _dailySummarySentDate === today) return;
  _dailySummarySentDate = today;

  const events = db.prepare("SELECT * FROM events WHERE date=? ORDER BY time").all(today);
  const chores = db.prepare("SELECT * FROM chores WHERE status IN ('due','overdue') AND done=0").all();
  const meal   = db.prepare("SELECT meal FROM meals WHERE day=?").get(today)?.meal || '';

  if (!events.length && !chores.length && !meal) return;

  const dow = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
  const dateLabel = now.toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });

  let html = '', text = `Kith — ${dow}, ${dateLabel}\n\n`;

  html += `<div class="day">Today's Events</div>`;
  text += `TODAY'S EVENTS\n`;
  if (events.length) {
    html += events.map(e => `<div class="ev"><div class="ev-dot"></div><div class="ev-name">${esc(e.title)}</div><div class="ev-time">${esc(e.time||'')}</div></div>`).join('');
    text += events.map(e => `• ${e.title}${e.time && e.time !== 'All day' ? ' — ' + e.time : ''}`).join('\n') + '\n';
  } else {
    html += `<div class="empty">Nothing scheduled today</div>`;
    text += 'Nothing scheduled today\n';
  }

  if (chores.length) {
    html += `<div class="day">Chores Due</div><div style="background:#F2F2F7;border-radius:10px;overflow:hidden">`;
    html += chores.map(c => `<div class="chore">☐ ${esc(c.name)}<span class="chore-pts">${esc(c.points)}★</span></div>`).join('');
    html += `</div>`;
    text += `\nCHORES DUE\n${chores.map(c => `• ${c.name}`).join('\n')}\n`;
  }

  if (meal) {
    html += `<div class="day">Today's Meal</div><div class="ev"><div class="ev-name">${esc(meal)}</div></div>`;
    text += `\nTODAY'S MEAL\n${meal}\n`;
  }

  const unsubToken = getOrCreateUnsubToken();
  const kithUrl = g('kith_url');
  const unsubUrl = kithUrl ? `${kithUrl.replace(/\/$/, '')}/api/email/unsubscribe?t=${unsubToken}` : null;
  if (unsubUrl) text += `\nUnsubscribe: ${unsubUrl}`;

  try {
    await sendEmail(`Kith — ${dow}, ${dateLabel}`, emailBase(`${dow}, ${dateLabel}`, 'Your daily summary', html, unsubUrl), text);
  } catch (e) {
    console.error('[email] daily summary failed:', e.message);
  }
});

// Weekly digest — Sunday at 6pm (only if there's something to report)
cron.schedule('0 18 * * 0', async () => {
  const g = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  if (g('weekly_digest_enabled') !== '1') return;

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return { iso: localDate(d), label: d.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' }) };
  });

  let html = '', text = 'YOUR WEEK AHEAD\n\n';
  let hasAny = false;
  for (const { iso, label } of days) {
    const evs = db.prepare("SELECT * FROM events WHERE date=? ORDER BY time").all(iso);
    if (!evs.length) continue;
    hasAny = true;
    html += `<div class="day">${label}</div>`;
    html += evs.map(e => `<div class="ev"><div class="ev-dot"></div><div class="ev-name">${esc(e.title)}</div><div class="ev-time">${esc(e.time||'')}</div></div>`).join('');
    text += `${label.toUpperCase()}\n${evs.map(e => `• ${e.title}${e.time && e.time !== 'All day' ? ' — ' + e.time : ''}`).join('\n')}\n\n`;
  }

  const chores = db.prepare("SELECT * FROM chores WHERE done=0").all();
  if (!hasAny && !chores.length) return;

  if (chores.length) {
    html += `<div class="day">Recurring Chores This Week</div><div style="background:#F2F2F7;border-radius:10px;overflow:hidden">`;
    html += chores.slice(0, 8).map(c => `<div class="chore">☐ ${esc(c.name)}<span class="chore-pts">${esc(c.points)}★</span></div>`).join('');
    html += `</div>`;
    text += `CHORES\n${chores.slice(0, 8).map(c => `• ${c.name}`).join('\n')}\n`;
  }

  const unsubToken = getOrCreateUnsubToken();
  const kithUrl = g('kith_url');
  const unsubUrl = kithUrl ? `${kithUrl.replace(/\/$/, '')}/api/email/unsubscribe?t=${unsubToken}` : null;
  if (unsubUrl) text += `\nUnsubscribe: ${unsubUrl}`;

  const range = `${days[0].label} – ${days[6].label}`;
  try {
    await sendEmail(`Kith — Week of ${days[0].label}`, emailBase('Your Week Ahead', range, html, unsubUrl), text);
  } catch (e) {
    console.error('[email] weekly digest failed:', e.message);
  }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

// ── HA WebSocket — real-time entity state changes ────────────────────────────
let _haWs = null, _haWsRetryMs = 2000, _haWsTimer = null;

function _haWsCfg() {
  const g = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  return { url: g('ha_url').replace(/\/$/, ''), token: g('ha_token') };
}
// Cached tracked entity set — refreshed every 60s to avoid DB reads on every HA event
let _haWsTrackedCache = null, _haWsTrackedAt = 0;
function _haWsTracked() {
  if (_haWsTrackedCache && Date.now() - _haWsTrackedAt < 60000) return _haWsTrackedCache;
  const g = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  _haWsTrackedCache = new Set([
    ...g('ha_person_entities').split(','),
    ...g('ha_sensor_entities').split(','),
    g('ha_climate_entity'),
  ].map(s => s.trim()).filter(Boolean));
  _haWsTrackedAt = Date.now();
  return _haWsTrackedCache;
}
function haWsConnect() {
  const { url, token } = _haWsCfg();
  if (!url || !token) return;
  const wsUrl = url.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/api/websocket';
  try { _haWs = new WebSocket(wsUrl, { rejectUnauthorized: false }); }
  catch (e) { console.warn('[ha-ws] connect error:', e.message); return haWsScheduleReconnect(); }
  let msgId = 1;
  _haWs.on('open', () => { console.log('[ha-ws] connected'); _haWsRetryMs = 2000; });
  _haWs.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'auth_required') {
      _haWs.send(JSON.stringify({ type: 'auth', access_token: token }));
    } else if (msg.type === 'auth_ok') {
      _haWs.send(JSON.stringify({ id: msgId++, type: 'subscribe_events', event_type: 'state_changed' }));
      console.log('[ha-ws] authenticated + subscribed to state_changed');
    } else if (msg.type === 'auth_invalid') {
      console.error('[ha-ws] auth invalid — check HA token'); _haWsRetryMs = 60000; _haWs.close();
    } else if (msg.type === 'event') {
      const { entity_id, new_state, old_state } = msg.event?.data || {};
      if (!entity_id || !_haWsTracked().has(entity_id)) return;
      // Skip attribute-only changes (e.g. last_updated, latitude_accuracy) — only care about state value
      if (new_state?.state === old_state?.state) return;
      // Soft-invalidate: force refetch while preserving stale data as fallback if HA is momentarily slow
      // Use configured entity IDs instead of hardcoded prefixes — supports device_tracker.* and other types
      const _g = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
      const _personIds = new Set(_g('ha_person_entities').split(',').map(s => s.trim()).filter(Boolean));
      const _climateId = _g('ha_climate_entity').trim();
      if (_personIds.has(entity_id)) _wInvalidate('who_home');
      else if (entity_id === _climateId || entity_id.startsWith('climate.')) _wInvalidate('thermostat');
      else _wInvalidate('ha_sensors');
      broadcastSSE('refresh', { source: 'ha', entity: entity_id });
    }
  });
  _haWs.on('close', () => { console.log('[ha-ws] disconnected'); haWsScheduleReconnect(); });
  _haWs.on('error', e => console.warn('[ha-ws] error:', e.message));
}
function haWsScheduleReconnect() {
  if (_haWsTimer) return;
  _haWsTimer = setTimeout(() => { _haWsTimer = null; haWsConnect(); }, _haWsRetryMs);
  _haWsRetryMs = Math.min(_haWsRetryMs * 2, 30000);
}
function haWsRestart() {
  if (_haWsTimer) { clearTimeout(_haWsTimer); _haWsTimer = null; }
  if (_haWs) { _haWs.removeAllListeners(); try { _haWs.close(); } catch {} _haWs = null; }
  _haWsRetryMs = 2000;
  _haWsTrackedCache = null; // force entity list refresh on next event
  haWsConnect();
}
setTimeout(haWsConnect, 3000); // wait for DB init

// ── Homey background poller — real-time timeline + presence ───────────────────
let _homeyTlKey = null;   // newest timeline entry key (to detect new ones)
let _homeyPresence = {};  // userId → present boolean

async function homeyPoll() {
  const g = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  const homeyUrl = g('homey_url').replace(/\/$/, '');
  const homeyToken = g('homey_token');
  if (!homeyUrl || !homeyToken) return;
  const hdrs = { Authorization: `Bearer ${homeyToken}` };
  const unwrap = r => (r && typeof r === 'object' && 'result' in r) ? r.result : r;

  // Timeline — detect new flow notification entries
  try {
    const tlRaw = await fetch(`${homeyUrl}/api/manager/timeline/timeline/`, {
      headers: hdrs, signal: AbortSignal.timeout(8000),
    }).then(r => r.json()).catch(() => null);
    const tlData = unwrap(tlRaw);
    if (tlData && typeof tlData === 'object') {
      // Find newest entry by dateCreated (handles both UUIDs and numeric keys)
      const entries = Object.entries(tlData).map(([key, val]) => ({ _key: key, ...val }));
      if (entries.length) {
        entries.sort((a, b) => Number(b.dateCreated || 0) - Number(a.dateCreated || 0));
        const newest = entries[0];
        const newestKey = newest._key;
        if (_homeyTlKey !== null && newestKey !== _homeyTlKey) {
          let created_at = new Date().toISOString();
          if (newest.dateCreated) {
            const num = Number(newest.dateCreated);
            if (!isNaN(num)) created_at = new Date(num < 1e10 ? num * 1000 : num).toISOString();
          }
          broadcastSSE('activity', {
            title: newest.title || newest.excerpt || 'Homey',
            message: newest.excerpt || '',
            icon: '🏡', source: 'homey', created_at,
          });
        }
        _homeyTlKey = newestKey;
      }
    }
  } catch (_) {}

  // Presence — detect changes for mapped Homey users
  const personStr = g('homey_person_devices');
  if (!personStr) return;
  try {
    const uids = personStr.split(',').map(s => s.trim()).filter(Boolean);
    const urRaw = await fetch(`${homeyUrl}/api/manager/users/user/`, {
      headers: hdrs, signal: AbortSignal.timeout(8000),
    }).then(r => r.json()).catch(() => null);
    const usersData = unwrap(urRaw);
    if (!usersData || typeof usersData !== 'object') return;
    const usersMap = Array.isArray(usersData)
      ? Object.fromEntries(usersData.map(u => [u.id, u]))
      : usersData;
    let changed = false;
    for (const uid of uids) {
      const u = usersMap[uid]; if (!u) continue;
      if (_homeyPresence[uid] !== u.present) { changed = true; _homeyPresence[uid] = u.present; }
    }
    if (changed) {
      _wInvalidate('who_home');
      broadcastSSE('refresh', { source: 'homey', widgets: ['who_home'] });
    }
  } catch (_) {}
}

setInterval(() => homeyPoll().catch(() => {}), 15000);
setTimeout(() => homeyPoll().catch(() => {}), 6000); // initial run after 6s

// ── Homey real-time socket.io connection ──────────────────────────────────────
let _homeySocket = null;
let _homeyDeviceBroadcastTimer = null; // throttle device capability SSE bursts

function homeySocketConnect() {
  const g = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
  const url = g('homey_url').replace(/\/$/, '');
  const token = g('homey_token');
  if (!url || !token) return;

  if (_homeySocket) { try { _homeySocket.disconnect(); } catch {} _homeySocket = null; }
  if (_homeyDeviceBroadcastTimer) { clearTimeout(_homeyDeviceBroadcastTimer); _homeyDeviceBroadcastTimer = null; }

  console.log('[homey-socket] connecting to', url);
  _homeySocket = socketIoClient(url, {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 5000,
    reconnectionAttempts: Infinity,
    timeout: 10000,
  });

  _homeySocket.on('connect', () => console.log('[homey-socket] connected, id:', _homeySocket.id));
  _homeySocket.on('disconnect', reason => console.log('[homey-socket] disconnected:', reason));
  _homeySocket.on('connect_error', err => console.warn('[homey-socket] connect error:', err.message));

  let _realtimeLogCount = 0;
  _homeySocket.on('realtime', (type, id, data) => {
    if (_realtimeLogCount < 10) { _realtimeLogCount++; console.log('[homey-socket] realtime:', type, id, JSON.stringify(data)?.slice(0, 120)); }

    const t = String(type || '').toLowerCase();

    // Presence: user present state changed
    if (t.includes('user') && (t.includes('present') || id === 'present')) {
      console.log('[homey-socket] presence event — refreshing who_home');
      _wInvalidate('who_home');
      broadcastSSE('refresh', { source: 'homey', widgets: ['who_home'] });
      return;
    }

    // Device capability change — throttle to at most one SSE broadcast per 10s
    if (t.includes('device') || t.includes('capability')) {
      _wInvalidate('ha_sensors');
      _wInvalidate('thermostat');
      if (!_homeyDeviceBroadcastTimer) {
        _homeyDeviceBroadcastTimer = setTimeout(() => {
          _homeyDeviceBroadcastTimer = null;
          broadcastSSE('refresh', { source: 'homey', widgets: ['ha_sensors', 'thermostat'] });
        }, 10000);
      }
    }
  });

  // Catch-all: log first 10 unknown events to discover Homey's format if realtime doesn't fire
  let _anyLogCount = 0;
  _homeySocket.onAny((event, ...args) => {
    if (event === 'realtime' || event === 'connect' || event === 'disconnect') return;
    if (_anyLogCount < 10) { _anyLogCount++; console.log('[homey-socket] event:', event, JSON.stringify(args)?.slice(0, 200)); }
  });
}

setTimeout(homeySocketConnect, 8000); // after DB + poll init

// Sync US federal holidays into the events table (runs on boot + yearly cron)
async function syncUSHolidays() {
  const exists = db.prepare('SELECT id FROM events WHERE external_id=?');
  const ins = db.prepare('INSERT INTO events (title,date,time,calendar,color,source,external_id) VALUES (?,?,?,?,?,?,?)');
  for (const year of [new Date().getFullYear(), new Date().getFullYear() + 1]) {
    try {
      const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/US`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const holidays = await r.json();
      for (const h of holidays) {
        if (!h.global || !h.types?.includes('Public')) continue;
        const extId = `nager-${h.date}`;
        if (!exists.get(extId)) ins.run(h.localName || h.name, h.date, 'All day', 'kith', '#FF6B6B', 'holiday', extId);
      }
    } catch (e) { console.error('[holidays]', e?.message || e); }
  }
}
syncUSHolidays();
cron.schedule('0 3 1 1 *', syncUSHolidays); // re-sync on Jan 1st each year

// ── Cleanup: expired messages + old delivered packages ────────────────────────
cron.schedule('0 * * * *', () => {
  try {
    db.prepare("DELETE FROM messages WHERE expires_at <= datetime('now')").run();
    db.prepare("DELETE FROM packages WHERE delivered=1 AND created_at < datetime('now', '-3 days')").run();
  } catch (e) { console.error('[cleanup]', e?.message || e); }
});

app.listen(PORT, () => console.log(`Kith running → http://localhost:${PORT}`));
