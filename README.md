# Hearth

Self-hosted family dashboard. Replaces Skylight Calendar + Donetick.

**Features:** Calendar (Google + ICS/webcal), chores with recurrence, grocery list, meal planner, email inbox for event parsing, TV display mode, PIN-based auth, browser push notifications.

## Install

SSH into your Proxmox server or any machine running Docker, then run:

```bash
git clone https://github.com/MJFlanigan5/hearth.git /opt/hearth && cd /opt/hearth && bash deploy.sh
```

Open `http://<server-ip>:7400`

On first load you'll be prompted to create an admin PIN. From Settings you can then set PINs for each family member.

## Update

```bash
cd /opt/hearth && bash deploy.sh
```

Pulls latest code, rebuilds the container, and resyncs the Cloudflare email worker automatically.

## Data

SQLite at `/data/hearth.db` inside the container, persisted in a Docker volume. Data survives rebuilds.

**Backup:**
```bash
docker compose -f /opt/hearth/docker-compose.yml exec hearth sqlite3 /data/hearth.db ".backup /tmp/hearth-backup.db"
docker cp $(docker compose -f /opt/hearth/docker-compose.yml ps -q hearth):/tmp/hearth-backup.db ./hearth-backup.db
```

## ICS Calendars

Settings → ICS Calendars → paste any `webcal://` or `https://` `.ics` URL.
Works with Google Calendar, iCloud, Outlook, Fastmail, etc.

## Email Inbox

Forward any calendar invite or event email to `hearth@mjflanigan.com`.
Hearth parses the event and drops it in the inbox for approval.

## Push Notifications

Settings → Push Notifications → Enable Notifications.
Reminders fire at 8am for due chores and 30 minutes before calendar events.
Requires HTTPS for non-localhost devices.

## Ports

| Port | Service |
|------|---------|
| 7400 | Hearth web UI |
