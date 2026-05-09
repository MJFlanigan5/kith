'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// migrate DB filename from old "hearth" name
const oldDb = path.join(DATA_DIR, 'hearth.db');
const newDb = path.join(DATA_DIR, 'kith.db');
if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) fs.renameSync(oldDb, newDb);

const db = new Database(newDb);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT DEFAULT 'All day',
  duration TEXT DEFAULT '1h',
  calendar TEXT DEFAULT 'kith',
  color TEXT DEFAULT '#34C759',
  notes TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  external_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  recurrence TEXT NOT NULL,
  last_done TEXT DEFAULT '',
  next_due TEXT DEFAULT '',
  status TEXT DEFAULT 'upcoming',
  done INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS grocery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'Other',
  checked INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meals (
  day TEXT PRIMARY KEY,
  meal TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT,
  event_name TEXT,
  event_date TEXT,
  event_time TEXT,
  recurrence TEXT,
  confidence TEXT DEFAULT 'high',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recently_added (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT NOT NULL,
  event_date TEXT,
  source TEXT DEFAULT 'Email',
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ics_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  enabled INTEGER DEFAULT 1,
  last_synced DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS countdowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  date TEXT NOT NULL,
  emoji TEXT DEFAULT '🎉',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS family_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#007AFF',
  initials TEXT NOT NULL DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chore_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chore_id INTEGER NOT NULL,
  member_id INTEGER,
  member_name TEXT DEFAULT '',
  points INTEGER DEFAULT 1,
  completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// migrations — safe to run on every boot
try { db.exec('ALTER TABLE events ADD COLUMN member_id INTEGER'); } catch {}
try { db.exec(`ALTER TABLE events ADD COLUMN end_time TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE events ADD COLUMN recurring_rule TEXT DEFAULT ''`); } catch {}
try { db.exec('ALTER TABLE family_members ADD COLUMN pin_hash TEXT'); } catch {}
try { db.exec('ALTER TABLE chores ADD COLUMN points INTEGER DEFAULT 1'); } catch {}
db.prepare("UPDATE events SET calendar='kith' WHERE calendar IN ('personal','work','family','hearth')").run();
db.prepare("UPDATE events SET time='All day' WHERE time IS NULL OR time=''").run();
// Update old default forwarding address
const _fwd = db.prepare("SELECT value FROM settings WHERE key='forwarding_address'").get();
if (_fwd?.value === 'hearth@local.home' || _fwd?.value === 'hearth@mjflanigan.com') {
  db.prepare("UPDATE settings SET value='' WHERE key='forwarding_address'").run();
}
// Migrate from anthropic_api_key to ai_api_key
const _oldKey = db.prepare("SELECT value FROM settings WHERE key='anthropic_api_key'").get();
const _newKey = db.prepare("SELECT value FROM settings WHERE key='ai_api_key'").get();
if (_oldKey?.value && !_newKey) {
  db.prepare("INSERT INTO settings (key,value) VALUES (?,?)").run('ai_api_key', _oldKey.value);
  db.prepare("INSERT INTO settings (key,value) VALUES (?,?)").run('ai_provider', 'anthropic');
}
// Mark wizard complete if app has existing data (upgrade scenario — skip wizard for returning users)
const _wiz = db.prepare("SELECT value FROM settings WHERE key='wizard_completed'").get();
if (!_wiz) {
  const _hasMembers = db.prepare('SELECT COUNT(*) as c FROM family_members').get().c > 0;
  const _hasCity = (db.prepare("SELECT value FROM settings WHERE key='weather_city'").get()?.value || '').length > 0;
  if (_hasMembers || _hasCity) db.prepare("INSERT INTO settings (key,value) VALUES (?,?)").run('wizard_completed','1');
}

// ── Seed data removed — app starts empty for real use ────────────────────────
// Meals table needs rows to exist for the meal planner (one row per day, blank)
if (!db.prepare('SELECT COUNT(*) as c FROM meals').get().c) {
  const ins = db.prepare('INSERT INTO meals (day,meal) VALUES (?,?)');
  for (const d of ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']) ins.run(d, '');
}

const defaults = {
  clock_format: '12h', temperature_unit: 'F', refresh_interval: '1min',
  smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '',
  forwarding_address: '',
  email_webhook_secret: require('crypto').randomBytes(24).toString('hex'),
  anthropic_api_key: '',
  ai_provider: 'gemini',
  ai_api_key: '',
  weather_lat: '33.8533', weather_lon: '-84.2201', weather_city: '',
  sports_leagues: 'nba,nfl,mlb,nhl',
  news_feed: 'https://feeds.npr.org/1001/rss.xml',
  night_mode_start: '23:00',
  night_mode_end: '06:00',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
for (const [k, v] of Object.entries(defaults)) insSetting.run(k, v);

module.exports = db;
