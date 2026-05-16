# Kith

Self-hosted family dashboard. Calendar, chores, meals, grocery list, and a TV display mode for wall screens.

**Features:** Google/iCloud/ICS calendar sync, recurring chores with points leaderboard, grocery list, meal planner, AI email inbox for event parsing, PDF/image event import, email reminders via Resend, full-screen display mode, PIN auth, browser push notifications, weather.

## Install

SSH into any machine running Docker:

```bash
git clone https://github.com/MJFlanigan5/hearth.git /opt/kith && cd /opt/kith && bash deploy.sh
```

Open `http://<server-ip>:7400`. On first load you'll be prompted to create an admin PIN. Set family member PINs from Settings.

## Update

```bash
cd /opt/kith && git pull && docker compose build --no-cache && docker compose up -d
```

Data is preserved — the SQLite volume is not touched during rebuilds.

## Data

SQLite at `/data/kith.db` inside the container, persisted in a Docker volume. Data survives rebuilds.

**Backup:**
```bash
docker compose -f /opt/kith/docker-compose.yml exec kith sqlite3 /data/kith.db ".backup /tmp/kith-backup.db"
docker cp $(docker compose -f /opt/kith/docker-compose.yml ps -q kith):/tmp/kith-backup.db ./kith-backup.db
```

## ICS Calendars

Settings → ICS Calendars → paste any `webcal://` or `https://` `.ics` URL. Works with Google Calendar, iCloud, Outlook, Fastmail, and any standard calendar source. Sonarr and Radarr also expose ICS feeds you can subscribe to.

## Email Inbox

Forward calendar invites or event emails to a custom address and Kith parses them into an inbox for approval. Setup takes about 15 minutes and requires a domain on Cloudflare (free).

**1. Enable Cloudflare Email Routing**

In your Cloudflare dashboard → Email → Email Routing → enable for your domain. Add a catch-all rule that routes to a Worker (you'll create the Worker next).

**2. Deploy the email Worker**

```bash
cd /opt/kith/email-worker
# Edit wrangler.toml — set KITH_URL to your server's public URL
npm install
npx wrangler secret put KITH_WEBHOOK_SECRET   # enter any random string
npx wrangler deploy
```

**3. Configure Kith**

Settings → Email → set:
- **Forwarding address** — the email address you'll forward from (e.g. `you@yourdomain.com`)
- **Webhook secret** — same random string you used in step 2

**4. Forward an email**

Forward any calendar invite to your forwarding address. It will appear in Kith's inbox within seconds, ready to accept or dismiss.

Optional: add an Anthropic or Gemini API key in Settings → AI to enable AI parsing of plain-text event emails (ICS attachments are parsed without an AI key).

## PDF & Image Import

In the Inbox screen, use the **Upload Image or PDF** button to import events from flyers, schedules, or screenshots. Kith uses your configured AI provider to extract event details and queues them for review.

## Email Reminders

Kith can send a daily morning summary and a weekly digest using [Resend](https://resend.com) (free tier: 100 emails/day).

**Setup:**

1. Create a free account at [resend.com](https://resend.com) and verify your sending domain
2. Generate an API key
3. In Kith: Settings → Email Reminders → enter your API key, from address, and recipient address
4. Set your preferred send time and toggle Daily Summary and/or Weekly Digest on
5. Add your app's public URL (e.g. `https://kith.yourdomain.com`) to enable unsubscribe links

Emails include an unsubscribe link. Reminders are skipped on days with nothing scheduled.

## Push Notifications

Settings → Push Notifications → Enable Notifications. Reminders fire at 8am for due chores and 30 minutes before calendar events. Requires HTTPS for non-localhost devices.

## Display Mode

Click the TV icon to enter full-screen display mode — designed for wall-mounted screens and Amazon Fire tablets running Fully Kiosk Browser. Shows clock, weather, upcoming events, chores, and a photo carousel.

## Ports

| Port | Service |
|------|---------|
| 7400 | Kith web UI |
