# JobNotifier

Polls GitHub repos tracking Canadian tech internships and sends new postings to Discord.

## Monitored Repos

- [negarprh/Canadian-Tech-Internships-2026](https://github.com/negarprh/Canadian-Tech-Internships-2026)
- [hanzili/canada_sde_intern_position](https://github.com/hanzili/canada_sde_intern_position)

## Setup

```bash
npm install
cp .env.example .env
# Add your Discord webhook URL to .env
```

## Usage

```bash
# Seed state (skip initial flood of notifications)
npm start -- --seed

# Run the notifier (polls every 15 min)
npm run dev        # local (loads .env)
npm start          # cloud (env vars injected)
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_WEBHOOK_URL` | Yes | Discord channel webhook URL |
| `GITHUB_TOKEN` | No | Increases GitHub rate limit (60/hr to 5000/hr) |
| `POLL_INTERVAL_MINUTES` | No | Poll interval in minutes (default: 15) |

## Deploy (Railway)

1. Connect repo on [railway.app](https://railway.app)
2. Add `DISCORD_WEBHOOK_URL` in service Variables
3. Set start command to `npm start -- --seed`, let it run once
4. Change start command back to `npm start`
