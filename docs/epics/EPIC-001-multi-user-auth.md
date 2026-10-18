# EPIC-001: Akun per Orang & Sesi Login

status: done
environment: dev
phase: 1
priority: P0
area: Backend
retries: 0
prd: ../product/PRD.md
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

- [x] **T-006** SQLite via `node:sqlite` (bawaan Node, tanpa dependency) di `CHAT_DB_PATH`; migrasi skema bertahap; tabel `users` (id, username, display_name, password_hash, role `admin|member`, disabled, created_at).

### Login & sesi

- [x] **T-007** Password di-hash dengan `crypto.scrypt` + salt per user; perbandingan timing-safe.
- [x] **T-008** Tabel `sessions` (token acak 32 byte, disimpan sebagai hash; user_id, created_at, expires_at, last_seen, user_agent); cookie `HttpOnly; Secure; SameSite=Lax`; endpoint `POST /logout`; sesi kedaluwarsa otomatis.
- [x] **T-009** Rate limit login per IP + per username (mis. 5 gagal / 15 menit) dengan respons 429.

### Admin & bersih-bersih

- [x] **T-010** CLI `node scripts/users.js add|disable|enable|reset-password|list|revoke-sessions`; akun pertama dibuat dari CLI.
- [x] **T-011** Hapus PIN `101010` dan layar PIN dari frontend; ganti `login.html` ke alur akun baru; hapus header CORS `*`; hapus jalur Basic auth dan `CHAT_USER`/`CHAT_PASS` dari env.

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
- 2026-10-18 Status → on-progress. Dikerjakan di git worktree `../chat-center-epic-001` (branch `epic-001`), bukan di folder production, karena restart EPIC-000 belum terjadi dan folder itu disajikan langsung — on-progress
- 2026-10-18 T-006/T-007: `lib/db.js` (node:sqlite, WAL, foreign keys, migrasi via `PRAGMA user_version`, file 600 di dir 700) + tabel `users`; `lib/auth.js` scrypt N=2^15 (~50 ms) + salt 16 byte, verifikasi timing-safe, dummy hash untuk username tak dikenal — done
- 2026-10-18 T-008: tabel `sessions` (SHA-256 token, expires 30 hari, last_seen di-throttle 5 menit, user_agent); cookie `hgchat_session` HttpOnly/SameSite=Lax/Secure di https; `POST /logout`; `GET /api/me`; sesi kedaluwarsa dihapus saat dipakai + purge per jam. Ditemukan & diperbaiki: proxy `/v1/*` meneruskan cookie browser ke gateway — kini header cookie dibuang — done
- 2026-10-18 T-009: rate limit in-memory 5 gagal/15 menit per IP (CF-Connecting-IP hanya dipercaya dari loopback) dan per username → 429 + Retry-After; login sukses hanya mereset counter username — done
- 2026-10-18 T-010: `scripts/users.js` add/reset-password/disable/enable/revoke-sessions/list; password via prompt tersembunyi atau stdin (bukan argumen); disable & reset-password mengakhiri sesi; `npm run dev:users` untuk DB dev — done
- 2026-10-18 T-011: layar PIN + ripple dihapus dari `public/index.html`/`app.js`; sidebar menampilkan nama user + tombol Keluar; `login.html` menampilkan pesan 429; Basic auth, `CHAT_USER`/`CHAT_PASS`/`CHAT_SECRET`, header CORS, dan handler OPTIONS dihapus. Server menolak start tanpa user aktif (kecuali dev) — done
- 2026-10-18 Test: 22 test node:test (8 unit auth, 5 config, 9 end-to-end atas server.js asli: dua user bersamaan, cookie flags, 401/429, logout, disable/revoke via CLI langsung berlaku, tanpa CORS/PIN/Basic). `test.sh` smoke kini membuat akun sekali pakai dan login. `npm run gates` PASS (2 warning: PIN di file root lama yang dihapus setelah restart; proxy /v1/* → EPIC-002) — done
- 2026-10-18 Status → ready-for-qa. QA/rilis manusia: merge `epic-001` ke `main`, buat akun tim dengan `node scripts/users.js add …` SEBELUM restart (server menolak start tanpa user), restart, uji login dua orang + chat + Keluar di agents.herrygunawan.com — ready-for-qa
- 2026-10-18 Rilis: `epic-001` di-fast-forward ke `main` (22d43e5); user membuat akun ilham (admin), irfan, cahyo sebagai `hg`; restart 21:41 WIB (PID 154374, NRestarts=0). Dicek dari server: login salah → 401, `/api/me` anonim → 401, Basic auth dengan kredensial bersama lama → 401, tanpa header CORS, DB `data/chat-center.db` 600 milik hg (dir `data/` → 700). Belum: login sungguhan dari browser (semua akun 0 sesi) — ready-for-qa
- 2026-10-18 QA: user login, chat, dan Keluar dari browser di agents.herrygunawan.com — berhasil — done
- 2026-10-18 Hotfix (laporan user setelah rilis EPIC-002/007): login berhasil di server (sesi tercatat 22:22:45) tapi browser kembali ke /login saat dibuka lewat http:// ("Not Secure"). Penyebab: situs bisa diakses via http dan https; cookie sesi `Secure` dari kunjungan https tidak boleh ditimpa dari halaman http dan tidak dikirim lewat http. Perbaikan: pengunjung lewat Cloudflare dengan skema http (CF-Visitor / X-Forwarded-Proto, hanya dipercaya dari loopback) diarahkan 308 ke https (path+query utuh, Host divalidasi); flag Secure kini mengikuti CF-Visitor. Sekalian: logo di halaman login rusak karena `/assets/hg-logo.png` butuh login → kini satu-satunya aset publik (foto agent tetap privat). 6 test baru (`test/https.test.js`), total 43 PASS — done
- 2026-10-18 Hotfix di `main` (6ebbe10) tapi BELUM aktif: service masih PID 206012 (22:19). User berhasil login dengan membuka https langsung. Perlu restart agar http→https dan logo login aktif — pending restart

## Dependencies

- EPIC-000 (git + struktur file).
