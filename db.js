'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'hearth.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT DEFAULT 'All day',
  duration TEXT DEFAULT '1h',
  calendar TEXT DEFAULT 'hearth',
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
`);

// member_id on events — added after initial schema; safe to run on every boot
try { db.exec('ALTER TABLE events ADD COLUMN member_id INTEGER'); } catch {}

// ── Seed data (only on first run) ────────────────────────────────────────────

const _d = new Date();
const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;

if (!db.prepare('SELECT COUNT(*) as c FROM events').get().c) {
  const ins = db.prepare('INSERT INTO events (title,date,time,calendar,color,source) VALUES (?,?,?,?,?,?)');
  ins.run('Team standup',      '2026-04-24', '9:00 AM',  'work',     '#5856D6', 'google');
  ins.run('Dentist — Mia',     '2026-04-24', '2:30 PM',  'personal', '#007AFF', 'google');
  ins.run('Soccer Practice',   '2026-04-25', '4:00 PM',  'hearth',   '#34C759', 'manual');
  ins.run('Dinner at Andersons','2026-04-25','7:00 PM',  'family',   '#32ADE6', 'google');
  ins.run('Flight ATL → ORD',  '2026-04-26', '7:45 AM',  'personal', '#007AFF', 'google');
  ins.run('Talent Show',       '2026-04-27', '6:30 PM',  'hearth',   '#34C759', 'manual');
  ins.run('Piano lesson',      '2026-04-28', '3:30 PM',  'hearth',   '#34C759', 'manual');
  ins.run('Weekly review',     '2026-04-28', '10:00 AM', 'work',     '#5856D6', 'google');
}

if (!db.prepare('SELECT COUNT(*) as c FROM chores').get().c) {
  const ins = db.prepare('INSERT INTO chores (name,recurrence,last_done,next_due,status,done) VALUES (?,?,?,?,?,?)');
  ins.run('Take out trash',    'Weekly (Mon)',  '2026-04-21', today,        'due',      0);
  ins.run('Vacuum living room','Weekly (Sat)',  '2026-04-19', '2026-04-26', 'upcoming', 0);
  ins.run('Clean bathrooms',   'Weekly (Sun)',  '2026-04-20', '2026-04-27', 'upcoming', 0);
  ins.run('Wipe down kitchen', 'Daily',         '2026-04-23', today,        'due',      0);
  ins.run('Change bedsheets',  'Bi-weekly',     '2026-04-13', '2026-04-27', 'upcoming', 0);
  ins.run('Pay rent',          'Monthly (1st)', '2026-04-01', '2026-05-01', 'upcoming', 0);
}

if (!db.prepare('SELECT COUNT(*) as c FROM grocery').get().c) {
  const ins = db.prepare('INSERT INTO grocery (name,category,checked) VALUES (?,?,?)');
  ins.run('Milk',          'Dairy',   0);
  ins.run('Eggs',          'Dairy',   0);
  ins.run('Chicken breast','Meat',    0);
  ins.run('Broccoli',      'Produce', 0);
  ins.run('Spinach',       'Produce', 1);
  ins.run('Pasta',         'Pantry',  0);
  ins.run('Olive oil',     'Pantry',  1);
  ins.run('Greek yogurt',  'Dairy',   0);
  ins.run('Apples',        'Produce', 0);
}

if (!db.prepare('SELECT COUNT(*) as c FROM meals').get().c) {
  const ins = db.prepare('INSERT INTO meals (day,meal) VALUES (?,?)');
  for (const [d, m] of [['Mon','Pasta carbonara'],['Tue','Tacos'],['Wed',''],['Thu','Grilled salmon'],['Fri','Pizza'],['Sat',''],['Sun','Roast chicken']]) {
    ins.run(d, m);
  }
}

if (!db.prepare('SELECT COUNT(*) as c FROM inbox').get().c) {
  const ins = db.prepare('INSERT INTO inbox (subject,event_name,event_date,event_time,recurrence,confidence) VALUES (?,?,?,?,?,?)');
  ins.run('Youth Soccer Schedule — Spring 2026', 'Soccer Practice',  'Tuesdays · Apr 29 – Jun 17', '4:00 PM', 'Weekly',   'high');
  ins.run('RE: School Talent Show',              'Talent Show',       'May 14',                     '6:30 PM', 'One-time', 'high');
  ins.run('Your Delta flight confirmation',       'Flight ATL → ORD', 'May 22',                     '7:45 AM', 'One-time', 'medium');
}

if (!db.prepare('SELECT COUNT(*) as c FROM recently_added').get().c) {
  const ins = db.prepare('INSERT INTO recently_added (event_name,event_date,source) VALUES (?,?,?)');
  ins.run("Emma's birthday party",      'Apr 19', 'Email');
  ins.run('Spring Break — school closed','Apr 10', 'Email');
  ins.run("Jack's baseball game",        'Apr 6',  'Email');
  ins.run('HOA Meeting',                 'Mar 28', 'Email');
  ins.run('Oil change appointment',      'Mar 15', 'Email');
}

const defaults = {
  clock_format: '12h', temperature_unit: 'F', refresh_interval: '1min',
  google_email: 'mike@gmail.com', google_connected: '1',
  smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '',
  forwarding_address: 'hearth@local.home',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
for (const [k, v] of Object.entries(defaults)) insSetting.run(k, v);

module.exports = db;
