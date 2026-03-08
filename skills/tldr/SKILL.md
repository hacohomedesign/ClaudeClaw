---
name: tldr
description: Summarize the current conversation into a TLDR note and save it to your notes folder. Use when you say "tldr", "save a summary", "note this convo", or want to capture key takeaways from the current session for future reference.
user_invocable: true
---

# /tldr -- Conversation Summary to Notes

When invoked, follow these steps exactly:

## Step 1: Summarize the conversation

Look at the last 5-10 back-and-forths in the current conversation. Write a tight TLDR summary that includes:

- **What was discussed** -- the main topics/questions
- **What was decided** -- any decisions made, approaches chosen
- **What was done** -- any concrete actions taken (files created, code written, commands run, etc.)
- **Open threads** -- anything left unfinished or flagged for later

Keep it concise. Bullet points, not paragraphs. No fluff.

## Step 2: Ask where to store it

Use AskUserQuestion to ask the user where this note should live. Present folder options based on their notes structure.

If the user has an Obsidian vault configured in CLAUDE.md (look for the `obsidian.vault` path), scan its top-level folders and present them as options. If no vault is configured, ask the user for a target directory.

Always include a generic **Inbox** option for unsorted notes.

Also show the proposed note title (auto-generated from the conversation topic) and let the user override it if they want.

Format the question like:

```
TLDR ready. Where should I save it?

Proposed title: "TLDR -- [Topic]"
(Reply with a different title if you want to rename it)
```

Then show the folder options.

## Step 3: Save the note

Once the user picks a folder (and optionally a custom title), create the note at:

```
[NOTES_DIR]/[Folder]/[Title].md
```

Use this format for the note content:

```markdown
---
type: tldr
created: YYYY-MM-DD
---

# [Title]

## TLDR

[Bullet point summary from Step 1]

## Context

- **Session date**: [today's date]
- **Key files touched**: [list any files that were created/edited, or "None" if it was just a discussion]
```

## Step 4: Confirm

Tell the user:

```
Saved: [Folder]/[Title].md
```

Keep it short. Just the path so they can find it later.

## Rules

- Date format: YYYY-MM-DD
- Note title format: `TLDR -- [Short Topic Description]` (unless the user overrides)
- If the conversation was trivial (just a greeting, one quick question), say so and ask if they still want to save it
- Don't include sensitive info like API keys or passwords in the summary
