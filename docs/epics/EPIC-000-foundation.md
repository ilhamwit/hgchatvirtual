# EPIC-000: Fondasi Repo & Struktur

status: on-progress
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

- [ ] **T-002** Ekstrak gambar base64 (logo + 5 foto agent) ke `public/assets/`, CSS ke `public/style.css`, JS ke `public/app.js`; `server.js` menyajikan `public/` dengan MIME yang benar. Tampilan harus identik.
- [ ] **T-003** Hapus `patchHtml()` di server.js (token sudah tidak ada di file sumber) dan pastikan tidak ada secret di file mana pun yang disajikan.

### Konfigurasi & dev instance

- [ ] **T-004** `.env.example` berisi semua variabel (`GATEWAY_TOKEN`, `CHAT_PORT`, `CHAT_SECRET`, `CHAT_MEDIA_DIR`, `CHAT_MAX_UPLOAD_BYTES`, `CHAT_DB_PATH`); server gagal start dengan pesan jelas bila variabel wajib kosong (kecuali mode dev eksplisit).
- [ ] **T-005** Script `npm run dev` (port terpisah, DB terpisah) + `README.md` singkat: cara jalan lokal, cara deploy ke service `chat-center`, lokasi env.

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

## Dependencies

- Tidak ada. Epic ini prasyarat untuk semua epic lain.
