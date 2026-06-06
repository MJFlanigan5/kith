# Kith — Complete Guide

Kith is a self-hosted family dashboard that runs on any machine with Docker. It's designed to live on a wall-mounted TV or tablet and be used by every member of a household — but it also works great as a personal home screen on desktop or mobile.

Everything runs locally. Your data never leaves your server.

---

## Table of Contents

1. [What's included](#whats-included)
2. [Installation](#installation)
3. [First-time setup](#first-time-setup)
4. [Calendar](#calendar)
5. [Chores](#chores)
6. [Grocery list](#grocery-list)
7. [Meal planner](#meal-planner)
8. [Packages](#packages)
9. [Family](#family)
10. [Display mode](#display-mode)
11. [Email integration](#email-integration)
12. [Push notifications](#push-notifications)
13. [Home Assistant](#home-assistant)
14. [Homey](#homey)
15. [Widgets](#widgets)
16. [Backup and restore](#backup-and-restore)
17. [Updating](#updating)

---

## What's included

**Core household tools**
- Calendar with recurring events, ICS sync (Google, iCloud, Outlook), and color-coded family members
- Chores with recurrence schedules, points, streaks, and a leaderboard
- Weekly meal planner
- Grocery list with categories and quick-add history
- Package tracking — auto-detected from shipping emails
- Countdowns to upcoming events
- Shared notes and household polls
- Ephemeral messages (auto-expire)
- Bookmarks

**Display mode** (for wall screens and Fire tablets)
- Full-screen clock, weather, calendar, chores, photos
- Automatic night mode
- Auto-rotating widget panels

**Email integration**
- AI parses forwarded emails into calendar events (Inbox)
- Automatically detects shipping emails and creates package entries
- Two setup paths: Gmail IMAP polling (easiest) or Cloudflare Email Worker (instant, no credentials)
- PDF and image import — upload a photo of a flyer and Kith extracts the event

**Smart home**
- Home Assistant — presence detection, climate, media, sensors, Moen water monitor, UniFi network
- Homey — presence detection and device events

**Notification and reminders**
- Daily morning summary email (via Resend)
- Weekly digest email
- Browser push notifications for chores and calendar events

**Widgets**
- Weather (Open-Meteo, no API key needed)
- Sports scores (NFL, NBA, MLB, NHL, and more)
- News headlines (any RSS feed)
- Music — Last.fm now-playing
- Stocks
- GitHub activity
- Reddit
- Product Hunt
- Beehiiv newsletter stats
- YouTube channel stats
- Etsy shop stats
- UniFi network clients and traffic
- Moen water flow and pressure
- Tesla battery and range (via Teslemetry)
- NextDNS query stats
- Plex sessions
- Beszel system monitor
- WiFi QR code

---

## Installation

You need a machine running Docker — a Raspberry Pi, a home server, a VPS, or any Linux box works.

```bash
git clone https://github.com/MJFlanigan5/kith.git /opt/kith
cd /opt/kith
bash deploy.sh
```

Open `http://<your-server-ip>:7400` in a browser.

> **No Docker Compose?** Install it: `sudo apt install docker-compose-plugin` on Ubuntu/Debian.

---

## First-time setup

When you open Kith for the first time, the setup wizard walks you through:

1. **Location** — used for weather
2. **Family members** — add everyone in the household with a name, color, and optional PIN
3. **Admin PIN** — protects settings and write actions

After setup, anyone can view the dashboard. Write actions (adding events, completing chores, etc.) require a PIN if you've set one for that family member.

---

## Calendar

The calendar shows events in month, week, and day views plus an agenda list.

**Adding events manually**

Tap any day or use the + button. You can set:
- Title, date, start and end time
- Calendar (personal, work, family, or kith)
- Which family member it belongs to
- Recurrence (daily, weekly, bi-weekly, monthly, yearly, weekdays)

**Syncing external calendars (ICS)**

Settings → ICS Calendars → Add. Paste any `.ics` URL:

- Google Calendar: open your calendar → three dots → Settings → Scroll to "Secret address in iCal format"
- iCloud: open iCloud.com → Calendar → Share → copy the private URL
- Outlook: Calendar → right-click → Share → copy the ICS link
- Any service that exports `.ics` works, including Sonarr, Radarr, and Fastmail

ICS sources sync automatically every hour. You can force a sync from Settings.

**Package delivery events**

If you have package tracking set up, expected delivery dates automatically appear on the calendar in brown. Tapping one shows the carrier and tracking number. Edit or delete the package from the Packages section.

---

## Chores

Chores repeats on whatever schedule you set and tracks who's keeping up.

**Adding a chore**

Tap + and set:
- Name
- Recurrence (daily, every N days, weekly, bi-weekly, monthly)
- Point value
- Which family member it's assigned to (optional)

**Completing a chore**

Anyone can mark a chore done by tapping it and selecting their name. Each completion is logged with who did it and when.

**Points and leaderboard**

Every completion earns points. The Family screen shows a leaderboard and each member's monthly total. You can set a monthly goal per member.

**Streaks**

Chores track consecutive completion streaks. Streak counts appear on the chore card.

---

## Grocery list

The grocery list groups items by category and remembers what you buy.

**Adding items**

Type an item name and category in the quick-add bar at the top. Kith remembers items you've added before and autocompletes them the next time.

**Checking off items**

Tap any item to check it. Checked items stay visible until you tap "Clear checked."

**Categories**

Default categories: Produce, Dairy, Meat, Bakery, Frozen, Pantry, Beverages, Snacks, Household, Personal Care, Other. You can type any category when adding an item.

---

## Meal planner

A simple weekly grid — Monday through Sunday — where you fill in what you're making each day. Tap any day to type a meal name. Changes save automatically.

---

## Packages

Kith tracks packages in transit and shows expected delivery dates on the calendar.

**Automatic detection (recommended)**

Set up one of the email integrations below. Kith's AI reads shipping confirmation emails from UPS, FedEx, USPS, Amazon, and most carriers, then creates a package entry automatically with the carrier, tracking number, and expected delivery date.

**Adding manually**

Packages → tap + → fill in carrier, tracking number, description, and expected date.

**Marking delivered**

Tap a package and select "Mark delivered." Delivered packages are removed after 3 days.

---

## Family

The Family screen shows each household member's photo or avatar, their chore points this month, current streak, and monthly goal progress.

**Adding members**

Settings → Family → Add member. Set name, color, and an optional PIN.

**PINs**

Each member can have their own PIN. When completing a chore or taking an action, the app asks for the member's PIN before recording it under their name. This prevents one person from marking chores done on behalf of someone else.

**Admin PIN**

The admin PIN protects Settings, event creation/editing, and other write actions. Set it during first-time setup or in Settings → Security.

---

## Display mode

Display mode is designed for a TV or wall-mounted tablet. It shows a full-screen layout with a large clock, weather, today's events, upcoming chores, and rotating widget panels.

**Entering display mode**

Tap the TV icon in the bottom navigation bar.

**Photo carousel**

Upload family photos in Settings → Photos. They rotate through as the background in display mode.

**Night mode**

Display mode automatically dims the screen between your configured night start and end times (default: 11pm–6am). Set times in Settings → Display.

**Fire tablet / Fully Kiosk Browser**

Kith works well as a kiosk on Amazon Fire tablets. Install Fully Kiosk Browser, set the start URL to your Kith address, and enable "Keep Screen On."

**Quick actions**

Settings → Quick Actions → add one-tap buttons that appear in display mode. Useful for things like "add item to grocery list" or "mark chore done."

---

## Email integration

Email integration lets Kith read shipping and calendar emails automatically. There are three setup paths — use the one that fits your situation.

### Option A: Gmail IMAP polling (easiest)

Kith polls your Gmail inbox every 15 minutes and picks up shipping emails automatically. Works with any IMAP-compatible mailbox (Gmail, Outlook, iCloud, Fastmail, etc.).

**Gmail setup:**

1. Enable 2-step verification on your Google account at [myaccount.google.com/security](https://myaccount.google.com/security)
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Create an app password called "Kith" — Google gives you a 16-character password
4. In Kith: Settings → Gmail Polling → enter your Gmail address and the app password → Test → Save → check "Enable polling"

**Other IMAP providers:**

The same settings work for non-Gmail mailboxes. Common IMAP settings:
| Provider | Host | Port |
|---|---|---|
| Gmail | imap.gmail.com | 993 |
| Outlook / Hotmail | outlook.office365.com | 993 |
| iCloud | imap.mail.me.com | 993 |
| Fastmail | imap.fastmail.com | 993 |
| Yahoo | imap.mail.yahoo.com | 993 |

### Option B: Cloudflare Email Worker (instant, no app password)

If your domain's DNS is on Cloudflare, you can route emails through a Worker that forwards them to Kith in real time — no polling delay, no credentials stored.

**Requirements:** A domain managed on Cloudflare (free plan works). You don't need Cloudflare paid.

**Setup:**

1. In Cloudflare: Email → Email Routing → enable for your domain
2. Add a catch-all rule that routes to a Worker

3. Deploy the included Worker:
```bash
cd /opt/kith/email-worker
npm install
# Edit wrangler.toml — set KITH_URL to your server's public URL
npx wrangler secret put KITH_WEBHOOK_SECRET
# Enter the webhook secret shown in Kith Settings → Email Forwarding
npx wrangler deploy
```

4. In Cloudflare Email Routing, point your catch-all address to the Worker you just deployed

Now any email sent to your domain (e.g. `kith@yourdomain.com`) is forwarded to Kith instantly.

### Option C: Webhook forwarding (Postmark, Zapier, Make, etc.)

Any service that can POST email content as JSON works with Kith's webhook endpoint.

- **Endpoint:** `https://your-kith-url/api/email/inbound`
- **Method:** POST
- **Headers:** `Content-Type: application/json`, `x-kith-secret: <your secret>`
- **Body:**
```json
{
  "subject": "Your order has shipped",
  "from": "shipping@amazon.com",
  "body": "Full email body text..."
}
```

The webhook secret is shown in Settings → Email Forwarding. Any service that doesn't send it is rejected.

### AI email parsing

Kith uses AI to extract event details and shipping info from email text. Set up an API key in Settings → AI Email Parsing:

- **Google Gemini** — free tier available at [aistudio.google.com](https://aistudio.google.com)
- **Anthropic Claude** — [console.anthropic.com](https://console.anthropic.com)
- **OpenAI** — [platform.openai.com](https://platform.openai.com)
- **Groq** — fast and free at [console.groq.com](https://console.groq.com)
- **DeepSeek** — cost-optimized at [platform.deepseek.com](https://platform.deepseek.com)

ICS calendar attachments are parsed without an AI key. AI is only needed for plain-text email parsing.

### Email inbox and approval

Emails detected as calendar events go to the Inbox for review before being added to the calendar. You can accept, edit, or dismiss each one. This prevents junk from cluttering your calendar.

Shipping emails skip the inbox and create package entries directly.

### PDF and image import

In the Inbox screen, tap "Upload Image or PDF" to import an event from a flyer, screenshot, or document. Kith extracts the event details using your configured AI provider and queues it for review.

### Email reminders

Kith can send a daily morning summary and a weekly digest using [Resend](https://resend.com) (free tier: 100 emails/day).

1. Create a free account at resend.com and verify your sending domain
2. Generate an API key
3. Settings → Email Reminders → enter API key, from address, and your email address
4. Toggle on Daily Summary and/or Weekly Digest

---

## Push notifications

Settings → Push Notifications → Enable Notifications.

Notifications fire for:
- Chores due today (8am)
- Calendar events (30 minutes before)
- Family member arrivals (if Home Assistant or Homey presence is set up)

**Requires HTTPS** for any device other than localhost. If you're accessing Kith over your local network by IP address, push notifications will only work on the device running the server. Put Kith behind a reverse proxy with a TLS certificate (Nginx Proxy Manager, Caddy, or Cloudflare Tunnel) for push to work on all devices.

---

## Home Assistant

Settings → Smart Home → Home Assistant. Enter your HA URL and a Long-Lived Access Token.

After connecting, tap "Discover entities" to map your HA entities to Kith features:

| Kith feature | What to map |
|---|---|
| Who's home | `person.*` entities |
| Climate | A `climate.*` entity |
| Now playing | A `media_player.*` entity |
| Sensors | Any `sensor.*` entities |
| Moen water | Flow, pressure, daily usage, mode, and alert sensors |
| UniFi | Client count, RX/TX traffic sensors |

**Presence detection**

Map your `person.*` entities to family members. When a person's state changes to `home`, Kith broadcasts an arrival notification and updates the "Who's home" display.

**HA → Kith webhook**

Kith also exposes a webhook that HA can call: `POST /api/webhook/ha`. The webhook secret is in Settings → Smart Home. Use it to push events or trigger display updates from HA automations.

---

## Homey

Settings → Smart Home → Homey. Enter your Homey URL and API token.

Kith connects to Homey's real-time socket and listens for presence events. When a family member's presence device changes to "present," Kith shows an arrival notification and updates the Who's Home panel.

Map Homey person device IDs to family members in Settings → Smart Home → Homey Person Entities (comma-separated device IDs).

---

## Widgets

Most widgets can be enabled and configured in Settings. Some require API keys; others work out of the box.

| Widget | Requires | Notes |
|---|---|---|
| Weather | Nothing | Powered by Open-Meteo. Set your city or coordinates in Settings. |
| Sports scores | Nothing | Choose leagues in Settings → Sports. |
| News | Nothing | Paste any RSS feed URL in Settings → News. |
| Last.fm | Last.fm API key + username | Shows current track and recent plays. |
| Stocks | Nothing | Enter comma-separated tickers in Settings. |
| GitHub | GitHub username | Shows recent push activity. |
| Reddit | Subreddit name | Shows top posts from any subreddit. |
| Product Hunt | Nothing | Top products of the day. |
| Beehiiv | Beehiiv API key | Newsletter subscriber stats. |
| YouTube | YouTube Data API key + channel handle | Subscriber and view counts. |
| Etsy | Etsy API key | Shop listing and review stats. |
| UniFi | UniFi Controller URL + credentials | Active clients and traffic via Home Assistant. |
| Moen | Moen account credentials | Water flow, pressure, daily usage via Home Assistant. |
| Tesla | Teslemetry API key | Battery level, range, charge status. |
| NextDNS | NextDNS API key + profile ID | DNS query stats and block rates. |
| Plex | Plex token + server URL | Active sessions. |
| Beszel | Beszel URL + API key | CPU, memory, disk for monitored hosts. |
| WiFi QR code | WiFi SSID + password | Generates a scannable QR code for guests. |

---

## Backup and restore

**Backup**

```bash
docker compose -f /opt/kith/docker-compose.yml exec kith \
  sqlite3 /data/kith.db ".backup /tmp/kith-backup.db"

docker cp \
  $(docker compose -f /opt/kith/docker-compose.yml ps -q kith):/tmp/kith-backup.db \
  ./kith-backup.db
```

**Restore**

```bash
docker cp ./kith-backup.db \
  $(docker compose -f /opt/kith/docker-compose.yml ps -q kith):/data/kith.db
docker compose -f /opt/kith/docker-compose.yml restart kith
```

**Automated backups**

Add a cron job on the host to run the backup command daily and copy the file to a safe location:

```bash
# /etc/cron.daily/kith-backup
#!/bin/bash
docker compose -f /opt/kith/docker-compose.yml exec -T kith \
  sqlite3 /data/kith.db ".backup /tmp/kith-backup.db"
docker cp \
  $(docker compose -f /opt/kith/docker-compose.yml ps -q kith):/tmp/kith-backup.db \
  /mnt/backup/kith-$(date +%Y%m%d).db
```

---

## Updating

```bash
cd /opt/kith && git pull && docker compose build --no-cache && docker compose up -d
```

Your data is in a Docker volume and is not affected by updates. Settings, family members, events, chores, and all other data persist across every rebuild.

---

## Ports

| Port | Service |
|---|---|
| 7400 | Kith web UI |

To access Kith from outside your local network, put it behind a reverse proxy (Nginx, Caddy, or Traefik) with a TLS certificate, or use Cloudflare Tunnel for zero-config HTTPS.

---

## Running without Docker

If you'd rather run Kith directly:

```bash
git clone https://github.com/MJFlanigan5/kith.git
cd kith
npm install
npm run build
node server.js
```

Set `PORT` (default 7400) and `DATA_DIR` (default `./data`) as environment variables if needed.
