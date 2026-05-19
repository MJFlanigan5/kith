'use strict';
const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const cron       = require('node-cron');
const webpush    = require('web-push');
const db         = require('./db');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');

const app  = express();
const PORT = process.env.PORT || 7400;

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
  db.prepare("UPDATE chores SET status='overdue'  WHERE next_due < ? AND done=0").run(today);
  db.prepare("UPDATE chores SET status='due'      WHERE next_due = ? AND done=0").run(today);
  db.prepare("UPDATE chores SET status='upcoming' WHERE next_due > ?").run(today);
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
  if (recurrence.startsWith('Daily'))      d.setDate(d.getDate() + 1);
  else if (recurrence.startsWith('Bi-w'))  d.setDate(d.getDate() + 14);
  else if (recurrence.startsWith('Month')) addMonths(d);
  else if (recurrence.startsWith('Annual')) d.setFullYear(d.getFullYear() + 1);
  else if (recurrence.startsWith('Weekday')) {
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  } else d.setDate(d.getDate() + 7); // Weekly
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
  res.json(db.prepare("SELECT * FROM chores ORDER BY CASE status WHEN 'overdue' THEN 0 WHEN 'due' THEN 1 ELSE 2 END, created_at").all());
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
  const { name, recurrence, start, points, outdoor=0, goal_id=null, goal_amount=1 } = req.body;
  if (!name?.trim() || !recurrence?.trim()) return res.status(400).json({ error: 'name and recurrence are required' });
  const today = localDate();
  const nextDue = start || today;
  const status = nextDue <= today ? 'due' : 'upcoming';
  const r = db.prepare(
    'INSERT INTO chores (name,recurrence,next_due,status,points,outdoor,goal_id,goal_amount) VALUES (?,?,?,?,?,?,?,?)'
  ).run(name.trim(), recurrence.trim(), nextDue, status, Number(points)||1, outdoor?1:0, goal_id||null, Number(goal_amount)||1);
  res.json(db.prepare('SELECT * FROM chores WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/chores/:id', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM chores WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const { name, recurrence, next_due, points, outdoor, goal_id, goal_amount } = req.body;
  const today = localDate();
  const nd = next_due || c.next_due;
  const status = nd < today ? 'overdue' : nd === today ? 'due' : 'upcoming';
  db.prepare('UPDATE chores SET name=?,recurrence=?,next_due=?,status=?,points=?,outdoor=?,goal_id=?,goal_amount=? WHERE id=?')
    .run(
      name || c.name, recurrence || c.recurrence, nd, status,
      points != null ? Number(points) : (c.points||1),
      outdoor != null ? (outdoor?1:0) : (c.outdoor||0),
      goal_id !== undefined ? (goal_id||null) : c.goal_id,
      goal_amount != null ? Number(goal_amount) : (c.goal_amount||1),
      c.id
    );
  res.json(db.prepare('SELECT * FROM chores WHERE id=?').get(c.id));
});

app.put('/api/chores/:id/done', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM chores WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const done = c.done ? 0 : 1;
  const todayISO = localDate();
  const todayDisplay = new Date().toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const nextDue = done ? computeNextDue(c.recurrence) : todayISO;
  const lastDone = done ? todayDisplay : c.last_done;
  db.prepare('UPDATE chores SET done=?,last_done=?,next_due=? WHERE id=?').run(done, lastDone, nextDue, c.id);
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
  res.json({ done, next_due: nextDue, status: newStatus, points_earned: done ? (c.points || 1) : 0 });
});

app.delete('/api/chores/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM chores WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Routes: Grocery ───────────────────────────────────────────────────────────
app.get('/api/grocery', (req, res) => {
  res.json(db.prepare('SELECT * FROM grocery ORDER BY checked, category, created_at').all());
});

app.post('/api/grocery', requireAuth, (req, res) => {
  const { name, category } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const r = db.prepare('INSERT INTO grocery (name,category) VALUES (?,?)').run(name.trim(), category||'Other');
  res.json({ id: r.lastInsertRowid, name, category: category||'Other', checked: 0 });
});

app.put('/api/grocery/:id/toggle', requireAuth, (req, res) => {
  const item = db.prepare('SELECT checked FROM grocery WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const checked = item.checked ? 0 : 1;
  db.prepare('UPDATE grocery SET checked=? WHERE id=?').run(checked, req.params.id);
  res.json({ checked });
});

app.delete('/api/grocery/checked', requireAuth, (req, res) => {
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

app.put('/api/meals/:day', requireAuth, (req, res) => {
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
const SETTINGS_SENSITIVE = new Set(['email_webhook_secret','anthropic_api_key','ai_api_key','jwt_secret','vapid_public','vapid_private','admin_pin_hash','resend_api_key','ha_webhook_secret','smart_home_token','ha_token','homey_token']);
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
    _newsCache = results.flat().slice(0, 20);
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

app.put('/api/goals/:id', requireAuth, (req, res) => {
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
  res.json(db.prepare('SELECT * FROM polls ORDER BY created_at DESC').all().map(p => ({
    ...p, options: JSON.parse(p.options), votes: JSON.parse(p.votes || '{}'),
  })));
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
  const options = JSON.parse(p.options);
  const { option } = req.body || {};
  if (typeof option !== 'number' || option < 0 || option >= options.length)
    return res.status(400).json({ error: 'Invalid option index' });
  const votes = JSON.parse(p.votes || '{}');
  votes[option] = (votes[option] || 0) + 1;
  db.prepare('UPDATE polls SET votes=? WHERE id=?').run(JSON.stringify(votes), p.id);
  res.json({ votes });
});

app.delete('/api/polls/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM polls WHERE id=?').run(req.params.id);
  res.json({ ok: true });
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
  res.json({ ok: true });
});

app.get('/api/ha/smart-home-status', requireAdmin, (req, res) => {
  const get = k => db.prepare(`SELECT value FROM settings WHERE key=?`).get(k)?.value || '';
  res.json({
    ha: { url: get('ha_url'), hasToken: !!get('ha_token') },
    homey: { url: get('homey_url'), hasToken: !!get('homey_token') },
  });
});

app.get('/api/ha/pull', async (req, res) => {
  const get = k => db.prepare(`SELECT value FROM settings WHERE key=?`).get(k)?.value;
  const haUrl = get('ha_url'); const haToken = get('ha_token');
  const homeyUrl = get('homey_url'); const homeyToken = get('homey_token');

  const fetchHA = async () => {
    if (!haUrl || !haToken) return [];
    const base = haUrl.replace(/\/$/, '');
    const states = await fetch(`${base}/api/states`, {
      headers: { 'Authorization': `Bearer ${haToken}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(6000),
    }).then(r => r.json());
    return (Array.isArray(states) ? states : [])
      .filter(s => s.entity_id?.startsWith('persistent_notification.') && s.state !== 'dismissed')
      .map(s => ({ title: s.attributes?.title || s.entity_id.replace('persistent_notification.', ''), message: s.attributes?.message || '', icon: '🏠', created_at: s.last_changed || new Date().toISOString() }));
  };

  const fetchHomey = async () => {
    if (!homeyUrl || !homeyToken) return [];
    const base = homeyUrl.replace(/\/$/, '');
    const r = await fetch(`${base}/api/manager/notifications/notification/`, {
      headers: { 'Authorization': `Bearer ${homeyToken}` },
      signal: AbortSignal.timeout(6000),
    }).then(r => r.json());
    const items = r.result || {};
    return Object.values(items)
      .map(n => ({ title: n.excerpt || 'Homey notification', message: '', icon: '🏠', created_at: n.dateCreated || new Date().toISOString() }));
  };

  try {
    const [haEvents, homeyEvents] = await Promise.all([fetchHA().catch(()=>[]), fetchHomey().catch(()=>[])]);
    const merged = [...haEvents, ...homeyEvents].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
    res.json(merged);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Routes: Quick Actions ─────────────────────────────────────────────────────
app.get('/api/quick-actions', (req, res) => {
  const raw = db.prepare("SELECT value FROM settings WHERE key='quick_actions'").get()?.value;
  res.json(JSON.parse(raw || '[]'));
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
  const action = JSON.parse(raw || '[]').find(a => a.id === id);
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

// ── Routes: Claude / AI usage ─────────────────────────────────────────────────
let _claudeUsageCache = null;
let _claudeUsageCacheAt = 0;

app.get('/api/claude-usage', async (req, res) => {
  if (_claudeUsageCache && Date.now() - _claudeUsageCacheAt < 60000) {
    return res.json(_claudeUsageCache);
  }
  const apiKey = db.prepare("SELECT value FROM settings WHERE key IN ('ai_api_key','anthropic_api_key') AND value != '' ORDER BY key LIMIT 1").get()?.value
    || process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return res.json({ available: false });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: '.' }] }),
      signal: AbortSignal.timeout(10000),
    });
    const sessionPct = Math.round(parseFloat(r.headers.get('anthropic-ratelimit-unified-5h-utilization') || '0') * 100);
    const resetAt = r.headers.get('anthropic-ratelimit-unified-5h-reset');
    const tokensRemaining = parseInt(r.headers.get('anthropic-ratelimit-unified-5h-remaining') || r.headers.get('anthropic-ratelimit-tokens-remaining') || '0');
    const resetMins = resetAt ? Math.max(0, Math.round((new Date(resetAt) - Date.now()) / 60000)) : null;
    _claudeUsageCache = { available: true, session_pct: sessionPct, tokens_remaining: tokensRemaining, reset_mins: resetMins };
    _claudeUsageCacheAt = Date.now();
    res.json(_claudeUsageCache);
  } catch {
    res.json({ available: false });
  }
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
    } else if (provider === 'openai' || provider === 'groq') {
      const baseUrl = provider === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
      const model = provider === 'groq' ? 'llama-3.1-8b-instant' : 'gpt-4o-mini';
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

  db.prepare('INSERT INTO inbox (subject,event_name,event_date,event_time,recurrence,confidence) VALUES (?,?,?,?,?,?)')
    .run(subject || '', event_name, event_date, event_time, recurrence, confidence);

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

app.listen(PORT, () => console.log(`Kith running → http://localhost:${PORT}`));
