#!/usr/bin/env python3
"""Daily vault digest - summarize vault activity for RC1."""

import json
import sqlite3
import time
from datetime import datetime, timedelta

DB = "/Users/macminirolland/Dev/ClaudeClaw/store/claudeclaw.db"

def run_digest():
    db = sqlite3.connect(DB)
    now = int(time.time())
    yesterday = now - 86400  # 24h ago
    week_ago = now - 604800  # 7 days ago

    lines = []
    lines.append("== VAULT DIGEST ==\n")

    # 1. Notes modified in last 24h
    rows = db.execute("""
        SELECT filename, folder, subfolder, note_type,
               datetime(last_modified, 'unixepoch', 'localtime') as modified
        FROM vault_index
        WHERE last_modified > ?
        ORDER BY last_modified DESC
    """, (yesterday,)).fetchall()

    if rows:
        lines.append(f"Notes modifiees (24h) : {len(rows)}")
        for r in rows:
            ntype = f" [{r[3]}]" if r[3] else ""
            folder = f"{r[1]}/{r[2]}" if r[2] else r[1]
            lines.append(f"  - {r[0]}{ntype} ({folder})")
    else:
        lines.append("Aucune note modifiee dans les 24 dernieres heures.")

    lines.append("")

    # 2. INBOX count
    inbox_count = db.execute("""
        SELECT COUNT(*) FROM vault_index
        WHERE folder LIKE '%INBOX%'
    """).fetchone()[0]

    if inbox_count > 0:
        lines.append(f"INBOX : {inbox_count} notes en attente de triage")
        # Show most recent 5
        inbox_recent = db.execute("""
            SELECT filename, datetime(last_modified, 'unixepoch', 'localtime') as modified
            FROM vault_index
            WHERE folder LIKE '%INBOX%'
            ORDER BY last_modified DESC
            LIMIT 5
        """).fetchall()
        for r in inbox_recent:
            lines.append(f"  - {r[0]} ({r[1]})")
    else:
        lines.append("INBOX : vide")

    lines.append("")

    # 3. Notes created this week
    week_count = db.execute("""
        SELECT COUNT(*) FROM vault_index
        WHERE last_modified > ?
    """, (week_ago,)).fetchone()[0]
    lines.append(f"Notes modifiees cette semaine : {week_count}")

    # 4. Type breakdown this week
    types_week = db.execute("""
        SELECT note_type, COUNT(*) as c
        FROM vault_index
        WHERE last_modified > ? AND note_type IS NOT NULL
        GROUP BY note_type
        ORDER BY c DESC
    """, (week_ago,)).fetchall()

    if types_week:
        lines.append("Par type :")
        for r in types_week:
            lines.append(f"  {r[0]}: {r[1]}")

    lines.append("")

    # 5. Total vault stats
    total = db.execute("SELECT COUNT(*), SUM(file_size) FROM vault_index").fetchone()
    lines.append(f"Total vault indexe : {total[0]} notes ({total[1] // 1024 // 1024} Mo)")

    db.close()
    return "\n".join(lines)

if __name__ == "__main__":
    print(run_digest())
