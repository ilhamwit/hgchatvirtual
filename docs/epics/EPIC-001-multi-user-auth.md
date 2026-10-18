# EPIC-001: Akun per Orang & Sesi Login

status: backlog
environment: dev
phase: 1
priority: P0
area: Backend
retries: 0
prd: -
stories: -
tasks: T-006 … T-011

## Goal

Setiap anggota tim login dengan akunnya sendiri, sehingga sistem tahu siapa yang
sedang bicara dengan agent dan akses bisa dicabut per orang. Saat ini hanya ada
satu akun bersama (`CHAT_USER`/`CHAT_PASS`), cookie sesi berupa HMAC statis yang
tidak bisa dicabut, PIN `101010` hanya di sisi browser, dan CORS `*`.

Asumsi (2026-10-18): semua anggota tim boleh memakai semua agent; percakapan
terpisah per orang. Pembatasan per agent bisa ditambah lewat role nanti.

## User Stories

- **US-AUTH-1** — Sebagai anggota tim, saya ingin login dengan username & password saya sendiri, supaya percakapan saya terpisah dari orang lain.
- **US-AUTH-2** — Sebagai admin, saya ingin menambah, menonaktifkan, dan me-reset akun, supaya akses tim terkendali.
- **US-AUTH-3** — Sebagai anggota tim, saya ingin bisa logout dan sesi saya bisa dicabut, supaya perangkat yang hilang tidak jadi celah.

## Tasks

### Database & model user

- [ ] **T-006** SQLite via `node:sqlite` (bawaan Node, tanpa dependency) di `CHAT_DB_PATH`; migrasi skema bertahap; tabel `users` (id, username, display_name, password_hash, role `admin|member`, disabled, created_at).

### Login & sesi

- [ ] **T-007** Password di-hash dengan `crypto.scrypt` + salt per user; perbandingan timing-safe.
- [ ] **T-008** Tabel `sessions` (token acak 32 byte, disimpan sebagai hash; user_id, created_at, expires_at, last_seen, user_agent); cookie `HttpOnly; Secure; SameSite=Lax`; endpoint `POST /logout`; sesi kedaluwarsa otomatis.
- [ ] **T-009** Rate limit login per IP + per username (mis. 5 gagal / 15 menit) dengan respons 429.

### Admin & bersih-bersih

- [ ] **T-010** CLI `node scripts/users.js add|disable|enable|reset-password|list|revoke-sessions`; akun pertama dibuat dari CLI.
- [ ] **T-011** Hapus PIN `101010` dan layar PIN dari frontend; ganti `login.html` ke alur akun baru; hapus header CORS `*`; hapus jalur Basic auth dan `CHAT_USER`/`CHAT_PASS` dari env.

## Acceptance Criteria

**Epic-level**

- Dua user berbeda bisa login bersamaan dan server mengenali masing-masing.
- Menonaktifkan user atau `revoke-sessions` langsung membuat request berikutnya 401.
- Tidak ada lagi kredensial bersama atau PIN di kode klien.

**Per-task**

- **T-006** — DB terbentuk otomatis saat start; migrasi idempotent.
- **T-007** — password tersimpan bukan plaintext; test: password salah ditolak.
- **T-008** — logout menghapus sesi di DB; cookie lama setelah logout → 401.
- **T-009** — percobaan ke-6 dalam jendela waktu → 429.
- **T-010** — semua subcommand CLI teruji manual dan tercatat di README.
- **T-011** — `grep -r 101010` dan `Access-Control-Allow-Origin: *` kosong.

## Automation Log

- 2026-10-18 Epic dibuat; keputusan: pengguna = tim internal, semua user boleh pakai semua agent — backlog

## Dependencies

- EPIC-000 (git + struktur file).
