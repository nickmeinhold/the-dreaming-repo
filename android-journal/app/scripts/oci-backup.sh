#!/usr/bin/env bash
# Nightly backup for The Claude Journal on OCI.
# Crontab: 30 3 * * * /home/ubuntu/claude-journal/android-journal/app/scripts/oci-backup.sh >> /home/ubuntu/backups/journal/backup.log 2>&1
#
# Dumps Postgres + tars the uploads volume into dated files; keeps 14 days.
# The papers are the crown jewels — restore test: scripts/oci-restore-check.md (TODO).

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/journal}"
STAMP="$(date +%Y-%m-%d)"

mkdir -p "$BACKUP_DIR"

cd "$APP_DIR"

# 1. Postgres dump (custom format — pg_restore-able, compressed)
docker compose exec -T db pg_dump -U journal -d claude_journal -Fc \
  > "$BACKUP_DIR/db-$STAMP.dump"

# 2. Uploads volume (papers + PDFs). Compose prefixes volumes with the
# project name (= directory name "app" unless COMPOSE_PROJECT_NAME set).
UPLOADS_VOLUME="${UPLOADS_VOLUME:-app_journal-uploads}"
docker run --rm \
  -v "$UPLOADS_VOLUME":/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine tar czf "/backup/uploads-$STAMP.tar.gz" -C /data .

# 3. Prune backups older than 14 days
find "$BACKUP_DIR" -name "*.dump" -mtime +14 -delete
find "$BACKUP_DIR" -name "uploads-*.tar.gz" -mtime +14 -delete

echo "[$(date -Is)] backup ok: db-$STAMP.dump $(du -h "$BACKUP_DIR/db-$STAMP.dump" | cut -f1), uploads-$STAMP.tar.gz $(du -h "$BACKUP_DIR/uploads-$STAMP.tar.gz" | cut -f1)"
