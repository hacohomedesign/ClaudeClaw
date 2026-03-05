#!/usr/bin/env python3
"""Index Obsidian vault into SQLite vault_index table."""

import os
import re
import json
import sqlite3
import time
from pathlib import Path

VAULT = "/Users/macminirolland/Library/CloudStorage/GoogleDrive-rm@360sc.io/Mon Drive/OBSIDIAN/CHATTERS"
DB = "/Users/macminirolland/Dev/ClaudeClaw/store/claudeclaw.db"

SKIP_DIRS = {".obsidian", ".trash", ".git", "node_modules"}

def parse_frontmatter(content):
    """Extract YAML frontmatter tags and title."""
    tags = []
    title = ""
    if content.startswith("---"):
        end = content.find("---", 3)
        if end > 0:
            fm = content[3:end]
            # Extract tags
            tag_match = re.search(r'^tags:\s*\[([^\]]*)\]', fm, re.MULTILINE)
            if tag_match:
                tags = [t.strip().strip('"').strip("'") for t in tag_match.group(1).split(",") if t.strip()]
            else:
                tag_match = re.search(r'^tags:\s*\n((?:\s*-\s*.+\n)*)', fm, re.MULTILINE)
                if tag_match:
                    tags = [re.sub(r'^\s*-\s*', '', l).strip() for l in tag_match.group(1).strip().split('\n') if l.strip()]
            # Extract title
            title_match = re.search(r'^title:\s*["\']?(.+?)["\']?\s*$', fm, re.MULTILINE)
            if title_match:
                title = title_match.group(1)
    return title, tags

def extract_wikilinks(content):
    """Extract [[wikilinks]] from content."""
    return list(set(re.findall(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]', content)))

def extract_hashtags(content):
    """Extract #tags from content (not in frontmatter)."""
    # Skip frontmatter
    if content.startswith("---"):
        end = content.find("---", 3)
        if end > 0:
            content = content[end+3:]
    return list(set(re.findall(r'(?:^|\s)#([a-zA-Z0-9_/]+)', content)))

def detect_note_type(filename):
    """Detect note type from filename pattern."""
    patterns = {
        "CR": r'\d{4}-\d{2}-\d{2}\s+CR\s',
        "PRES": r'\d{4}-\d{2}-\d{2}\s+PRES\s',
        "VIDEO": r'\d{4}-\d{2}-\d{2}\s+VIDEO\s',
        "TUTO": r'\d{4}-\d{2}-\d{2}\s+TUTO\s',
        "NOTE": r'\d{4}-\d{2}-\d{2}\s+NOTE\s',
        "DAILY": r'^\d{4}-\d{2}-\d{2}\.md$',
        "PLAN": r'PLAN_JOURNALIER',
        "DEBRIEF": r'DEBRIEF_JOURNALIER',
        "PROMPT": r'^PROMPT',
        "TEMPLATE": r'^Template',
    }
    for ntype, pattern in patterns.items():
        if re.search(pattern, filename):
            return ntype
    return None

def get_folder_info(filepath, vault_root):
    """Get top-level folder and subfolder."""
    rel = os.path.relpath(filepath, vault_root)
    parts = Path(rel).parts
    folder = parts[0] if len(parts) > 1 else ""
    subfolder = parts[1] if len(parts) > 2 else ""
    return folder, subfolder

def first_heading_or_line(content):
    """Get first heading or first non-empty line as summary."""
    # Skip frontmatter
    text = content
    if text.startswith("---"):
        end = text.find("---", 3)
        if end > 0:
            text = text[end+3:].strip()

    # Find first heading
    heading = re.search(r'^#+\s+(.+)', text, re.MULTILINE)
    if heading:
        return heading.group(1).strip()[:200]

    # First non-empty line
    for line in text.split('\n'):
        line = line.strip()
        if line and not line.startswith('#'):
            return line[:200]
    return ""

def index_vault():
    now = int(time.time())
    db = sqlite3.connect(DB)

    count = 0
    errors = 0
    skipped = 0

    for root, dirs, files in os.walk(VAULT):
        # Skip system dirs
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]

        for fname in files:
            if not fname.endswith('.md'):
                continue

            fpath = os.path.join(root, fname)

            try:
                stat = os.stat(fpath)
                mtime = int(stat.st_mtime)
                fsize = stat.st_size
            except OSError:
                skipped += 1
                continue

            # Try to read content
            content = ""
            try:
                with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
                    content = f.read(50000)  # Read first 50KB max
            except (OSError, IOError):
                # Cloud-only file, index metadata only
                pass

            folder, subfolder = get_folder_info(fpath, VAULT)
            title_fm, tags_fm = parse_frontmatter(content) if content else ("", [])
            wikilinks = extract_wikilinks(content) if content else []
            hashtags = extract_hashtags(content) if content else []
            all_tags = list(set(tags_fm + hashtags))
            note_type = detect_note_type(fname)
            title = title_fm or fname.replace('.md', '')
            summary = first_heading_or_line(content) if content else ""

            try:
                db.execute("""
                    INSERT INTO vault_index
                    (filepath, filename, title, folder, subfolder, tags, links, summary, note_type, last_modified, file_size, indexed_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(filepath) DO UPDATE SET
                        filename=excluded.filename, title=excluded.title, folder=excluded.folder,
                        subfolder=excluded.subfolder, tags=excluded.tags, links=excluded.links,
                        summary=excluded.summary, note_type=excluded.note_type,
                        last_modified=excluded.last_modified, file_size=excluded.file_size,
                        indexed_at=excluded.indexed_at
                """, (
                    fpath, fname, title, folder, subfolder,
                    json.dumps(all_tags, ensure_ascii=False),
                    json.dumps(wikilinks, ensure_ascii=False),
                    summary, note_type, mtime, fsize, now
                ))
                count += 1
            except Exception as e:
                errors += 1
                if errors < 5:
                    print(f"  Error: {fname}: {e}")

    db.commit()

    # Stats
    total = db.execute("SELECT COUNT(*) FROM vault_index").fetchone()[0]
    with_tags = db.execute("SELECT COUNT(*) FROM vault_index WHERE tags != '[]'").fetchone()[0]
    with_links = db.execute("SELECT COUNT(*) FROM vault_index WHERE links != '[]'").fetchone()[0]
    typed = db.execute("SELECT COUNT(*) FROM vault_index WHERE note_type IS NOT NULL").fetchone()[0]

    print(f"Indexed: {count} notes | Skipped: {skipped} | Errors: {errors}")
    print(f"Total in DB: {total}")
    print(f"With tags: {with_tags} | With wikilinks: {with_links} | With type: {typed}")

    # Top folders
    print("\nTop folders:")
    for row in db.execute("SELECT folder, COUNT(*) as c FROM vault_index GROUP BY folder ORDER BY c DESC LIMIT 10"):
        print(f"  {row[1]:>5}  {row[0]}")

    # Top note types
    print("\nNote types:")
    for row in db.execute("SELECT note_type, COUNT(*) as c FROM vault_index WHERE note_type IS NOT NULL GROUP BY note_type ORDER BY c DESC"):
        print(f"  {row[1]:>5}  {row[0]}")

    db.close()

if __name__ == "__main__":
    index_vault()
