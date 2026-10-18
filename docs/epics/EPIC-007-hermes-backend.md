# EPIC-007: Pindah Backend Agent ke Hermes

status: done
environment: dev
phase: 1
priority: P0
area: Backend
retries: 0
prd: ../product/PRD.md
stories: -
tasks: T-035 … T-040

## Goal

Agent tim (Dave, Jaden, Joel, Dylan, Nana) sudah dimigrasikan dari OpenClaw ke
**Hermes Agent** (profil `dave`, `jaden`, `joel`, `dylan`, `nana`). Chat Center
harus berbicara dengan agent di Hermes, bukan lagi dengan gateway OpenClaw,
tanpa mengubah UI maupun riwayat yang tersimpan, dan tetap satu sesi agent per
percakapan.

## User Stories

- **US-HRM-1** — Sebagai anggota tim, saya ingin chat di HG Chat dijawab oleh agent Hermes yang sama dengan yang saya pakai di Telegram/WhatsApp, supaya memori dan kemampuannya satu.
- **US-HRM-2** — Sebagai admin, saya ingin kunci akses Hermes hanya ada di server, supaya browser tidak pernah memegang akses ke agent.

## Tasks

### Siapkan Hermes API server

- [x] **T-035** Backup config + `.env` Hermes (default + 5 profil). Aktifkan API server hanya di profil `default` (127.0.0.1:8642, kunci sendiri); set `API_SERVER_KEY` yang sama di `.env` kelima profil agent (tanpa listener sendiri, sesuai mode multiplex Hermes); simpan kunci itu sebagai `HERMES_API_KEY` di `~/.config/chat-center.env`; restart `hermes-gateway` (user service).

### Klien Hermes

- [x] **T-036** `lib/gateway.js` → `POST /p/<agent>/v1/chat/completions` dengan `Authorization: Bearer HERMES_API_KEY`, `model: <agent>`, dan `X-Hermes-Session-Id: hgchat-<conversationId>`; hanya pesan baru yang dikirim (transkrip disimpan Hermes). `finish_reason` `cancelled`/`error` disimpan sebagai error, bukan balasan.

### Konfigurasi

- [x] **T-037** `HERMES_API_KEY` menggantikan `GATEWAY_TOKEN` sebagai env wajib; `CHAT_HERMES_URL` (default 127.0.0.1:8642); `CHAT_AGENTS` = nama profil Hermes; `npm run dev -- --gateway` membaca `HERMES_API_KEY`.

### Test & dokumentasi

- [x] **T-038** Test memakai Hermes palsu: path `/p/dave/...`, header sesi, satu pesan per giliran, kunci, error 401/cancelled/error, Hermes tidak terjangkau. Default test tetap tidak pernah menyentuh agent asli.
- [x] **T-039** README (bagian Hermes + cara menambah agent), `.env.example`, `MEMORY.md`, PRD, manifest `.agentic/config.yml`, referensi OpenClaw di EPIC-003/005/006.

### Rilis

- [x] **T-040** Merge ke `main`, restart `chat-center` (bersamaan dengan rilis EPIC-002 yang belum aktif), uji chat dari browser ke kelima agent.

## Acceptance Criteria

**Epic-level**

- Chat dari browser dijawab oleh profil Hermes yang benar (bukan OpenClaw).
- Dua giliran dalam satu percakapan berbagi konteks; percakapan berbeda tidak.
- Kunci Hermes tidak pernah dikirim ke browser.

**Per-task**

- **T-035** — `/health` 8642 = ok; `/p/<agent>/v1/models` 200 dengan kunci profil, 401 tanpa kunci atau dengan kunci default; WhatsApp bridge hidup lagi setelah restart.
- **T-036** — giliran ke-2 dalam sesi yang sama mengingat isi giliran ke-1 (diuji dengan agent asli).
- **T-037** — server menolak start tanpa `HERMES_API_KEY` (test).
- **T-038** — `npm run gates` PASS.
- **T-040** — kelima agent membalas dari agents.herrygunawan.com.

## Automation Log

- 2026-10-18 Epic dibuat atas permintaan user: agent sudah dimigrasikan ke Hermes; Chat Center ikut pindah — on-progress
- 2026-10-18 Temuan: Hermes v0.22.2 (`hermes-gateway`, user service, satu proses untuk profil default/aurix/dave/jaden/joel/dylan/nana, model deepseek-v4-pro); API server belum aktif; port 8642 kosong. Log Hermes penuh `Telegram polling conflict … only one bot instance` — kemungkinan gateway OpenClaw (:18789, channel telegram) masih polling token bot yang sama. Belum ditangani (keputusan user: matikan OpenClaw setelah Chat Center pindah) — info
- 2026-10-18 T-035: backup `~/.hermes/backups/pre-epic007-20261018-221343`; `hermes config set API_SERVER_ENABLED true` + `API_SERVER_KEY` (default, kunci sendiri); `hermes -p <agent> config set API_SERVER_KEY` (kunci bersama, 5 profil); `HERMES_API_KEY` ditambahkan ke `~/.config/chat-center.env` (600). `systemctl --user restart hermes-gateway` → PID 197908, `/health` ok. Uji: tiap profil `/v1/models` 200 (id = nama profil); tanpa kunci 401, kunci default di `/p/dave` 401, kunci profil tanpa prefix 401, profil tak dikenal 404. WhatsApp bridge hidup lagi — done
- 2026-10-18 T-036: probe ke Dave asli dengan `X-Hermes-Session-Id: hgchat-probe-…`: giliran 1 "Ingat angka 47" → "OK" (3,7 dtk), giliran 2 → "47" (sesi bersambung). Session id dengan karakter ilegal → 400 (uuid kita aman). Klien ditulis ulang — done
- 2026-10-18 T-037/T-038/T-039: env & test & docs diperbarui; 37 test PASS (2 baru: finish_reason cancelled/error/401, Hermes tidak terjangkau). Catatan: default test memakai port 9 yang ditolak `fetch` ("bad port") — jaminan tidak pernah terhubung ke mana pun — done
- 2026-10-18 Uji end-to-end lewat dev :8651 (`--gateway`, kunci dari env production): kelima agent menyebut namanya sendiri (dave 1,8 dtk · jaden 1,4 · joel 2,9 · dylan 4,0 · nana 3,4); Dave: "Ingat kata: mangga" → giliran berikutnya "mangga"; "Siapa saya?" → "Hermes Check (@hermescheck)". Data dev dihapus — done
- 2026-10-18 Status → ready-for-qa (tersisa T-040: restart chat-center + uji browser) — ready-for-qa
- 2026-10-18 T-040: restart 22:19 (PID 206012, banner "Hermes http://127.0.0.1:8642"). User chat dari browser ke kelima agent; semua dibalas Hermes, 0 error; sesi `hgchat-<id>` tercatat di log agent kelima profil — done

## Dependencies

- EPIC-002 (API percakapan server-side). Rilisnya digabung dengan rilis EPIC-002 yang belum aktif.
