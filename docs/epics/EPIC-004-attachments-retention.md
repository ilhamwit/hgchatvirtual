# EPIC-004: Lampiran per Percakapan + Retensi

status: backlog
environment: dev
phase: 2
priority: P1
area: Backend
retries: 0
prd: ../product/PRD.md
stories: -
tasks: T-024 … T-026

## Goal

Lampiran tercatat milik siapa dan di percakapan mana, bisa dilihat lagi oleh
pemiliknya, dan tidak menumpuk selamanya. Saat ini file masuk ke
`~/.openclaw/media/inbound` tanpa catatan pemilik, tidak bisa diunduh ulang dari
UI, dan tidak pernah dibersihkan.

## User Stories

- **US-ATT-1** — Sebagai anggota tim, saya ingin membuka lagi file yang pernah saya lampirkan di sebuah percakapan.
- **US-ATT-2** — Sebagai admin, saya ingin lampiran lama dibersihkan otomatis, supaya disk tidak penuh.

## Tasks

### Metadata lampiran

- [ ] **T-024** Tabel `attachments` (id, user_id, conversation_id, original_name, stored_path, size, mime, created_at); `/upload` mewajibkan `conversation_id` milik user.

### Unduh ulang

- [ ] **T-025** `GET /api/attachments/:id` hanya untuk pemilik, dengan `Content-Disposition: attachment` dan `X-Content-Type-Options: nosniff`.

### Retensi

- [ ] **T-026** Job harian menghapus lampiran lebih tua dari `CHAT_ATTACHMENT_RETENTION_DAYS` (default 90) beserta barisnya; pesan tetap menampilkan "lampiran kedaluwarsa".

## Acceptance Criteria

**Epic-level**

- Setiap file di folder media punya baris di DB, dan sebaliknya.
- User lain tidak bisa mengunduh lampiran yang bukan miliknya.

**Per-task**

- **T-024** — upload tanpa `conversation_id` valid → 400.
- **T-025** — user B meminta lampiran user A → 404.
- **T-026** — dry-run menampilkan daftar yang akan dihapus sebelum mode nyata.

## Automation Log

- 2026-10-18 Epic dibuat; temuan: lampiran inbound tanpa pemilik dan tanpa retensi — backlog

## Dependencies

- EPIC-002.
