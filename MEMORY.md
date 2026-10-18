# MEMORY — HG Chat Center

Short, verified facts that survive sessions. Keep each line true; delete it when
it stops being true. Durable decisions also go in the owning epic's Automation Log.

## System

- `chat-center.service` (systemd, user `hg`) runs `node server.js` from **this
  folder** on 127.0.0.1:8643; Cloudflare Tunnel publishes it as
  agents.herrygunawan.com. Env: `~/.config/chat-center.env`.
- `server.js` serves the page and proxies to the OpenClaw gateway at
  127.0.0.1:18789 (OpenAI-compatible `/v1/chat/completions`, agent targets
  `openclaw/<agentId>`). Agents: dave, jaden, joel, dylan, nana (+ main/Aurix).
- OpenClaw derives the session from the request's `user` field; today the page
  sends `chatcenter:<agentId>`, so every user shares one session per agent
  (fixed by EPIC-002).
- Attachments are written to `~/.openclaw/media/inbound` and handed to the agent
  as an absolute path.
- Node v26.8.1 on the host: `node:sqlite` and `node:test` are available.
- Only `public/` is served over HTTP. `server.js` refuses to start without
  `GATEWAY_TOKEN` or with zero active users, unless `CHAT_DEV=1`.
- Accounts (EPIC-001): SQLite `data/chat-center.db` via `lib/db.js` (migrations
  in `PRAGMA user_version`); `lib/auth.js` = scrypt, sessions stored as SHA-256
  of the cookie token (`hgchat_session`), 5 fails/15 min limiter (in memory).
  Admin CLI: `node scripts/users.js`.
  `npm run dev` = dev instance on :8650 with data in `data/dev/`.
- `npm run gates` runs qa + test (unit + boot smoke) + security.

## Decisions

- 2026-10-18 — Users are the internal team; every user may use every agent,
  conversations are private per user (EPIC-001/002).
- 2026-10-18 — Work is tracked as epics in `docs/epics/` (kit format, T-IDs
  sequential across epics). MVP = EPIC-000 → EPIC-002.
