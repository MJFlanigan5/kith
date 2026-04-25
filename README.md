# Hearth

Self-hosted family dashboard. Replaces Skylight Calendar + Donetick.

**Features:** Calendar (Google + ICS/webcal), chores with recurrence, grocery list, meal planner, email inbox for event parsing, TV display mode, browser push notifications.

## Install on Proxmox — LXC (recommended)

Run this on your Proxmox host. Creates a Debian 13 LXC with 1 CPU / 512 MB RAM / 2 GB disk.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/MJFlanigan5/hearth/main/ct/hearth.sh)
```

Open `http://<lxc-ip>:7400`

### Update (LXC)

From the Proxmox host, run the same script and choose **Update** when prompted, or exec into the container and run:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/MJFlanigan5/hearth/main/ct/hearth.sh)
```

## Install with Docker

```bash
git clone https://github.com/MJFlanigan5/hearth.git
cd hearth
docker compose up -d
```

### One-liner

```bash
docker run -d \
  --name hearth \
  --restart unless-stopped \
  -p 7400:7400 \
  -v hearth-data:/data \
  ghcr.io/mjflanigan5/hearth:latest
```

### Update (Docker)

```bash
cd hearth && git pull && docker compose up -d --build
```

## Data

All data is stored in a SQLite database at `/data/hearth.db`.

**LXC backup:**
```bash
# From the Proxmox host
pct exec <vmid> -- sqlite3 /data/hearth.db ".backup /tmp/hearth-backup.db"
pct pull <vmid> /tmp/hearth-backup.db ./hearth-backup.db
```

**Docker backup:**
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
