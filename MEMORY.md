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
- WhatsApp: Hermes' WhatsApp (Baileys bridge, bot mode) belongs to the
  *default* profile; bridge on 127.0.0.1:3010, session
  `~/.hermes/whatsapp/session`. The Koneksikan WA page pairs into
  `session.pending` via `bridge.js --pair-only --pair-json`; installing it is
  `scripts/wa-apply.sh` (human-run: stop gateway, swap with `.bak-<time>`,
  start, verify, roll back on failure). The web must never control
  hermes-gateway — the owner chose this design after the auto-mode
  classifier refused web-triggered restarts (2026-10-18).
- WhatsApp groups (Pilih Group / Summary Chat): read-only index of the
  bridge's group archive (`WHATSAPP_GROUP_ARCHIVE`, set in ~/.hermes/.env)
  into `wa_messages` (migration 4; offset + inode + head hash, so rotation is
  safe). Group policy in Hermes is `open` + `require_mention: true`. A Hermes
  cron `wa-group-summary` (every 6 h) already posts digests to a group —
  separate from the web summaries. Web summaries are always written by the
  Hermes profile `aurix` (`CHAT_WA_SUMMARY_AGENT`); users cannot pick an agent. The bot's own group replies are not in the
  archive (bridge skips fromMe in groups); they are read from Hermes'
  `state.db` (sessions source=whatsapp, chat_type=group, assistant +
  finish_reason=stop). Mentions are "@<LID>"; resolve via creds.json me.lid
  (bot) and `lid-mapping-<lid>_reverse.json` (→ phone → sender_name).
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
- Ops (EPIC-005): `scripts/backup.js` → `data/backups/` (14 days, verified),
  daily via user unit `chat-center-backup.timer` (install script in
  `scripts/`); `GET /healthz` is public; `req …` lines in journald; table
  `audit_log` (migration 3, 180 days) viewed with `node scripts/users.js audit`.

## Decisions

- 2026-10-18 — Users are the internal team; every user may use every agent,
  conversations are private per user (EPIC-001/002).
- 2026-10-18 — Work is tracked as epics in `docs/epics/` (kit format, T-IDs
  sequential across epics). MVP = EPIC-000 → EPIC-002.
