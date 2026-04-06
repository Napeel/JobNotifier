# Internship Job Notifier — Design Spec

## Problem

Two GitHub repos track Canadian tech internships by maintaining README tables:
- `negarprh/Canadian-Tech-Internships-2026` (5-column table: Company, Role, Location, Apply, Date Posted)
- `hanzili/canada_sde_intern_position` (7-column table with categories: Title, Company, Role, Company Info, Details, Location, Apply)

The user wants phone notifications (via Discord mobile app) whenever new postings are added.

## Solution

A lightweight TypeScript/Node.js polling service that:
1. Fetches raw README.md from both repos every 15 minutes
2. Parses markdown tables and extracts posting rows
3. Diffs against previously seen postings (stored as hashes in a JSON file)
4. Sends new postings to a Discord channel via webhook

## Architecture

```
[node-cron: every 15 min]
        |
        v
[poller.ts] — fetch raw README from GitHub (2 HTTP calls)
        |
        v
[parser.ts] — regex-based markdown table parser
        |         - repo-specific column mappings
        |         - extracts: company, role, location, apply link
        |
        v
[diff against state.json] — hash each row, find new hashes
        |
        v
[discord.ts] — POST embed to Discord webhook URL
        |
        v
[update state.json]
```

## File Structure

```
src/
  index.ts          # Entry point: cron setup, orchestration
  poller.ts         # Fetch raw README from GitHub API
  parser.ts         # Parse markdown tables into PostingRow[]
  discord.ts        # Send Discord webhook notification
  types.ts          # Shared types
state.json          # Persisted set of known posting hashes
.env                # DISCORD_WEBHOOK_URL, GITHUB_TOKEN (optional)
```

## Key Design Decisions

### Change Detection
- Each posting row is hashed (SHA-256 of `company|role|location` normalized lowercase)
- `state.json` stores a flat array of hashes per repo
- On each cycle: new hashes = new postings to notify about
- Handles row reordering, formatting changes without false positives

### Parsing Strategy
- Split README by lines, identify table rows (lines starting with `|`)
- Skip header and separator rows
- Extract cell values by splitting on `|`
- Per-repo config maps column indices to fields (company, role, location, apply link)
- Strip markdown formatting (links, emojis, whitespace)

### Repo Configs
```typescript
const REPOS = [
  {
    owner: "negarprh",
    repo: "Canadian-Tech-Internships-2026",
    columns: { company: 0, role: 1, location: 2, apply: 3, datePosted: 4 },
  },
  {
    owner: "hanzili",
    repo: "canada_sde_intern_position",
    columns: { company: 1, role: 2, location: 5, apply: 6 },
  },
];
```

### Discord Notification Format
Each new posting sends an embed:
- **Title:** `Company — Role`
- **Description:** Location
- **URL:** Apply link (clickable)
- **Timestamp:** Current time

Multiple postings in the same cycle are batched into a single message (Discord allows up to 10 embeds per message).

### Error Handling
- If a fetch fails, log and skip that repo for this cycle (don't crash)
- If Discord webhook fails, log and retry next cycle
- If `state.json` is missing or corrupt, treat as fresh start (notify all current postings once, then track from there)

## Dependencies

- `node-cron` — cron scheduling
- `typescript` / `tsx` — dev/build
- No other runtime dependencies. Uses built-in `fetch()` and `crypto`.

## Hosting

**Railway** (free hobby tier):
- Supports long-running Node.js workers
- Persistent filesystem for `state.json`
- Easy deploy from GitHub
- No credit card required

Alternative: local machine via `launchd` / cron.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_WEBHOOK_URL` | Yes | Discord channel webhook URL |
| `GITHUB_TOKEN` | No | Optional, increases GitHub API rate limit from 60/hr to 5000/hr |
| `POLL_INTERVAL_MINUTES` | No | Override default 15 min interval |

## Verification Plan

1. **Unit test parser** — feed sample README markdown, assert correct PostingRow[] output
2. **Manual test** — run once, verify Discord message appears with correct formatting
3. **Diff test** — run twice with a modified state.json (remove some hashes), verify only "new" postings are sent
4. **Error test** — disconnect network, verify service recovers on next cycle
