# HG Chat Center — Roadmap & Backlog

> **Seed list only.** Status kerja yang hidup ada di [`epics/README.md`](epics/README.md);
> bila berbeda, **epic yang menang**. Draft dari `/agentic-init` 2026-10-18.

**Priority:** **P0** = MVP-blocking · **P1** = core product · **P2** = follow-on / integration.
**MVP** = EPIC-000 → EPIC-002.

Semua seed di bawah sudah dipromosikan menjadi task di epic masing-masing.

---

## Phase 0 · Fondasi _(EPIC-000)_

- [x] **P0** (Infra) Git + `.gitignore` + commit awal — T-001
- [x] **P0** (Frontend) Pecah HTML 194 KB jadi HTML/CSS/JS/aset — T-002, T-003
- [x] **P0** (Infra) `.env.example`, validasi env, instance dev — T-004, T-005

## Phase 1 · Multi-user & riwayat server _(EPIC-001, EPIC-002)_

- [x] **P0** (Backend) Akun per orang, scrypt, sesi revocable, rate limit — T-006 … T-009
- [x] **P0** (Backend) CLI admin user; hapus PIN, Basic auth bersama, CORS `*` — T-010, T-011
- [x] **P0** (Backend) Tabel percakapan/pesan + API `/api/...` — T-012, T-013
- [x] **P0** (Backend) Sesi agent (Hermes) per percakapan + atribusi pengirim — T-014, T-015
- [x] **P0** (Backend) Tutup proxy `/v1/*` — T-016
- [x] **P0** (Frontend) UI pakai API server + "Chat baru" + impor localStorage — T-017, T-018

## Phase 2 · Harian _(EPIC-003, EPIC-004, EPIC-005)_

- [ ] **P1** (Frontend) Streaming SSE + Stop — T-019
- [ ] **P1** (Frontend) Daftar & pencarian percakapan — T-020, T-021
- [ ] **P1** (Frontend) Buang UI hiasan; data agent dari server — T-022, T-023
- [ ] **P1** (Backend) Lampiran milik user/percakapan, unduh ulang, retensi — T-024 … T-026
- [x] **P1** (Infra) Backup SQLite, `/healthz`, log, audit — T-027 … T-030

## Phase 3 · Kerja tim _(EPIC-006)_

- [ ] **P2** (Product) Discovery alur kerja tim — T-031
- [ ] **P2** (Backend) Integrasi Backstage, ringkasan harian, percakapan bersama — T-032 … T-034
