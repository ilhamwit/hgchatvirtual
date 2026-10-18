# HG Chat Center — Chat dengan AI agent tim HG

> **DRAFT** — dibuat oleh `/agentic-init` (mode existing) pada 2026-10-18 dari
> kode yang berjalan dan audit Chat Center. Perlu ditinjau manusia. Bila PRD ini
> berbeda dengan sebuah epic, **epic yang menang**.

## Problem

Tim internal HG (Ilham, Irfan, Cahyo, dll) sudah punya lima AI agent di
OpenClaw (Dave, Jaden, Joel, Dylan, Nana), tetapi antarmuka web untuk
memakainya — HG Chat AI Agent di agents.herrygunawan.com — dibangun sebagai
mockup single-file lalu disambungkan ke gateway. Akibatnya belum layak dipakai
bersama oleh satu tim.

## Evidence

Dari kode (`server.js`, `hg-chat-ai-agent.html`) dan state OpenClaw, 2026-10-18:

- Satu akun bersama (`CHAT_USER`/`CHAT_PASS`); PIN `101010` hanya di klien.
- Browser mengirim `user: "chatcenter:<agentId>"` → satu sesi OpenClaw per agent
  dipakai semua orang (`agent:dave:openai-user:chatcenter:dave`).
- Riwayat hanya di `localStorage` (`cc_chat_history_v1`, maks 200 pesan/agent).
- Proxy meneruskan seluruh `/v1/*` + header klien dengan token operator.
- Balasan tanpa streaming (timeout klien 4 menit).
- 7 menu sidebar, tab Prompt/Agent, model selector, mic: hanya hiasan.
- Tanpa git, tanpa test, satu file HTML 194 KB berisi gambar base64.

## Users

| Pengguna | Kebutuhan |
| --- | --- |
| Anggota tim internal | Chat dengan agent dari perangkat mana pun, riwayat pribadi tersimpan, balasan cepat terlihat |
| Admin (Ilham) | Mengelola akun tim, mencabut akses, data aman ter-backup |

Bukan untuk publik/klien (diputuskan 2026-10-18).

## Hypothesis

Jika setiap anggota tim punya akun sendiri, percakapan tersimpan di server per
thread, dan balasan di-stream, maka tim akan memakai Chat Center sebagai pintu
utama ke agent (bukan hanya Telegram), dan agent bisa mulai dipakai untuk kerja
tim nyata (EPIC-006).

## Success Metrics

- Semua anggota tim aktif punya akun sendiri; nol kredensial bersama.
- 0 kebocoran konteks antar user (sesi OpenClaw per percakapan).
- Riwayat tersedia lintas perangkat; tidak ada kehilangan data (backup harian).
- Token pertama tampil < 3 detik setelah gateway mulai membalas.

## Scope

**In (MVP = EPIC-000 → EPIC-002):** fondasi repo, akun per orang + sesi, riwayat
di server, API chat server-side, sesi OpenClaw per percakapan.

**Next (P1):** streaming & UX percakapan (EPIC-003), lampiran + retensi
(EPIC-004), backup/health/log (EPIC-005).

**Later (P2):** agent untuk kerja tim — integrasi Backstage, ringkasan harian,
percakapan bersama (EPIC-006).

**Out:** akses publik/klien, aplikasi mobile native.

## Delivery Milestones

| Milestone | Epics | Hasil |
| --- | --- | --- |
| M0 Fondasi | EPIC-000 | Repo di git, file terpisah, instance dev |
| M1 MVP tim | EPIC-001, EPIC-002 | Multi-user + riwayat server |
| M2 Harian | EPIC-003 → EPIC-005 | Streaming, lampiran, operasional |
| M3 Kerja tim | EPIC-006 | Agent membantu alur kerja tim |

## Open Questions

- Apakah agent tertentu hanya untuk orang tertentu? (Asumsi sekarang: semua user boleh semua agent.)
- Berapa lama riwayat chat disimpan? (Default usulan: selamanya; lampiran 90 hari.)
- Alur kerja tim mana yang paling ingin dibantu agent? (EPIC-006 T-031)

## Risks

- **Folder ini adalah production** — `chat-center.service` menyajikan file langsung dari sini. Mitigasi: instance dev terpisah (EPIC-000 T-005), jangan restart service dari agent.
- **Gateway token = akses operator penuh** ke OpenClaw. Mitigasi: hanya server yang memanggil gateway, endpoint dibatasi (EPIC-002 T-016).
- **Data percakapan tim jadi tersentralisasi** di satu SQLite. Mitigasi: backup + restore teruji (EPIC-005 T-027).

## Appendix A — Product Surface (→ epic ownership)

| Surface | Sekarang | Epic |
| --- | --- | --- |
| `/login` (login.html) | Form user/pass bersama | EPIC-001 |
| Layar PIN | Cek PIN di klien | EPIC-001 (dihapus) |
| Topbar: agent selector, search, tab | Selector jalan; lainnya hiasan | EPIC-003 |
| Sidebar: menu + daftar agent | Agent jalan; menu hiasan | EPIC-003 |
| Panel history | Dari localStorage | EPIC-002, EPIC-003 |
| Area chat + input | Jalan, tanpa streaming | EPIC-002, EPIC-003 |
| Lampiran (`/upload`) | Jalan, tanpa pemilik | EPIC-004 |
| `/v1/*` proxy | Terbuka ke semua path | EPIC-002 |

## Appendix B — Domain Rules

- Satu percakapan = satu user + satu agent + satu sesi Hermes (`X-Hermes-Session-Id: hgchat-<conversationId>`).
- User hanya bisa membaca percakapan, pesan, dan lampiran miliknya (kecuali percakapan `shared`, EPIC-006).
- Gateway hanya dipanggil oleh server; klien tidak pernah memegang token gateway.

## Appendix C — Tech Stack (locked decisions)

- Node.js v26, vanilla `http` server, tanpa framework dan tanpa build step.
- Penyimpanan: SQLite via `node:sqlite` (bawaan); hashing via `node:crypto` (scrypt).
- Test: `node:test`. Gate: `scripts/{qa,test,security-check}.sh`.
- Frontend: HTML/CSS/JS statis, font Inter + Playfair Display, palet emas `#C9A84C`.
- Backend agent: Hermes Agent API server (OpenAI-compatible) di 127.0.0.1:8642, satu profil per agent (sejak EPIC-007; sebelumnya OpenClaw gateway di :18789).
- Hosting: systemd `chat-center.service` + Cloudflare Tunnel.
