# EPIC-005: Operasional — Backup, Health, Log

status: ready-for-qa
environment: dev
phase: 2
priority: P1
area: Infra
retries: 0
prd: ../product/PRD.md
stories: -
tasks: T-027 … T-030

## Goal

Begitu riwayat tim tersimpan di server, data itu harus aman dan masalah harus
cepat ketahuan. Saat ini tidak ada backup, tidak ada endpoint health, dan log
hanya baris start di journald.

## User Stories

- **US-OPS-1** — Sebagai admin, saya ingin DB di-backup otomatis, supaya riwayat tim tidak hilang saat disk rusak atau salah hapus.
- **US-OPS-2** — Sebagai admin, saya ingin tahu kalau Chat Center atau Hermes mati.

## Tasks

### Backup

- [ ] **T-027** Backup harian SQLite (`VACUUM INTO` ke file bertanggal) lewat systemd timer, simpan 14 hari; salinan ke Nextcloud yang sudah ada; prosedur restore teruji dan tertulis di README.

### Health & monitoring

- [x] **T-028** `GET /healthz` (tanpa auth) yang memeriksa DB dan `GET /health` Hermes (127.0.0.1:8642); dipakai untuk uptime check.

### Logging & audit

- [x] **T-029** Log terstruktur satu baris per request (method, path, status, durasi, user_id) ke journald; tanpa isi pesan, token, atau cookie.
- [x] **T-030** Tabel `audit_log` untuk login berhasil/gagal, perubahan user, dan revoke sesi.

## Acceptance Criteria

**Epic-level**

- Restore dari backup kemarin berhasil di instance dev.
- Gateway dimatikan → `/healthz` mengembalikan 503 dalam < 5 detik.

**Per-task**

- **T-027** — file backup bisa dibuka `sqlite3` dan jumlah pesan cocok.
- **T-029** — `journalctl -u chat-center` tidak memuat isi pesan atau token.
- **T-030** — login gagal tercatat dengan IP dan username.

## Automation Log

- 2026-10-18 Epic dibuat — backlog
- 2026-10-18 Status → on-progress; worktree `../chat-center-epic-005` — on-progress
- 2026-10-18 T-027: `scripts/backup.js` — `VACUUM INTO` dari koneksi read-only (tidak pernah migrasi/ubah DB live), file 600 di `data/backups/` (dir 700), cek `integrity_check` + jumlah baris SEBELUM pruning, retensi 14 hari berdasar nama file, salinan kedua opsional `CHAT_BACKUP_COPY_DIR`, `--verify FILE`. Dicoba ke DB production asli: 64 KB, users=4 conversations=6 messages=22 sama dengan live, hash DB live tidak berubah. Timer harian 03:15 (`deploy/systemd/chat-center-backup.{service,timer}`, user unit, Persistent) + `scripts/install-backup-timer.sh`; `systemd-analyze verify` OK, linger aktif. Prosedur restore di README; diuji otomatis (server dijalankan di atas hasil restore → login + riwayat sama). Belum: timer belum dipasang (menunggu OK user); salinan ke Nextcloud menunggu keputusan lokasi — implemented
- 2026-10-18 T-028: `GET /healthz` publik → 200 `{ok,db,hermes}` atau 503; cek Hermes timeout 3 dtk (diuji: Hermes mati → 503 < 5 dtk) — done
- 2026-10-18 T-029: satu baris `req METHOD path status ms user= ip=` per request ke journald; tanpa query string/cookie/body; /healthz yang sukses tidak dicatat. Diuji: token di query, cookie, dan password tidak muncul di log — done
- 2026-10-18 T-030: migrasi 3 `audit_log` (180 hari, purge per jam): login_ok/login_failed/login_throttled/logout (dengan IP) dan perubahan akun dari CLI (dengan user OS); `node scripts/users.js audit [N]`. Password yang dicoba tidak pernah disimpan. Migrasi v2→v3 diuji pada salinan DB production — done
- 2026-10-18 Test: 8 test baru (`test/ops.test.js`), total 51 PASS; gate PASS, security 0 warning — done
- 2026-10-18 Status → ready-for-qa. Rilis: merge → restart chat-center (migrasi 3 otomatis) → pasang timer (`bash scripts/install-backup-timer.sh`) → cek `/healthz` dan backup pertama — ready-for-qa
- 2026-10-18 Rilis lewat `scripts/restart.sh` (user): gate PASS, PID 221120 → 240756, schema v3, `/healthz` lokal & publik `{"ok":true,"db":"ok","hermes":"ok"}`. Tersisa: pasang timer backup (menunggu OK user) — ready-for-qa

## Dependencies

- EPIC-001, EPIC-002.
