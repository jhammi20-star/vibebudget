# Shared Budget App

A small Express and SQLite app for tracking a shared household budget with separate logins.

## Features

- Persistent SQLite storage in `data/budget.sqlite`
- First-run setup for two household members
- Shared categories and transactions across both accounts
- Shared income tracking alongside spending
- CSV bank import with automatic income detection and category matching
- Budget summary cards plus category spending progress
- production hardening with secure cookies, persistent SQLite-backed sessions, rate limits, and health checks

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

You can optionally set `SESSION_SECRET` before starting the app for a stronger local session key.

## Production

For AWS deployment guidance, see [aws/DEPLOY_AWS.md](/Users/jasonhamilton/Documents/Vibe/aws/DEPLOY_AWS.md:1).
