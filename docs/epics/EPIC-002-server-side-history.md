# EPIC-002: Riwayat Percakapan di Server + API Chat

status: ready-for-qa
environment: dev
phase: 1
priority: P0
area: Backend
retries: 0
prd: ../product/PRD.md
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

- [x] **T-012** Tabel `conversations` (id uuid, user_id, agent_id, title, created_at, updated_at, archived) dan `messages` (id, conversation_id, role `user|assistant|error`, content, attachments_json, created_at).

### API server

- [x] **T-013** Endpoint JSON: `GET /api/agents`, `GET/POST /api/conversations`, `GET/PATCH /api/conversations/:id`, `GET /api/conversations/:id/messages`; semua dicek kepemilikan (user hanya melihat miliknya).
- [x] **T-014** `POST /api/conversations/:id/messages`: simpan pesan user → panggil gateway `/v1/chat/completions` dengan `model: openclaw/<agentId>` dan `user: hgchat:<conversationId>` → simpan balasan/error → kembalikan ke klien.
- [x] **T-015** Atribusi pengirim: pesan ke agent diberi konteks nama pengirim (mis. header `x-openclaw-message-channel: hgchat` + prefix `[Dari: <display_name>]`), konsisten dengan cara agent mengenali user di channel Telegram.
- [x] **T-016** Hapus proxy generik `/v1/*`; server hanya memanggil gateway dari endpoint yang diizinkan, tanpa meneruskan header klien.

### Frontend & migrasi

- [x] **T-017** Frontend memakai `/api/...` (bukan localStorage) untuk memuat dan mengirim pesan; tombol "Chat baru" per agent.
- [x] **T-018** Impor sekali riwayat lama dari localStorage `cc_chat_history_v1` ke akun yang sedang login, lalu tandai sudah diimpor.

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
- 2026-10-18 Status → on-progress; dikerjakan di worktree `../chat-center-epic-002` (branch `epic-002`) — on-progress
- 2026-10-18 T-012: migrasi 2 — `conversations` (uuid, user_id, agent_id, title, archived, import_key UNIQUE per user) + `messages` (role user/assistant/error, attachments_json); `lib/conversations.js` selalu memfilter per user_id — done
- 2026-10-18 T-013: `lib/api.js` — agents, list/create/get/patch conversations, messages, retry, stop, import; milik user lain = 404; body dibatasi; 405 untuk method salah — done
- 2026-10-18 T-014: `lib/gateway.js` satu-satunya pemanggil OpenClaw, `user: hgchat:<conversationId>`, timeout 4 menit; pesan user disimpan dulu, balasan/error disimpan sesudahnya; giliran TIDAK dibatalkan saat browser putus (balasan tetap masuk riwayat), hanya `POST …/stop` yang membatalkan; satu giliran per percakapan (409) — done
- 2026-10-18 T-015: prefix `[Dari: <Nama> (@user) via HG Chat]`. Header `x-openclaw-message-channel` sengaja TIDAK dipakai: nilainya memengaruhi kebijakan per channel di OpenClaw dan tidak ada channel "hgchat". Diuji dengan Dave sungguhan: "Siapa saya?" → "Dev Check (@devcheck)" — done
- 2026-10-18 T-016: proxy `/v1/*` dihapus seluruhnya (`/v1/models`, `/v1/chat/completions`, `/v1/responses` → 404); header klien (cookie, x-openclaw-model) tidak pernah sampai ke gateway; `CHAT_GATEWAY_URL` & `CHAT_AGENTS` bisa dikonfigurasi — done
- 2026-10-18 T-017: `public/app.js` memakai `/api/*`: panel riwayat = daftar percakapan semua agent (judul + pesan terakhir), tombol "+" Chat baru, error tersimpan dengan Coba lagi (retry tanpa duplikat), Stop via server. Karena Cloudflare memutus request ~100 dtk sedangkan agent bisa 4 menit, klien beralih ke polling bila koneksi kirim putus — done
- 2026-10-18 T-018: impor sekali `cc_chat_history_v1` → satu percakapan "Riwayat lama (browser)" per agent; idempoten (import_key hash); path lampiran lama tidak diimpor; localStorage dihapus hanya setelah server mengonfirmasi — done
- 2026-10-18 Test: 13 test baru (`test/conversations.test.js`, gateway palsu) — total 35 PASS; helper test default ke gateway yang tidak ada (127.0.0.1:9) agar test tak pernah menyentuh OpenClaw asli; `test.sh` cek `/api/agents`, `/api/conversations`, `/v1/models` → 404. Gate PASS, security 0 warning. Round-trip ke gateway asli lewat dev :8651: Dave membalas "OK" dalam 1,3 dtk, sesi `hgchat:1f03c91e…` tercipta. Frontend belum diuji di browser (Claude in Chrome tidak terhubung); handler onclick dicek statis — done
- 2026-10-18 Status → ready-for-qa. Rilis: merge `epic-002` → `main`, restart (migrasi 2 jalan otomatis, tanpa langkah akun). QA: dua user chat dengan agent yang sama, cek riwayat di perangkat lain, Chat baru, Coba lagi, Stop, dan impor riwayat lama browser — ready-for-qa

## Dependencies

- EPIC-001 (user & sesi login).
