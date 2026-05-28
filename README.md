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

## Deploy (Vercel)

1. Deploy the repo with the `/api/worker` cron function and `vercel.json` schedule.
2. Set `DISCORD_WEBHOOK_URL`, `CRON_SECRET`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` in Vercel.
3. Keep `GITHUB_TOKEN` optional for higher GitHub rate limits.
4. First cron run seeds state silently and sends no initial Discord flood.
5. `POLL_INTERVAL_MINUTES` only applies to local long-running mode; Vercel cadence comes from `vercel.json`.

Validation:

```bash
npm run smoke:worker
npm test
npm run typecheck
npm run build
DISCORD_WEBHOOK_URL=https://discord.invalid CRON_SECRET=test-secret UPSTASH_REDIS_REST_URL=https://example.com UPSTASH_REDIS_REST_TOKEN=test-token npx vercel build --yes
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_WEBHOOK_URL` | Yes | Discord channel webhook URL |
| `CRON_SECRET` | Yes for Vercel | Vercel cron bearer token |
| `UPSTASH_REDIS_REST_URL` | Yes for Vercel | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Yes for Vercel | Upstash Redis REST token |
| `GITHUB_TOKEN` | No | Increases GitHub rate limit (60/hr to 5000/hr) |
| `POLL_INTERVAL_MINUTES` | Local only | Poll interval in minutes (default: 15) |

## Deploy (Railway)

1. Connect repo on [railway.app](https://railway.app)
2. Add `DISCORD_WEBHOOK_URL` in service Variables
3. Set start command to `npm start -- --seed`, let it run once
4. Change start command back to `npm start`
