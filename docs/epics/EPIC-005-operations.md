# EPIC-005: Operasional — Backup, Health, Log

status: backlog
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

- [ ] **T-028** `GET /healthz` (tanpa auth) yang memeriksa DB dan `GET /health` Hermes (127.0.0.1:8642); dipakai untuk uptime check.

### Logging & audit

- [ ] **T-029** Log terstruktur satu baris per request (method, path, status, durasi, user_id) ke journald; tanpa isi pesan, token, atau cookie.
- [ ] **T-030** Tabel `audit_log` untuk login berhasil/gagal, perubahan user, dan revoke sesi.

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

## Dependencies

- EPIC-001, EPIC-002.
