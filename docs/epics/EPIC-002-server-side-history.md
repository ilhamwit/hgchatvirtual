# EPIC-002: Riwayat Percakapan di Server + API Chat

status: backlog
environment: dev
phase: 1
priority: P0
area: Backend
retries: 0
prd: -
stories: -
tasks: T-012 … T-018

## Goal

Percakapan disimpan di server per user dan per thread, dan setiap thread punya
sesi OpenClaw sendiri. Saat ini browser mengirim `user: "chatcenter:<agentId>"`,
sehingga **semua anggota tim berbagi satu sesi per agent**
(`agent:dave:openai-user:chatcenter:dave`) yang konteksnya bercampur dan terus
membengkak; riwayat hanya ada di localStorage (hilang saat pindah perangkat,
maks 200 pesan); dan proxy `/v1/*` meneruskan semua path + header browser dengan
token operator (akses setara admin gateway, termasuk `x-openclaw-model`).

## User Stories

- **US-CHAT-1** — Sebagai anggota tim, saya ingin riwayat chat saya muncul di perangkat mana pun, supaya bisa lanjut dari laptop atau HP.
- **US-CHAT-2** — Sebagai anggota tim, saya ingin membuat "Chat baru" dengan agent, supaya topik berbeda tidak saling mengganggu konteks.
- **US-CHAT-3** — Sebagai agent, saya ingin tahu siapa yang mengirim pesan, supaya bisa menjawab sesuai orangnya.

## Tasks

### Skema percakapan

- [ ] **T-012** Tabel `conversations` (id uuid, user_id, agent_id, title, created_at, updated_at, archived) dan `messages` (id, conversation_id, role `user|assistant|error`, content, attachments_json, created_at).

### API server

- [ ] **T-013** Endpoint JSON: `GET /api/agents`, `GET/POST /api/conversations`, `GET/PATCH /api/conversations/:id`, `GET /api/conversations/:id/messages`; semua dicek kepemilikan (user hanya melihat miliknya).
- [ ] **T-014** `POST /api/conversations/:id/messages`: simpan pesan user → panggil gateway `/v1/chat/completions` dengan `model: openclaw/<agentId>` dan `user: hgchat:<conversationId>` → simpan balasan/error → kembalikan ke klien.
- [ ] **T-015** Atribusi pengirim: pesan ke agent diberi konteks nama pengirim (mis. header `x-openclaw-message-channel: hgchat` + prefix `[Dari: <display_name>]`), konsisten dengan cara agent mengenali user di channel Telegram.
- [ ] **T-016** Hapus proxy generik `/v1/*`; server hanya memanggil gateway dari endpoint yang diizinkan, tanpa meneruskan header klien.

### Frontend & migrasi

- [ ] **T-017** Frontend memakai `/api/...` (bukan localStorage) untuk memuat dan mengirim pesan; tombol "Chat baru" per agent.
- [ ] **T-018** Impor sekali riwayat lama dari localStorage `cc_chat_history_v1` ke akun yang sedang login, lalu tandai sudah diimpor.

## Acceptance Criteria

**Epic-level**

- Dua user chat dengan agent yang sama → sesi OpenClaw berbeda (cek `sessions.json`), konteks tidak bocor.
- Riwayat muncul identik setelah login di browser lain.
- Request ke `/v1/models` atau `/v1/responses` dari browser → 404.

**Per-task**

- **T-013** — user A meminta percakapan milik user B → 404.
- **T-014** — gateway mati → pesan user tetap tersimpan dan error tercatat; bisa di-retry.
- **T-015** — agent bisa menyebut nama pengirim bila ditanya "siapa saya?".
- **T-016** — `x-openclaw-model` dari klien tidak sampai ke gateway.
- **T-018** — impor dua kali tidak menggandakan pesan.

## Automation Log

- 2026-10-18 Epic dibuat; temuan: sesi OpenClaw `chatcenter:<agent>` dipakai bersama semua user — backlog

## Dependencies

- EPIC-001 (user & sesi login).
