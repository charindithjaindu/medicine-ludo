#!/usr/bin/env python3
"""Consistent online SQLite backup; never copy a live WAL database with cp."""
import datetime
import pathlib
import sqlite3

root = pathlib.Path('/var/lib/medicine-ludo')
backup_dir = root / 'backups'
backup_dir.mkdir(exist_ok=True)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
target = backup_dir / f'medicine-ludo-{stamp}.sqlite'
with sqlite3.connect(f'file:{root}/medicine-ludo.sqlite?mode=ro', uri=True) as source:
    with sqlite3.connect(target) as dest:
        source.backup(dest)
        if dest.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Backup integrity check failed')
for old in sorted(backup_dir.glob('medicine-ludo-*.sqlite'))[:-14]:
    old.unlink()
print(target)
