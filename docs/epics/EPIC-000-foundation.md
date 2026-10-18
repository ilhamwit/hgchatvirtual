# EPIC-000: Fondasi Repo & Struktur

status: done
environment: dev
phase: 0
priority: P0
area: Infra
retries: 0
prd: ../product/PRD.md
stories: -
tasks: T-001 … T-005

## Goal

Menjadikan Chat Center project yang bisa dirawat bersama: ada version control,
kode terpisah dari aset, konfigurasi terdokumentasi, dan instance dev yang tidak
mengganggu service production. Saat ini semuanya ada di satu file HTML 194 KB
(gambar base64 + CSS + JS), tanpa git, dengan cadangan berupa file `.orig`.

## User Stories

- **US-PLAT-1** — Sebagai developer, saya ingin project ada di git, supaya setiap perubahan bisa ditelusuri dan dibatalkan.
- **US-PLAT-2** — Sebagai developer, saya ingin HTML, CSS, JS, dan gambar dipisah, supaya perubahan kecil tidak perlu menyentuh file 194 KB.
- **US-PLAT-3** — Sebagai developer, saya ingin menjalankan instance dev lokal di port lain, supaya bisa mencoba fitur tanpa mengganggu tim.

## Tasks

### Version control

- [x] **T-001** `git init`, `.gitignore` (env, data/, node_modules, upload), commit awal kondisi saat ini; hapus `server.js.orig-backup-*` setelah tercatat di riwayat git.

### Pecah single-file HTML

- [x] **T-002** Ekstrak gambar base64 (logo + 5 foto agent) ke `public/assets/`, CSS ke `public/style.css`, JS ke `public/app.js`; `server.js` menyajikan `public/` dengan MIME yang benar. Tampilan harus identik.
- [x] **T-003** Hapus `patchHtml()` di server.js (token sudah tidak ada di file sumber) dan pastikan tidak ada secret di file mana pun yang disajikan.

### Konfigurasi & dev instance

- [x] **T-004** `.env.example` berisi semua variabel (`GATEWAY_TOKEN`, `CHAT_PORT`, `CHAT_SECRET`, `CHAT_MEDIA_DIR`, `CHAT_MAX_UPLOAD_BYTES`, `CHAT_DB_PATH`); server gagal start dengan pesan jelas bila variabel wajib kosong (kecuali mode dev eksplisit).
- [x] **T-005** Script `npm run dev` (port terpisah, DB terpisah) + `README.md` singkat: cara jalan lokal, cara deploy ke service `chat-center`, lokasi env.

## Acceptance Criteria

**Epic-level**

- Project ada di git dengan riwayat bersih dan tanpa secret ter-commit.
- Halaman tampil dan chat berfungsi sama seperti sebelum dipecah.
- Instance dev bisa jalan berdampingan dengan service production.

**Per-task**

- **T-001** — `git log` punya commit awal; `git status` bersih; `.env` tidak ter-track.
- **T-002** — tidak ada string `data:image/...;base64` di HTML; ukuran HTML < 30 KB; screenshot sebelum/sesudah sama.
- **T-003** — `grep` token gateway di `public/` kosong.
- **T-004** — start tanpa `GATEWAY_TOKEN` gagal dengan pesan yang menyebut variabel itu.
- **T-005** — orang baru bisa menjalankan dev instance hanya dari README.

## Automation Log

- 2026-10-18 Epic dibuat dari audit Chat Center (single-file 194 KB, tanpa git) — backlog
- 2026-10-18 Status → on-progress atas permintaan user — on-progress
- 2026-10-18 T-001: scan secret (token gateway, CHAT_PASS, CHAT_SECRET tidak ada di file), `git init -b main`, `.gitignore`, commit df5d520 (snapshot as deployed) + 51cf6e4 (hapus `server.js.orig-backup`) — done
- 2026-10-18 /agentic-init (mode existing): `.agentic/config.yml`, `.claude/{agents,commands,hooks,settings.json}` (guardrail PreToolUse), `CLAUDE.md`/`AGENTS.md`/`CONVENTIONS.md`/`MEMORY.md`/`program.md`/`results.md`, `checks/`, loop docs (loop tetap disabled), draft `docs/product/PRD.md`, `docs/BACKLOG.md`, `docs/DEFINITION-OF-DONE.md`. Kit tidak menyediakan gate script, jadi ditulis khusus project: `scripts/qa.sh` (syntax JS + inline script), `scripts/test.sh` (boot smoke di port acak), `scripts/security-check.sh` (env, nilai secret nyata, pola token). Ketiganya PASS; security 3 warning (CORS *, PIN klien, proxy /v1/*) dilacak di EPIC-001/002. Kode aplikasi tidak diubah — done
- 2026-10-18 T-002: HTML dipecah ke `public/` (index.html 14 KB, style.css, app.js, assets/hg-logo.png + assets/agents/{dave,jaden,joel,dylan,nana}.jpg; logo login.html dipakai bersama). Bukti lossless: rakit ulang dari `public/` = byte-identik dengan file asli (index + login). `server.js` hanya menyajikan `public/` (server.js, .git, .agentic, docs → 404; traversal → 403), MIME gambar, `Cache-Control: private, no-cache` agar Cloudflare tidak menyimpan aset di balik login, alias `/hg-chat-ai-agent.html` → index. `test.sh` kini mengecek semua aset + jalur privat. Gate PASS. Belum: (a) cek visual (Claude in Chrome tidak terhubung), (b) restart `chat-center.service` oleh manusia, (c) setelah restart, hapus `hg-chat-ai-agent.html` & `login.html` di root — proses lama masih membacanya dari disk — implemented, menunggu verifikasi
- 2026-10-18 T-003: `patchHtml()` dihapus (halaman di `public/` tidak memuat token/Authorization; security gate memindai nilai token asli di semua file) — done
- 2026-10-18 T-004: `.env.example` lengkap; `server.js` menolak start bila `GATEWAY_TOKEN`/`CHAT_USER`/`CHAT_PASS`/`CHAT_SECRET` kosong atau `CHAT_PORT`/`CHAT_MAX_UPLOAD_BYTES` bukan angka valid, kecuali `CHAT_DEV=1`; bypass login hanya mungkin di dev. 5 unit test `test/config.test.js` (node:test) dijalankan `npm test`. Dicoba dengan env production asli di port cadangan: start OK, `/` & aset → 302 login — done
- 2026-10-18 T-005: `package.json` (start/dev/test/gates, tanpa dependency), `scripts/dev.sh` (port 8650, `data/dev/`, `--gateway` opsional, menolak port 8643), `README.md` (arsitektur, dev, config, rilis & rollback) — done
- 2026-10-18 Status → ready-for-qa. QA manusia: (1) bandingkan tampilan dev baru vs lama, (2) `sudo systemctl restart chat-center` lalu cek login + chat di agents.herrygunawan.com, (3) setelah itu hapus `hg-chat-ai-agent.html` & `login.html` di root, lalu → done — ready-for-qa
- 2026-10-18 QA: user mengonfirmasi tampilan baru = lama (dev :18650 vs :18651). Restart pertama yang sungguhan terjadi 21:41 WIB bersama rilis EPIC-001 (PID 3859494 → 154374; percobaan restart sebelumnya tidak terjadi). Dicek: kode baru aktif (`/login` text/html; charset=utf-8, `/` → 302, tanpa CORS), agents.herrygunawan.com sama. `hg-chat-ai-agent.html` & `login.html` di root dihapus; production tetap 200 — done

## Dependencies

- Tidak ada. Epic ini prasyarat untuk semua epic lain.
