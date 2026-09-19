# Ubuntu deployment

Production: https://medicine-ludo.jaindu.me on `ubuntu@169.58.129.250`.

The app uses one Node.js process, Express, native WebSockets, and SQLite in WAL
mode. Nginx terminates TLS. No Cloudflare compute or database services are needed;
Cloudflare is only the DNS provider, with this record set to DNS-only.

## Files and services

- Checkout: `/home/ubuntu/medicine-ludo`
- Node: `/home/ubuntu/.nvm/versions/node/v24.19.0/bin/node`
- Secrets: `/etc/medicine-ludo.env` (root-only, loaded by systemd)
- Database: `/var/lib/medicine-ludo/medicine-ludo.sqlite`
- Backups: `/var/lib/medicine-ludo/backups` (14 daily backups, plus the original D1 export)
- Service: `medicine-ludo.service`
- Backup timer: `medicine-ludo-backup.timer`
- Nginx: `/etc/nginx/conf.d/medicine-ludo.conf`
- Certificate: `/etc/letsencrypt/live/medicine-ludo.jaindu.me/`

The admin password was generated for this deployment. Read it through SSH with
`sudo cat /etc/medicine-ludo.env`; keep the file private. Admin login is at `/admin`.

## Update

```bash
ssh ubuntu@169.58.129.250
export PATH=/home/ubuntu/.nvm/versions/node/v24.19.0/bin:$PATH
cd /home/ubuntu/medicine-ludo
git pull --ff-only
npm ci
npm run typecheck
npm test
npm run build
sudo systemctl start medicine-ludo-backup
sudo systemctl restart medicine-ludo
curl --fail http://127.0.0.1:8787/api/health
```

Saved games resume when players reconnect after restart. Question deadlines restart
at a full minute on recovery. Empty rooms are paused and removed after 90 seconds;
room snapshots expire after six hours of downtime. Players, questions, statistics,
and leaderboard results are permanent. Completed-game IDs prevent duplicate awards.

Run exactly **one** app process; do not enable PM2 cluster mode or multiple replicas.
Room coordination is in-process. The limits are 500 rooms and 2,000 sockets; these
are safeguards, not a promise of that capacity. systemd restarts failures and caps
this app at 768 MB so it cannot consume all memory from other VM services.

## Monitor and back up

```bash
sudo systemctl status medicine-ludo
sudo journalctl -u medicine-ludo -f
sudo systemctl list-timers medicine-ludo-backup.timer
sudo systemctl start medicine-ludo-backup
sudo nginx -t
```

A log line each minute reports room/socket counts, RSS and event-loop latency.
Backups use SQLite's online backup API and run an integrity check. Daily copies on
the VM protect against accidental edits; copy them off the VM for protection against
disk/VM loss. Never copy only the live `.sqlite` file while WAL writes are active.
To restore, stop the app, retain the current database and its WAL/SHM files together,
restore a verified backup as the database, ensure ubuntu owns it, then restart.

The certificate renews with Certbot's existing timer and a dedicated webroot.
The renewal deploy hook reloads Nginx after validating its configuration.
Do not overwrite the global nginx.conf or other site files.

## Load testing

Use a disposable database and a separate port. The harness creates real players and
records game statistics, so do not run it against the production database.

```bash
DATABASE_PATH=/tmp/ludo-load.sqlite PORT=18787 npm start
# Seed the disposable database first using the importer or a verified backup.
BASE=http://127.0.0.1:18787 PLAYERS=200 PER_ROOM=4 npm run loadtest
BASE=http://127.0.0.1:18787 PLAYERS=200 PER_ROOM=1 npm run loadtest
```

`PER_ROOM=4` tests 50 multiplayer games; `PER_ROOM=1` tests 200 rooms with three
AI opponents each. `DURATION_SECONDS` defaults to 30. For a completed-game test use
`BASE=... ADMIN_PASSWORD=... npm run playtest -- ffa quick 1` with test-only
`REVEAL_MS=10 ANSWER_LOCK_MS=10`. Do not speed up production timers.

## Migration notes

The deployed Worker differed from the old GitHub checkout. The migration preserves
its difficulty-only question bank, Easy-only gameplay and AI accuracy settings.
Numbered question tiers are no longer stored; dice still control movement and scores.
The original D1 SQL export is retained privately. Browser storage belongs to a domain,
so players moving from workers.dev must enter their existing six-digit player ID.
Old in-progress Cloudflare rooms cannot transfer: the Worker held their game state
only in memory. Newly created VM games have persistent snapshots.
