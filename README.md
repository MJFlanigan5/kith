# Hearth

Self-hosted family dashboard. Runs in Docker. Replaces Skylight Calendar + Donetick.

**Features:** Calendar (Google + ICS/webcal), chores with recurrence, grocery list, meal planner, email inbox for event parsing, TV display mode, browser push notifications.

## Install on Proxmox (or any Docker host)

```bash
git clone https://github.com/MJFlanigan5/hearth.git
cd hearth
docker compose up -d
```

Open `http://<your-server-ip>:7400`

## Update

```bash
cd hearth
git pull
docker compose up -d --build
```

## One-liner (no clone)

```bash
docker run -d \
  --name hearth \
  --restart unless-stopped \
  -p 7400:7400 \
  -v hearth-data:/data \
  ghcr.io/mjflanigan5/hearth:latest
```

*(Push to GHCR first — see below if you want to build and push the image.)*

## Data

All data is stored in a SQLite database in the `/data` volume. Back it up with:

```bash
docker cp hearth:/data/hearth.db ./hearth-backup.db
```

## ICS Calendars

In Settings → ICS Calendars, paste any `webcal://` or `https://` `.ics` URL.  
Works with Google Calendar's "Secret address in iCal format", iCloud, Outlook, Fastmail, etc.

## Push Notifications

Click **Enable Notifications** in Settings → Push Notifications.  
Reminders: due chores at 8am, events 30 minutes before start.  
Push requires HTTPS for non-localhost access. Front with nginx + a self-signed cert for local network use.

## Ports

| Port | Service |
|------|---------|
| 7400 | Hearth web UI |
