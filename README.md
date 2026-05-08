# Kith

Self-hosted family dashboard. Calendar, chores, meals, grocery list, and a TV display mode for wall screens.

**Features:** Google/iCloud/ICS calendar sync, recurring chores with points leaderboard, grocery list, meal planner, AI email inbox for event parsing, full-screen display mode, PIN auth, browser push notifications, weather, sports scores, news feed.

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

Settings → ICS Calendars → paste any `webcal://` or `https://` `.ics` URL. Works with Google Calendar, iCloud, Outlook, Fastmail, and any standard calendar source.

## Email Inbox

Configure a forwarding address in Settings → Email. Forward calendar invites or event emails to that address and Kith drops them in an inbox for your review and approval. Requires a Cloudflare Email Worker or any webhook-compatible email router.

Optional: add an Anthropic or Gemini API key in Settings to enable AI parsing of unstructured event emails.

## Push Notifications

Settings → Push Notifications → Enable Notifications. Reminders fire at 8am for due chores and 30 minutes before calendar events. Requires HTTPS for non-localhost devices.

## Display Mode

Click the TV icon to enter full-screen display mode — designed for wall-mounted screens and Amazon Fire tablets running Fully Kiosk Browser. Shows clock, weather, upcoming events, chores, and a photo carousel.

## Ports

| Port | Service |
|------|---------|
| 7400 | Kith web UI |
