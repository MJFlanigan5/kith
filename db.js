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

CREATE TABLE IF NOT EXISTS household_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  progress_type TEXT DEFAULT 'percent',
  progress_current REAL DEFAULT 0,
  progress_target REAL DEFAULT 100,
  unit TEXT DEFAULT '',
  deadline TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  color TEXT DEFAULT '#FAFAF5',
  pinned INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  votes TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ha_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT DEFAULT '',
  icon TEXT DEFAULT '🏠',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT DEFAULT '',
  emoji TEXT DEFAULT '🔗',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  carrier TEXT DEFAULT '',
  tracking_number TEXT DEFAULT '',
  description TEXT DEFAULT '',
  expected_date TEXT DEFAULT '',
  status TEXT DEFAULT 'in_transit',
  delivered INTEGER DEFAULT 0,
  source_subject TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  author TEXT DEFAULT '',
  member_id INTEGER,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  servings INTEGER DEFAULT 4,
  prep_time INTEGER DEFAULT 0,
  cook_time INTEGER DEFAULT 0,
  ingredients TEXT DEFAULT '[]',
  steps TEXT DEFAULT '',
  source_url TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL DEFAULT 0,
  due_day INTEGER DEFAULT 1,
  due_date TEXT DEFAULT '',
  recurrence TEXT DEFAULT 'monthly',
  category TEXT DEFAULT 'Other',
  color TEXT DEFAULT '#3B82F6',
  notes TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bill_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, period)
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  make TEXT DEFAULT '',
  model TEXT DEFAULT '',
  year INTEGER DEFAULT 0,
  color TEXT DEFAULT '#3B82F6',
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vehicle_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  interval_days INTEGER DEFAULT 0,
  interval_miles INTEGER DEFAULT 0,
  last_done_date TEXT DEFAULT '',
  last_done_miles INTEGER DEFAULT 0,
  next_due_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// migrations — safe to run on every boot
try { db.exec('ALTER TABLE events ADD COLUMN member_id INTEGER'); } catch {}
try { db.exec("ALTER TABLE family_members ADD COLUMN birthday TEXT DEFAULT ''"); } catch {}
try { db.exec(`ALTER TABLE events ADD COLUMN end_time TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE events ADD COLUMN recurring_rule TEXT DEFAULT ''`); } catch {}
try { db.exec('ALTER TABLE family_members ADD COLUMN pin_hash TEXT'); } catch {}
try { db.exec('ALTER TABLE chores ADD COLUMN points INTEGER DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE family_members ADD COLUMN monthly_goal INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE chores ADD COLUMN outdoor INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE chores ADD COLUMN goal_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE chores ADD COLUMN goal_amount REAL DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE chores ADD COLUMN member_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE chores ADD COLUMN streak INTEGER DEFAULT 0'); } catch {}
try { db.exec("ALTER TABLE family_members ADD COLUMN reward TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE meals ADD COLUMN breakfast TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE vehicles ADD COLUMN vin TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE grocery ADD COLUMN qty TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE meals ADD COLUMN lunch TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE meals ADD COLUMN dinner_recipe_id INTEGER"); } catch {}
try { db.exec("ALTER TABLE meals ADD COLUMN breakfast_recipe_id INTEGER"); } catch {}
try { db.exec("ALTER TABLE meals ADD COLUMN lunch_recipe_id INTEGER"); } catch {}
// Grocery quick-add history
db.exec(`CREATE TABLE IF NOT EXISTS grocery_history (
  name TEXT PRIMARY KEY,
  count INTEGER DEFAULT 1,
  last_used TEXT
)`)
db.exec(`CREATE TABLE IF NOT EXISTS home_appliances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT DEFAULT '',
  purchase_date TEXT DEFAULT '',
  warranty_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS home_consumables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT DEFAULT '',
  interval_days INTEGER NOT NULL DEFAULT 90,
  last_replaced TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS home_maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  month INTEGER NOT NULL,
  notes TEXT DEFAULT '',
  last_done TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  species TEXT DEFAULT '',
  breed TEXT DEFAULT '',
  birthday TEXT DEFAULT '',
  vet_name TEXT DEFAULT '',
  vet_phone TEXT DEFAULT '',
  color TEXT DEFAULT '#FF9500',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS pet_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  last_done TEXT DEFAULT '',
  interval_days INTEGER DEFAULT 0,
  next_due TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',
  category TEXT DEFAULT 'Other',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS vehicle_mileage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  miles INTEGER NOT NULL,
  date TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS budget_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  monthly_budget REAL DEFAULT 0,
  color TEXT DEFAULT '#3B82F6',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS budget_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  note TEXT DEFAULT '',
  date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS emergency_info (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
)`)
db.exec(`CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL DEFAULT 0,
  billing_cycle TEXT DEFAULT 'monthly',
  next_billing TEXT DEFAULT '',
  category TEXT DEFAULT 'Other',
  color TEXT DEFAULT '#5856D6',
  active INTEGER DEFAULT 1,
  trial_ends TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS home_repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  date TEXT DEFAULT '',
  cost REAL DEFAULT 0,
  contractor TEXT DEFAULT '',
  category TEXT DEFAULT 'Other',
  warranty_until TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS member_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL UNIQUE,
  blood_type TEXT DEFAULT '',
  allergies TEXT DEFAULT '',
  medications TEXT DEFAULT '',
  conditions TEXT DEFAULT '',
  doctor_name TEXT DEFAULT '',
  doctor_phone TEXT DEFAULT '',
  insurance_provider TEXT DEFAULT '',
  insurance_id TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS shared_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '📋',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS shared_list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  checked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'planned',
  priority TEXT DEFAULT 'medium',
  cost_estimate REAL DEFAULT 0,
  cost_actual REAL DEFAULT 0,
  due_date TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS pantry_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT DEFAULT 'Pantry',
  quantity REAL DEFAULT 1,
  unit TEXT DEFAULT '',
  expires_on TEXT DEFAULT '',
  low_stock_at REAL DEFAULT 0,
  category TEXT DEFAULT 'Other',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS school_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER,
  school_name TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  teacher_name TEXT DEFAULT '',
  teacher_email TEXT DEFAULT '',
  school_phone TEXT DEFAULT '',
  start_time TEXT DEFAULT '',
  end_time TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS school_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_member_id INTEGER NOT NULL,
  period TEXT DEFAULT '',
  subject TEXT NOT NULL,
  teacher TEXT DEFAULT '',
  room TEXT DEFAULT '',
  days TEXT DEFAULT 'Mon,Tue,Wed,Thu,Fri',
  created_at TEXT DEFAULT (datetime('now'))
)`)
// Seed emergency_info default keys
const _emKeys=['gas_shutoff','water_shutoff','electric_shutoff','insurance_company','policy_number','insurance_phone','doctor_name','doctor_phone','medical_notes','extra_notes'];
const _insEm=db.prepare('INSERT OR IGNORE INTO emergency_info (key,value) VALUES (?,?)');
for(const k of _emKeys) _insEm.run(k,'');
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

// Sprint 9 migrations
try { db.prepare("ALTER TABLE chore_completions ADD COLUMN photo_filename TEXT").run(); } catch(e) {}
try { db.prepare("ALTER TABLE family_members ADD COLUMN family_role TEXT DEFAULT 'adult'").run(); } catch(e) {}

// Persistent IMAP UID tracking — prevents re-processing emails after server restart
db.exec(`CREATE TABLE IF NOT EXISTS imap_processed_uids (
  uid INTEGER NOT NULL,
  mailbox TEXT NOT NULL DEFAULT 'INBOX',
  processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (uid, mailbox)
)`);
// Prune UIDs older than 60 days on startup to keep the table small
try { db.prepare("DELETE FROM imap_processed_uids WHERE processed_at < datetime('now','-60 days')").run(); } catch(e) {}

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
  imap_host: 'imap.gmail.com', imap_port: '993', imap_user: '', imap_pass: '', imap_enabled: '0', imap_poll_interval: '120',
  email_webhook_secret: require('crypto').randomBytes(24).toString('hex'),
  anthropic_api_key: '',
  ai_provider: 'gemini',
  ai_api_key: '',
  weather_lat: '33.8533', weather_lon: '-84.2201', weather_city: '',
  sports_leagues: 'nba,nfl,mlb,nhl',
  news_feed: 'https://feeds.npr.org/1001/rss.xml',
  night_mode_start: '23:00',
  night_mode_end: '06:00',
  ha_webhook_secret: require('crypto').randomBytes(24).toString('hex'),
  quick_actions: '[]',
  lastfm_api_key: '',
  lastfm_user: '',
  moen_user: '',
  moen_pass: '',
  unifi_url: '',
  unifi_user: '',
  unifi_pass: '',
  unifi_site: 'default',
  unifi_pull_interval: '60',
  wifi_ssid: '',
  wifi_password: '',
  ha_moen_flow: '',
  ha_moen_pressure: '',
  ha_moen_daily: '',
  ha_moen_mode: '',
  ha_moen_alert: '',
  ha_unifi_clients: '',
  ha_unifi_rx: '',
  ha_unifi_tx: '',
  ha_person_entities: '',
  ha_climate_entity: '',
  ha_media_entity: '',
  presence_source: 'both',
  ha_sensor_entities: '',
  homey_sensor_devices: '',
  homey_person_devices: '',
  homey_climate_device: '',
  ics_export_token: require('crypto').randomBytes(16).toString('hex'),
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
for (const [k, v] of Object.entries(defaults)) insSetting.run(k, v);

module.exports = db;
