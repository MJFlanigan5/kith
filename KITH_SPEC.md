# Kith Feature Spec
_Last updated: 2026-06-09_

This document covers all pending and planned features for Kith, in priority order.

---

## SPRINT 1 — In-progress / Already scoped

### 1. Edit existing countdowns
**Screen:** CountdownsScreen  
**What:** Tap a countdown to edit its name or date. Currently countdowns can only be deleted.  
**API:** `PUT /api/countdowns/:id` → `{ name, date }`  
**UI:** Inline edit form or modal on row tap. "Clear Past" button removes all countdowns whose date has passed.  
**Error guards:** Handle missing countdown, bad date format.

---

### 2. Edit family member names and colors
**Screen:** FamilyScreen  
**What:** Tap a member to edit name and color. Currently read-only after creation.  
**API:** `PUT /api/members/:id` → `{ name, color }`  
**UI:** Inline edit on member row. Color picker (same as add flow).  
**Error guards:** Empty name validation, duplicate name warning.

---

### 3. Chore member assignment
**Screen:** ChoresScreen  
**What:** Assign a chore to a specific family member. Chores table already has `member_id` column (migration done). Need selector in add/edit UI and display of assigned member on chore row.  
**API:** `PUT /api/chores/:id` → `{ member_id }` (add to existing route)  
**UI:** Dropdown of family members in add-chore form. Member name/avatar shown on chore row. Filter by member optional.

---

### 4. Grocery category input
**Screen:** GroceryScreen  
**What:** When adding a grocery item, optionally assign a category (Produce, Dairy, Meat, Frozen, etc.). Groups items by category in the list view.  
**API:** `POST /api/grocery` already exists — add `category` field to schema and route.  
**UI:** Text input or predefined dropdown in add form. Category header rows in list.

---

### 5. DisplayMode quick actions
**Screen:** DisplayMode + App  
**What:** Configurable quick-action buttons visible on the display screen (e.g., "Mark chore done", "Add grocery item"). Defined in Settings, passed as props to DisplayMode.  
**API:** Stored in settings table as JSON array.  
**UI:** Row of icon buttons at bottom of DisplayMode. Tapping opens a minimal input sheet.

---

## SPRINT 2 — New: Home Screen

### 6. Home — Appliances tracker
**Screen:** HomeScreen (new), tab 1  
**What:** Track household appliances and assets with warranty dates and notes. Same mental model as Vehicles.

**DB — new table:**
```sql
CREATE TABLE IF NOT EXISTS home_appliances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,           -- room or area (Kitchen, Basement, etc.)
  purchase_date TEXT,      -- ISO date
  warranty_date TEXT,      -- ISO date — alert when within 30 days
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**API routes:**
- `GET /api/home/appliances`
- `POST /api/home/appliances` → `{ name, location, purchase_date, warranty_date, notes }`
- `PUT /api/home/appliances/:id`
- `DELETE /api/home/appliances/:id`

**UI:**
- List of appliances sorted by warranty date ascending
- Warranty expiring within 30 days → yellow badge
- Warranty expired → red badge
- Add/edit form: name, room, purchase date, warranty date, notes

**DisplayMode:** "Warranties expiring soon" alert card if any within 30 days.

---

### 7. Home — Consumables tracker (auto-reset countdowns)
**Screen:** HomeScreen (new), tab 2  
**What:** Track consumable items that need periodic replacement. User sets a replace interval; Kith calculates the next due date and auto-resets when user marks it replaced. This is the closest Kith can get to "automatic" tracking without physical sensors.

**How it works:**
1. Add item: "Furnace Filter — replace every 90 days — last replaced: June 1"
2. Kith calculates next due: September 1
3. Shows as a countdown with status (OK / Due Soon / Overdue)
4. Tap "Replaced" → sets last_replaced to today, recalculates next due automatically

**DB — new table:**
```sql
CREATE TABLE IF NOT EXISTS home_consumables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  interval_days INTEGER NOT NULL,   -- replacement interval
  last_replaced TEXT,               -- ISO date
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Computed fields (server-side, not stored):**
- `next_due` = last_replaced + interval_days
- `days_remaining` = next_due - today
- `status` = 'ok' | 'due_soon' (≤7 days) | 'overdue'

**API routes:**
- `GET /api/home/consumables` — returns items with computed next_due, days_remaining, status
- `POST /api/home/consumables` → `{ name, location, interval_days, last_replaced, notes }`
- `PUT /api/home/consumables/:id`
- `DELETE /api/home/consumables/:id`
- `POST /api/home/consumables/:id/replaced` — sets last_replaced = today, returns updated item

**UI:**
- List sorted by days_remaining ascending (most urgent first)
- Status color: green (ok) / yellow (due soon) / red (overdue)
- Days remaining shown as "Due in 12 days" or "Overdue by 3 days"
- "Mark Replaced" button on each row — one tap, resets timer
- Add form: name, room, interval (days/weeks/months selector that converts to days), last replaced date

**DisplayMode:** "Items needing replacement" card showing overdue + due-soon consumables.

**Common consumables (pre-fill suggestions in add form):**
- Furnace/AC filter — 90 days
- Water filter — 180 days  
- Smoke detector battery — 365 days
- HVAC service — 365 days
- Refrigerator water filter — 180 days
- Dryer vent cleaning — 365 days

---

## SPRINT 2 — Navigation change

### 8. Add Home to nav
Current nav order: Dashboard → Calendar → Chores → Grocery → Vehicles → ...  
New: add Home between Vehicles and whatever follows.  
Home screen has two tabs: **Appliances** | **Consumables**

---

---

## SPRINT 3 — Family & Home completeness

### 9. Seasonal Maintenance (Home screen — tab 3)
**Screen:** HomeScreen, new tab 3  
**What:** Annual/seasonal tasks that don't fit chores (too infrequent) or consumables (not interval-based). Examples: "Service AC — every May", "Test smoke detectors — every October", "Flush water heater — every March". Tasks are triggered by calendar month each year.

**How it works:**
1. Add task: "Service AC — Month: May"
2. Kith computes status for the current year: upcoming / due this month / overdue (month passed, not done this year)
3. "Mark Done" logs today's date. Task resets to "upcoming" for next year automatically.

**DB — new table:**
```sql
CREATE TABLE IF NOT EXISTS home_maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  month INTEGER NOT NULL,       -- 1–12: trigger month
  notes TEXT DEFAULT '',
  last_done TEXT DEFAULT '',    -- ISO date of most recent completion
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Computed fields (server-side):**
- `next_due_year` = current year if month hasn't passed yet (or last_done was last year), else next year
- `next_due` = `YYYY-MM-01` of next occurrence
- `days_remaining` = days until next_due
- `status` = `'done_this_year'` | `'overdue'` (month passed without completing) | `'due_this_month'` (current month, not done) | `'upcoming'`

**API routes:**
- `GET /api/home/maintenance` — computed status on all tasks, sorted by next_due
- `POST /api/home/maintenance` → `{ name, month, notes }`
- `PUT /api/home/maintenance/:id`
- `DELETE /api/home/maintenance/:id`
- `POST /api/home/maintenance/:id/done` — sets last_done = today

**UI:**
- List sorted by month, grouped by status (Overdue / This Month / Upcoming / Done This Year)
- Month shown as name (e.g. "May") with days-away label when near
- "Mark Done" button — one tap
- Add form: name, month picker (Jan–Dec), notes

**DisplayMode:** folded into the "home" panel — shows overdue + this-month maintenance tasks alongside consumables.

**Common suggestions (pre-fill in add form):**
- AC / furnace service — May
- Smoke & CO detector test — October
- Water heater flush — March
- Gutter cleaning — November
- Dryer vent inspection — January
- Reverse ceiling fan direction — April / October
- Chimney inspection — September

---

### 10. Pets
**Screen:** PetsScreen (new), added to nav after Home  
**What:** Track pets with health records: vaccines, medications, vet visits, grooming. Same mental model as Vehicles (pet → has records with optional recurring due dates).

**DB — new tables:**
```sql
CREATE TABLE IF NOT EXISTS pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  species TEXT DEFAULT '',       -- Dog, Cat, Bird, etc.
  breed TEXT DEFAULT '',
  birthday TEXT DEFAULT '',      -- ISO date
  vet_name TEXT DEFAULT '',
  vet_phone TEXT DEFAULT '',
  color TEXT DEFAULT '#FF9500',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pet_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER NOT NULL,
  type TEXT NOT NULL,            -- 'vaccine' | 'medication' | 'vet_visit' | 'grooming'
  name TEXT NOT NULL,
  last_done TEXT DEFAULT '',     -- ISO date
  interval_days INTEGER DEFAULT 0,  -- 0 = one-time, >0 = recurring
  next_due TEXT DEFAULT '',      -- ISO date (computed or manual)
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
```

**API routes:**
- `GET /api/pets` — returns pets with their records joined
- `POST /api/pets` → `{ name, species, breed, birthday, vet_name, vet_phone, color, notes }`
- `PUT /api/pets/:id`
- `DELETE /api/pets/:id`
- `POST /api/pets/:id/records` → `{ type, name, last_done, interval_days, next_due, notes }`
- `PUT /api/pets/:id/records/:rid`
- `DELETE /api/pets/:id/records/:rid`
- `POST /api/pets/:id/records/:rid/done` → sets last_done = today, computes next_due from interval_days

**UI:**
- One card per pet with color dot and species
- Expandable record list: vaccines, meds, vet visits, grooming
- Record status: green (upcoming) / yellow (due within 30 days) / red (overdue)
- "Mark Done" on each record — same pattern as vehicle services
- Add/edit pet via Drawer (name, species, breed, birthday, vet info)
- Add/edit records via nested Drawer

**DisplayMode:** "Pet care due" panel — records overdue or due within 14 days, sorted by urgency.

---

### 11. Household Contacts
**Screen:** ContactsScreen (new), added to nav  
**What:** Quick-reference rolodex for household-important contacts. Not a full contacts app — just the people you actually call about your house and family. Plumber, pediatrician, neighbors, school, babysitter, etc.

**DB — new table:**
```sql
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',          -- "Plumber", "Pediatrician", etc.
  category TEXT DEFAULT 'Other', -- Home Services | Medical | Emergency | School | Neighbors | Other
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
```

**API routes:**
- `GET /api/contacts`
- `POST /api/contacts` → `{ name, role, category, phone, email, notes }`
- `PUT /api/contacts/:id`
- `DELETE /api/contacts/:id`

**UI:**
- Grouped by category with section headers
- Each row: name + role + phone (tap-to-call link on mobile)
- Inline edit on tap
- Quick-add form: name, role, category, phone, notes (email optional)
- Search/filter by name or category

**DisplayMode:** "Contacts" panel not shown automatically — only shown if a quick-action or future trigger references it. Contacts are available as a reference, not a rotating card.

**Error guards:** Empty name validation. Duplicate name warning (same name + phone).

---

### 12. Meal plan → Grocery list
**Screen:** GroceryScreen (existing) + minor MealPlanScreen change  
**What:** Link meal plan slots to saved recipes, then push that recipe's ingredient list directly to the grocery list. Closes the loop between planning what to cook and shopping for it.

**How it works:**
1. In the meal planner, tap a dinner slot → option to "Link recipe" opens a recipe picker
2. Linked slots show the recipe name (same as before) with a recipe icon
3. "Add to grocery" button on the meal planner sends all linked recipes' ingredients to the grocery list in one tap
4. Unlinked slots (free-text meals) are skipped — only recipes with known ingredients get added
5. Already-added items are de-duped by name (case-insensitive)

**DB — migration only (no new table):**
```sql
ALTER TABLE meals ADD COLUMN dinner_recipe_id INTEGER;
ALTER TABLE meals ADD COLUMN breakfast_recipe_id INTEGER;
ALTER TABLE meals ADD COLUMN lunch_recipe_id INTEGER;
```

**API routes:**
- `PUT /api/meals/:day` — extend existing route to accept `{ dinner_recipe_id, breakfast_recipe_id, lunch_recipe_id }` alongside existing fields
- `POST /api/grocery/from-meals` → `{ days[] }` — accepts array of day names, looks up their linked recipe IDs, parses ingredients from each recipe, de-dupes against current grocery list, bulk-inserts new items. Returns `{ added: N, skipped: N }`.

**UI changes:**
- Meal planner (in GroceryScreen): small recipe-link icon on each slot. Tapping opens recipe picker modal.
- "Add week's ingredients to list" button at top of meal plan section — sends all 7 days of linked recipes to grocery. Shows "Added 14 items, 3 already on list."
- Individual day "→ List" button also available per-day.

**Edge cases:**
- Recipe has no ingredients → skip that recipe, count it in "skipped"
- Ingredient already on unchecked list → de-dupe, don't add duplicate
- Recipe deleted after being linked → show "Recipe removed" label on the slot, clear the link

---

## Out of scope (for now)

- **Automatic sensor-based tracking** — requires physical hardware (IoT sensors). Not buildable in software alone.
- **Full inventory with QR codes / serial numbers / photos** — Homebox territory, too much scope for a family dashboard.
- **Barcode scanning for groceries** — separate feature, separate sprint.
- **Low-stock alerts tied to grocery quantities** — could revisit if Grocery gets quantity tracking.
- **Contact syncing with phone/iCloud** — OS integration complexity, out of scope for web dashboard.

---

## SPRINT 4 — Done

- **Push reminders** — 9am daily cron sends push notification for consumables/maintenance/pets/vehicles due ≤7-14 days. `POST /api/reminders/test` for manual trigger.
- **Vehicle services in DisplayMode** — `dueSoonVehicles` now includes overdue. Added `w_home_maintenance` and `w_pets` DisplayMode panels (requires `maintenanceItems` and `pets` props passed from App).
- **Grocery quantities** — `qty TEXT` column on grocery table. Shown as small label above item name. Qty field in add form.
- **Bills due on Dashboard** — `billsDueSoon` widget on DashboardScreen showing bills within 7 days, sorted by days remaining. Requires `bills` and `payments` props passed through ManageMode.

---

## SPRINT 5 — Discoverability + Finance

### 13. Notes search
**Screen:** NotesScreen  
**What:** Search bar above notes list. Filters by title and content. Shown when there are >3 notes.  
**API:** No change — filter client-side on the already-loaded notes array.  
**UI:** `<Inp>` search bar at top of NotesScreen. Filtered notes shown inline, no separate results view. Clear button in search field.  
**Error guards:** None needed (client-side only).

---

### 14. Budget tracker
**Screen:** BillsScreen (new "Budget" tab) or a new BudgetScreen added to nav after Bills  
**What:** Monthly budget by category with actual spending tracked. Not a full accounting app — just "I budget $200 for Groceries, here's what I've logged this month." Manual entry of spending + summary vs. budget.

**DB — new table:**
```sql
CREATE TABLE IF NOT EXISTS budget_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  monthly_budget REAL DEFAULT 0,
  color TEXT DEFAULT '#3B82F6',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budget_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  note TEXT DEFAULT '',
  date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**API routes:**
- `GET /api/budget` → `{ categories: [...], entries: [...month's entries] }`
- `POST /api/budget/categories` → `{ name, monthly_budget, color }`
- `PUT /api/budget/categories/:id`
- `DELETE /api/budget/categories/:id`
- `POST /api/budget/entries` → `{ category_id, amount, note, date }`
- `DELETE /api/budget/entries/:id`

**UI:**
- Category list showing budget vs. spent for current month with a progress bar (green/amber/red)
- "Add spending" quick form: amount + category + note
- Monthly total bar at top: total budget vs. total spent
- Tap category → see entries for that category this month

**DisplayMode:** No panel — budget is private financial data, not a wall display item.

**Integration note:** For future financial integration, design this to accept external entries (from CSV import or webhook). The `budget_entries` table should stay simple enough to bulk-import from any source.

---

### 15. Vehicle mileage log
**Screen:** VehiclesScreen — add a "Log miles" button per vehicle  
**What:** Simple odometer log. Each entry is a date + miles reading. Shows current odometer estimate and miles since last service. Closes the gap where service intervals say "every 5,000 miles" but there's no mileage tracking.

**DB — new table:**
```sql
CREATE TABLE IF NOT EXISTS vehicle_mileage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  miles INTEGER NOT NULL,
  date TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
```

**API routes:**
- `GET /api/vehicles/:id/mileage` → entries sorted by date desc
- `POST /api/vehicles/:id/mileage` → `{ miles, date, note }`
- `DELETE /api/vehicles/:id/mileage/:mid`

**Computed:**
- `current_miles` = latest mileage entry
- `miles_since_service` = current_miles - last_done_miles (already stored on vehicle_services)

**UI:**
- Per vehicle: current odometer shown on vehicle card header
- "Log miles" button opens a quick form (miles + date)
- Mileage log expandable below service records
- On service records with `interval_miles > 0`: show "X miles until next service" using `current_miles`

---

### 16. Global search
**Screen:** ManageMode nav — magnifying glass icon in the top bar  
**What:** One search input that queries notes (title + content), contacts (name + role + phone), recipes (name), and chores (name). Results grouped by type. Tapping a result navigates to the relevant screen.  
**API:** No new routes — all data already loaded in App state.  
**UI:** Search bar accessible via button in ManageMode header. Shows results grouped: Notes / Contacts / Recipes / Chores. Max 5 per group. Keyboard shortcut ⌘K (desktop).  
**Error guards:** Min 2 chars before search runs to avoid full-list flash.

---

### 17. Chore history
**Screen:** ChoresScreen — "History" tab alongside existing chore list  
**What:** The `chore_completions` table already exists and is populated on every chore completion. Surface it as a per-chore history view and a recent activity feed.

**API routes (new):**
- `GET /api/chores/history?limit=50` → last N completions joined with chore name and member name, sorted by completed_at desc
- `GET /api/chores/:id/history` → completions for a specific chore

**UI:**
- "History" tab in ChoresScreen alongside "Active" and "Done"
- Recent completions feed: date + chore name + member name + points
- Tap a chore row → expandable history inline showing last 5 completions
- Stats line at top: total completions this week/month

---

## SPRINT 6 — Financial + UX polish

### 18. Budget CSV import
**Screen:** BudgetScreen — "Import CSV" button  
**What:** Upload a bank or credit card CSV export and map columns to budget entries. Supports common formats (Chase, BofA, AMEX) with auto-detection, plus a generic fallback.

**How it works:**
1. User uploads CSV file via file input
2. Server parses the CSV and returns column headers + first 5 rows for preview
3. User maps columns: Date, Description (→ note), Amount, (optionally Category)
4. User confirms → server creates `budget_entries` rows for current month entries only

**API routes:**
- `POST /api/budget/import/preview` — multipart file upload, returns `{ headers: [...], sample: [[...]] }`
- `POST /api/budget/import/confirm` — `{ rows: [{date, note, amount, category_id}] }` → bulk-inserts, returns `{ imported: N }`

**Auto-detection rules:**
- Chase: columns `Transaction Date`, `Description`, `Amount` (negative = debit, positive = credit — import only debits as spending)
- BofA: columns `Date`, `Description`, `Amount`
- AMEX: columns `Date`, `Description`, `Amount`
- Generic: first date-like column, first text column, first numeric column

**UI:**
- "Import CSV" button in BudgetScreen header
- Upload → preview table showing mapped rows with amount + note + date
- Category selector applied to all imported rows (user picks which budget category they map to)
- "Import N entries" confirm button → toast "Imported N entries"

**Error guards:** Non-CSV file rejected. Amount must parse as number. Date must be parseable. Skip rows with empty date or amount.

---

### 19. Recipe search
**Screen:** RecipesScreen  
**What:** Search bar above recipe list, same pattern as NotesScreen. Filters by name, description, and ingredients. Shown when >5 recipes.

**API:** No change — filter client-side on already-loaded recipes.

**UI:** `<Inp>` at top of RecipesScreen. Clear on empty. `filtered` list replaces full list when query is active.

---

### 20. Family member birthdays
**Screen:** FamilyScreen — add birthday field to member profile  
**What:** Store each member's birthday. Kith auto-creates a yearly recurring calendar event for it. Event is labeled "🎂 [Name]'s Birthday" with the member's color.

**DB — migration:**
```sql
ALTER TABLE family_members ADD COLUMN birthday TEXT DEFAULT '';
```

**Behavior:**
- On save/update of a member with a birthday: server checks if a birthday event already exists (`source='birthday'` + `member_id`) and upserts it as a yearly recurring event
- The event date is set to the birthday in the current year (or next year if already passed)
- `recurring_rule = 'yearly'`
- Source = 'birthday' so it won't appear in manual edit flows

**API change:** `PUT /api/members/:id` accepts `birthday` field; server handles event upsert server-side.

**UI:** Date input in FamilyScreen member edit form labeled "Birthday (optional)". If set, shows "Birthday: Month Day" on member card.

---

### 21. Grocery store mode
**Screen:** GroceryScreen — toggle button in the header  
**What:** Full-screen, high-contrast, large-text view of the unchecked grocery list optimized for in-store use. One item per row with a large tap target. Checking an item crosses it out and moves it to bottom. Exit button returns to normal view.

**API:** No change — same toggle endpoint.

**UI:**
- "Store" button in GroceryScreen header (next to existing controls)
- In store mode: full viewport, white background in light mode / black in dark, large font (22px item name), category sections, big tap-to-check target (full row height ≥ 64px)
- Checked items cross out and move to a "In cart" section at bottom with muted styling
- Fixed exit button at bottom right

---

### 22. iCal export feed
**Screen:** SettingsScreen — "Calendar" section  
**What:** A permanent URL that returns a valid `.ics` file of all Kith events, compatible with Google Calendar, Apple Calendar, and Outlook. Users can subscribe (not just download) so it stays synced.

**API route:**
- `GET /api/ics/export` — no auth required (URL acts as the secret). Returns `text/calendar` response with all non-deleted events serialized as VEVENT blocks.

**URL format:** `http://[kith-host]/api/ics/export?token=[webhook_token]` — uses existing `ha_webhook_secret` or a new dedicated `ics_export_token` setting.

**iCal fields per event:** `DTSTART`, `DTEND` (or `DATE` for all-day), `SUMMARY` (title), `DESCRIPTION` (notes), `UID` (event id + @kith), `DTSTAMP` (created_at).

**UI:**
- "Export calendar" card in SettingsScreen Calendar section
- Shows the feed URL with a copy button
- Note: "Add this URL to Google Calendar / Apple Calendar to subscribe"

---

## Build order — Sprint 6

| # | Feature | Effort | Value |
|---|---------|--------|-------|
| 19 | Recipe search | XS | M |
| 21 | Grocery store mode | S | M |
| 22 | iCal export | S | H |
| 20 | Family birthdays | S | M |
| 18 | Budget CSV import | M | H |

Sprint 6 = items 18–22. Suggested order: 19 → 21 → 22 → 20 → 18 (simplest first, CSV import last as it has the most server surface area).

---

## Build order — Sprint 5

| # | Feature | Effort | Value |
|---|---------|--------|-------|
| 13 | Notes search | XS | M |
| 14 | Budget tracker | M | H |
| 15 | Vehicle mileage log | S | H |
| 16 | Global search | M | H |
| 17 | Chore history | S | H |

Sprint 5 = items 13–17. Suggested order: 13 → 17 → 15 → 16 → 14 (simplest first, budget last because it's the most surface area).

---

## Prior build order (Sprints 1–3)

| # | Feature | Effort | Value |
|---|---------|--------|-------|
| 1 | Edit countdowns + Clear Past | S | M |
| 2 | Edit family members | S | M |
| 3 | Chore member assignment | M | H |
| 4 | Grocery category | S | M |
| 5 | DisplayMode quick actions | M | H |
| 6 | Home — Appliances | M | H |
| 7 | Home — Consumables | M | H |
| 8 | Add Home to nav | XS | — |
| 9 | Home — Seasonal Maintenance | M | H |
| 10 | Pets | M | H |
| 11 | Household Contacts | S | M |
| 12 | Meal plan → Grocery | M | H |

Sprint 1 = items 1–5 (all existing screens, no new tables except grocery category field)  
Sprint 2 = items 6–8 (new HomeScreen, two new tables, DisplayMode integration)  
Sprint 3 = items 9–12 (seasonal maintenance tab, pets screen, contacts screen, meal-grocery link)  

**Sprint 3 suggested order:** 11 → 12 → 9 → 10 (contacts and meal link first — no new screens for 12, smallest scope; maintenance and pets are bigger standalone screens)

---

## SPRINT 7 — Complete home management

### 23. Emergency info screen
**Screen:** New EmergencyScreen, accessible from nav + DisplayMode without PIN  
**What:** A single card with critical household info: utility shut-off locations, insurance details, emergency contacts, medical notes. Pin-free access from kiosk mode.

**DB:**
```sql
CREATE TABLE IF NOT EXISTS emergency_info (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);
```

**Predefined keys:** `gas_shutoff`, `water_shutoff`, `electric_shutoff`, `insurance_company`, `policy_number`, `insurance_phone`, `doctor_name`, `doctor_phone`, `medical_notes`, `extra_notes`

**API routes:**
- `GET /api/emergency` — returns all keys as `{ key: value }` object (auth required to write, read allowed in kiosk)
- `PUT /api/emergency` — `{ gas_shutoff: '...', water_shutoff: '...', ... }` — upserts all provided keys

**UI:**
- EmergencyScreen: two-column form grouped by section (Utilities / Insurance / Medical / Notes)
- Each field is a label + text input, editable inline with a single "Save" button
- DisplayMode: "Emergency" panel (only show if at least one field filled)
- Nav: add "Emergency" entry with a shield icon

---

### 24. Subscription tracker
**Screen:** New SubscriptionsScreen in nav  
**What:** Track recurring subscriptions (Netflix, Spotify, gym, software) separately from bills. Shows monthly total, annual cost, and flags trials expiring soon.

**DB:**
```sql
CREATE TABLE IF NOT EXISTS subscriptions (
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
);
```

**Billing cycles:** `monthly`, `annual`, `weekly`, `quarterly`

**Computed:**
- Monthly equivalent: amount / 12 for annual, amount * 52 / 12 for weekly, amount / 3 for quarterly
- Total monthly spend (all active)
- Annual total

**API routes:**
- `GET /api/subscriptions`
- `POST /api/subscriptions`
- `PUT /api/subscriptions/:id`
- `DELETE /api/subscriptions/:id`

**UI:**
- List sorted by amount desc, grouped by category
- Header: total monthly + annual cost
- Each row: name + amount + cycle + next billing date
- Trial expiring within 7 days → amber badge "Trial ends in Xd"
- Inactive subscriptions in a collapsed "Paused" section
- Add/edit drawer

---

### 25. Home repair log
**Screen:** HomeScreen — new "Repairs" tab (tab 4, alongside Appliances / Consumables / Maintenance)  
**What:** Log one-off repairs and improvements with cost and contractor info. Builds a searchable home history useful for resale documentation.

**DB:**
```sql
CREATE TABLE IF NOT EXISTS home_repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  date TEXT DEFAULT '',
  cost REAL DEFAULT 0,
  contractor TEXT DEFAULT '',
  category TEXT DEFAULT 'Other',
  warranty_until TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Categories:** Plumbing, Electrical, HVAC, Appliance, Structural, Exterior, Interior, Other

**API routes:**
- `GET /api/home/repairs`
- `POST /api/home/repairs`
- `PUT /api/home/repairs/:id`
- `DELETE /api/home/repairs/:id`

**UI:**
- List sorted by date desc
- Total spend summary at top (all time + this year)
- Each row: title + category + date + cost
- Expandable detail: description + contractor + warranty date
- Add/edit drawer: title, category, date, cost, contractor, warranty date, notes

---

### 26. Home projects board
**Screen:** New ProjectsScreen in nav  
**What:** Track one-off home projects that are too big for chores and not calendar-based. "Repaint garage", "Replace deck boards", "Finish basement".

**DB:**
```sql
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'planned',
  priority TEXT DEFAULT 'medium',
  cost_estimate REAL DEFAULT 0,
  cost_actual REAL DEFAULT 0,
  due_date TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Status:** `planned`, `in_progress`, `done`  
**Priority:** `low`, `medium`, `high`

**API routes:**
- `GET /api/projects`
- `POST /api/projects`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`

**UI:**
- Three columns (Planned / In Progress / Done) on desktop, tabs on mobile
- Each card: title + priority badge + cost estimate + due date
- Drag to change status (or tap status pill to cycle through)
- Add/edit drawer
- Done projects collapsible

---

### 27. Shared lists
**Screen:** New ListsScreen in nav  
**What:** Generic multi-purpose lists beyond grocery: hardware store run, pharmacy, things to return, packing list, etc.

**DB:**
```sql
CREATE TABLE IF NOT EXISTS shared_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '📋',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shared_list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  checked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**API routes:**
- `GET /api/lists` — all lists with item counts
- `POST /api/lists`
- `DELETE /api/lists/:id`
- `GET /api/lists/:id/items`
- `POST /api/lists/:id/items`
- `PUT /api/lists/:id/items/:iid` — toggle checked
- `DELETE /api/lists/:id/items/:iid`
- `DELETE /api/lists/:id/items/checked` — clear checked

**UI:**
- List of lists with item count + emoji
- Tap list → opens item view (same pattern as grocery)
- Per-list: add item input, check to cross off, clear checked button
- New list: name + emoji picker

---

### 28. Pantry tracker
**Screen:** New PantryScreen in nav  
**What:** Track what's in stock (fridge, freezer, pantry) with expiration dates and low-stock alerts. "Add to grocery" for low/expired items closes the loop.

**DB:**
```sql
CREATE TABLE IF NOT EXISTS pantry_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT DEFAULT 'Pantry',
  quantity REAL DEFAULT 1,
  unit TEXT DEFAULT '',
  expires_on TEXT DEFAULT '',
  low_stock_at REAL DEFAULT 0,
  category TEXT DEFAULT 'Other',
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Locations:** Fridge, Freezer, Pantry, Cabinet  
**Computed per item:**
- `days_until_expiry` = expires_on - today
- `expiry_status` = 'expired' (<0) | 'expiring_soon' (0-3) | 'ok'
- `low_stock` = quantity <= low_stock_at (when low_stock_at > 0)

**API routes:**
- `GET /api/pantry` — items with computed fields, sorted by expiry asc then name
- `POST /api/pantry`
- `PUT /api/pantry/:id`
- `DELETE /api/pantry/:id`
- `POST /api/pantry/:id/use` — decrement quantity by 1 (or custom amount)
- `POST /api/pantry/add-to-grocery` — `{ ids: [...] }` — adds named items to grocery list

**UI:**
- Grouped by location with section headers
- Item row: name + qty + expiry badge (red/amber) + Use button
- Low stock items get an amber "Low" badge
- "Add expired/low to grocery" bulk action at top
- Add/edit drawer: name, location, qty, unit, expiry date, low-stock threshold

---

### 29. Family health profiles
**Screen:** FamilyScreen — new "Health" tab per member  
**What:** Per-member health data: blood type, allergies, medications, conditions, primary doctor. Critical for emergencies and medical appointments.

**DB:**
```sql
CREATE TABLE IF NOT EXISTS member_health (
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
);
```

**API routes:**
- `GET /api/members/:id/health`
- `PUT /api/members/:id/health` — upserts full record

**UI:**
- In FamilyScreen, each member card gets a "Health" button/tab
- Expanding health section: blood type (dropdown A/B/AB/O ±), allergies (textarea), medications (textarea), conditions (textarea), doctor info, insurance
- Single "Save" button per member health record
- Read-only display on member card: blood type pill + allergy count if set

---

### 30. School schedule
**Screen:** New SchoolScreen in nav  
**What:** Track school schedules, class periods, teacher contacts, and the school year calendar. Useful for families with kids in school.

**DB:**
```sql
CREATE TABLE IF NOT EXISTS school_members (
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
);

CREATE TABLE IF NOT EXISTS school_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_member_id INTEGER NOT NULL,
  period TEXT DEFAULT '',
  subject TEXT NOT NULL,
  teacher TEXT DEFAULT '',
  room TEXT DEFAULT '',
  days TEXT DEFAULT 'Mon,Tue,Wed,Thu,Fri',
  created_at TEXT DEFAULT (datetime('now'))
);
```

**API routes:**
- `GET /api/school` — all school members with their classes
- `POST /api/school`
- `PUT /api/school/:id`
- `DELETE /api/school/:id`
- `POST /api/school/:id/classes`
- `PUT /api/school/:id/classes/:cid`
- `DELETE /api/school/:id/classes/:cid`

**UI:**
- One card per enrolled family member showing school name + grade + hours
- Expandable class schedule (period grid or list)
- Add/edit drawer for school info
- Add/edit classes via nested drawer
- Teacher contact info tap-to-call on mobile

---

## Build order — Sprint 7

| # | Feature | Effort | Value |
|---|---------|--------|-------|
| 23 | Emergency info | XS | H |
| 24 | Subscription tracker | S | H |
| 25 | Home repair log | S | H |
| 26 | Home projects board | S | H |
| 27 | Shared lists | S | M |
| 28 | Pantry tracker | M | H |
| 29 | Family health profiles | S | H |
| 30 | School schedule | S | M |

Sprint 7 = items 23–30. Build order: 23 → 24 → 25 → 29 → 27 → 26 → 28 → 30
