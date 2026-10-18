# MEMORY — HG Chat Center

Short, verified facts that survive sessions. Keep each line true; delete it when
it stops being true. Durable decisions also go in the owning epic's Automation Log.

## System

- `chat-center.service` (systemd, user `hg`) runs `node server.js` from **this
  folder** on 127.0.0.1:8643; Cloudflare Tunnel publishes it as
  agents.herrygunawan.com. Env: `~/.config/chat-center.env`.
- Agents run in **Hermes Agent** (since EPIC-007; they were OpenClaw agents
  before). `hermes-gateway` is a *user* systemd service (`systemctl --user`),
  one process serving profiles default, aurix, dave, jaden, joel, dylan, nana.
  Its API server listens on 127.0.0.1:8642 (enabled on the default profile
  only); agent X is `POST /p/X/v1/chat/completions` with the profile's
  `API_SERVER_KEY`. The five agent profiles share one key, which is
  `HERMES_API_KEY` in `~/.config/chat-center.env`. Pre-change backup:
  `~/.hermes/backups/pre-epic007-20261018-221343`.
- One Hermes session per conversation via header
  `X-Hermes-Session-Id: hgchat-<conversationId>`; Hermes keeps the transcript,
  so each turn sends only the new message. Conversations from before EPIC-007
  had OpenClaw sessions (`user: hgchat:<id>`); their context does not carry over.
- OpenClaw is retired: `openclaw-gateway` (user service) was stopped and disabled
  on 2026-10-18 because it polled the same Telegram bots as Hermes.
- The browser never reaches Hermes: `lib/api.js` (/api/*) stores messages in
  SQLite and `lib/gateway.js` calls Hermes with the key. Each message to
  an agent starts with `[Dari: <Name> (@user) via HG Chat]`.
- Attachments are written to `~/.openclaw/media/inbound` and handed to the agent
  as an absolute path.
- Node v26.8.1 on the host: `node:sqlite` and `node:test` are available.
- Only `public/` is served over HTTP. `server.js` refuses to start without
  `HERMES_API_KEY` or with zero active users, unless `CHAT_DEV=1`.
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
