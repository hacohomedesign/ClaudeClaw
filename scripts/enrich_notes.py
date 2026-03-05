#!/usr/bin/env python3
"""
Enrich Obsidian notes progressively:
- Add missing frontmatter tags based on folder/filename
- Add [[wikilinks]] to related notes (Voir aussi section)
- Non-destructive: only appends, never modifies existing content

Usage:
  python3 enrich_notes.py                    # Enrich 50 random untagged notes
  python3 enrich_notes.py --folder "002 - Projets/GS1"  # Enrich notes in a folder
  python3 enrich_notes.py --dry-run          # Preview changes without writing
  python3 enrich_notes.py --limit 100        # Process more notes
"""

import argparse
import json
import os
import re
import sqlite3
import time
from pathlib import Path

DB = "/Users/macminirolland/Dev/ClaudeClaw/store/claudeclaw.db"
VAULT = "/Users/macminirolland/Library/CloudStorage/GoogleDrive-rm@360sc.io/Mon Drive/OBSIDIAN/CHATTERS"

# Mapping folders to auto-tags
FOLDER_TAGS = {
    "002 - Projets": "projet",
    "360SmartConnect": "360sc",
    "GS1": "gs1",
    "DPP": "dpp",
    "PHENIX": "phenix",
    "005 - Ressource": "ressource",
    "051 - AI de Rolland": "ia",
    "053-YoutubeKnowlegeBase": "youtube",
    "REGLEMENTS EU": "reglementation",
    "Ecosysteme BTP en France": "btp",
    "TOOL OUTILS DIVERS": "outil",
    "006 - PERSONNEL": "personnel",
    "999 - Notes Journaliere": "daily",
    "996 - Prompts": "prompt",
    "000 - INBOX": "inbox",
    "NORME": "norme",
    "Tracabilite": "tracabilite",
    "JURIDIQUE": "juridique",
    "AppSheet": "appsheet",
    "AppScript": "appscript",
    "LinkedIN": "linkedin",
    "BPMN": "bpmn",
}

# Note type to tag
TYPE_TAGS = {
    "CR": "compte-rendu",
    "VIDEO": "video",
    "TUTO": "tuto",
    "PLAN": "plan",
    "DEBRIEF": "debrief",
    "DAILY": "daily",
    "PROMPT": "prompt",
    "PRES": "presentation",
}


def has_frontmatter(content):
    """Check if note has YAML frontmatter."""
    return content.strip().startswith("---")


def extract_frontmatter_end(content):
    """Return index of end of frontmatter (after second ---)."""
    if not content.startswith("---"):
        return -1
    end = content.find("---", 3)
    if end < 0:
        return -1
    return end + 3


def get_existing_tags(content):
    """Extract existing tags from frontmatter."""
    if not has_frontmatter(content):
        return []
    end = extract_frontmatter_end(content)
    fm = content[:end]
    tag_match = re.search(r'^tags:\s*\[([^\]]*)\]', fm, re.MULTILINE)
    if tag_match:
        return [t.strip().strip('"').strip("'") for t in tag_match.group(1).split(",") if t.strip()]
    tag_match = re.search(r'^tags:\s*\n((?:\s*-\s*.+\n)*)', fm, re.MULTILINE)
    if tag_match:
        return [re.sub(r'^\s*-\s*', '', l).strip() for l in tag_match.group(1).strip().split('\n') if l.strip()]
    return []


def suggest_tags(filepath, folder, subfolder, note_type):
    """Suggest tags based on folder, subfolder, and note type."""
    tags = set()

    # Folder-based tags
    for key, tag in FOLDER_TAGS.items():
        if key in filepath:
            tags.add(tag)

    # Type-based tags
    if note_type and note_type in TYPE_TAGS:
        tags.add(TYPE_TAGS[note_type])

    # Year tag from filename
    year_match = re.search(r'(202[4-9])', os.path.basename(filepath))
    if year_match:
        tags.add(year_match.group(1))

    return sorted(tags)


def find_related_notes(db, title, folder, subfolder, limit=5):
    """Find potentially related notes based on title keywords and folder."""
    # Extract meaningful words from title (3+ chars, not common words)
    stopwords = {"les", "des", "une", "pour", "dans", "avec", "sur", "par", "que", "qui", "est", "the", "and", "for"}
    words = re.findall(r'[a-zA-Z\u00C0-\u00FF]{3,}', title.lower())
    keywords = [w for w in words if w not in stopwords][:5]

    if not keywords:
        return []

    # Search by keywords in same folder first, then broader
    related = []
    seen = set()

    for kw in keywords:
        rows = db.execute("""
            SELECT filename, folder, subfolder
            FROM vault_index
            WHERE (filename LIKE ? OR title LIKE ?)
            AND filename != ?
            ORDER BY
                CASE WHEN folder = ? THEN 0 ELSE 1 END,
                last_modified DESC
            LIMIT 3
        """, (f"%{kw}%", f"%{kw}%", os.path.basename(title) + ".md", folder)).fetchall()

        for r in rows:
            if r[0] not in seen and len(related) < limit:
                related.append(r[0].replace(".md", ""))
                seen.add(r[0])

    return related


def enrich_note(filepath, db, dry_run=False):
    """Enrich a single note. Returns (changed, description)."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
    except (OSError, IOError):
        return False, "cloud-only, skipped"

    if not content.strip():
        return False, "empty"

    filename = os.path.basename(filepath)
    rel = os.path.relpath(filepath, VAULT)
    parts = Path(rel).parts
    folder = parts[0] if len(parts) > 1 else ""
    subfolder = parts[1] if len(parts) > 2 else ""

    # Get note type from DB
    row = db.execute("SELECT note_type, title FROM vault_index WHERE filepath = ?", (filepath,)).fetchone()
    note_type = row[0] if row else None
    title = row[1] if row else filename.replace(".md", "")

    changes = []
    new_content = content

    # 1. Add frontmatter if missing
    if not has_frontmatter(content):
        tags = suggest_tags(filepath, folder, subfolder, note_type)
        if tags:
            fm = "---\n"
            fm += f"tags: [{', '.join(tags)}]\n"
            fm += "---\n\n"
            new_content = fm + new_content
            changes.append(f"added frontmatter with tags: {tags}")

    else:
        # 2. Add missing tags to existing frontmatter
        existing_tags = get_existing_tags(content)
        suggested = suggest_tags(filepath, folder, subfolder, note_type)
        new_tags = [t for t in suggested if t not in existing_tags]

        if new_tags and existing_tags:
            all_tags = existing_tags + new_tags
            end_idx = extract_frontmatter_end(content)
            fm_section = content[:end_idx]

            # Replace tags line
            old_tags_pattern = re.search(r'^tags:\s*\[.*?\]', fm_section, re.MULTILINE)
            if old_tags_pattern:
                new_tags_line = f"tags: [{', '.join(all_tags)}]"
                fm_section = fm_section[:old_tags_pattern.start()] + new_tags_line + fm_section[old_tags_pattern.end():]
                new_content = fm_section + content[end_idx:]
                changes.append(f"added tags: {new_tags}")

        elif new_tags and not existing_tags:
            # Has frontmatter but no tags line
            end_idx = extract_frontmatter_end(content)
            # Insert tags before closing ---
            insert_point = content.rfind("---", 0, end_idx)
            if insert_point > 0:
                tags_line = f"tags: [{', '.join(new_tags)}]\n"
                new_content = content[:insert_point] + tags_line + content[insert_point:]
                changes.append(f"added tags line: {new_tags}")

    # 3. Add "Voir aussi" section with related notes (if not already present)
    if "## Voir aussi" not in new_content and "## See also" not in new_content:
        related = find_related_notes(db, title, folder, subfolder, limit=4)
        if related:
            voir_aussi = "\n\n## Voir aussi\n\n"
            for r in related:
                voir_aussi += f"- [[{r}]]\n"
            new_content = new_content.rstrip() + voir_aussi
            changes.append(f"added {len(related)} related links")

    if not changes:
        return False, "already enriched"

    if not dry_run:
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
        except (OSError, IOError):
            return False, "write failed (cloud-only)"

    return True, "; ".join(changes)


def main():
    parser = argparse.ArgumentParser(description="Enrich Obsidian notes progressively")
    parser.add_argument("--folder", default=None, help="Restrict to a specific folder")
    parser.add_argument("--limit", type=int, default=50, help="Max notes to process")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()

    db = sqlite3.connect(DB)

    # Find notes to enrich: prioritize those without tags
    if args.folder:
        query = """
            SELECT filepath FROM vault_index
            WHERE (folder LIKE ? OR subfolder LIKE ?)
            AND tags = '[]'
            ORDER BY last_modified DESC
            LIMIT ?
        """
        rows = db.execute(query, (f"%{args.folder}%", f"%{args.folder}%", args.limit)).fetchall()
    else:
        query = """
            SELECT filepath FROM vault_index
            WHERE tags = '[]'
            ORDER BY last_modified DESC
            LIMIT ?
        """
        rows = db.execute(query, (args.limit,)).fetchall()

    print(f"{'[DRY RUN] ' if args.dry_run else ''}Processing {len(rows)} notes...\n")

    enriched = 0
    skipped = 0
    errors = 0

    for (filepath,) in rows:
        changed, desc = enrich_note(filepath, db, dry_run=args.dry_run)
        if changed:
            enriched += 1
            print(f"  + {os.path.basename(filepath)}: {desc}")
        else:
            skipped += 1

    # Update vault_index for enriched notes (re-index them)
    if enriched > 0 and not args.dry_run:
        print(f"\nRe-indexing enriched notes...")
        os.system(f"python3 /Users/macminirolland/Dev/ClaudeClaw/scripts/index_vault.py")

    print(f"\nDone: {enriched} enriched, {skipped} skipped")
    db.close()


if __name__ == "__main__":
    main()
