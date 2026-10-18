# EPIC-003: Streaming & UX Percakapan

status: backlog
environment: dev
phase: 2
priority: P1
area: Frontend
retries: 0
prd: -
stories: -
tasks: T-019 … T-023

## Goal

Antarmuka yang jujur dan nyaman dipakai harian: balasan muncul bertahap, semua
percakapan mudah ditemukan, dan tidak ada tombol yang tidak melakukan apa-apa.
Saat ini balasan baru tampil setelah selesai (bisa sampai 4 menit), dan menu
Task Focus, Schedule, Performance, Reports, Automation, Settings, tab
Prompt/Agent, pemilih model, mikrofon, dan pencarian hanya hiasan.

## User Stories

- **US-UX-1** — Sebagai anggota tim, saya ingin melihat balasan agent muncul saat sedang ditulis, supaya tahu agent sedang bekerja.
- **US-UX-2** — Sebagai anggota tim, saya ingin daftar percakapan yang bisa dicari, diberi nama, dan diarsipkan.
- **US-UX-3** — Sebagai anggota tim, saya ingin setiap tombol di layar benar-benar berfungsi.

## Tasks

### Streaming

- [ ] **T-019** Server memanggil gateway dengan `stream: true` dan meneruskan SSE ke klien; teks tersimpan ke DB saat selesai (atau sebagian bila dihentikan); tombol Stop membatalkan upstream.

### Daftar percakapan

- [ ] **T-020** Sidebar daftar percakapan (per agent, urut terbaru), judul otomatis dari pesan pertama, ganti nama, arsip.
- [ ] **T-021** Pencarian di topbar mencari judul + isi pesan milik user (SQLite FTS5 bila tersedia, fallback `LIKE`).

### Bersih-bersih UI

- [ ] **T-022** Buang atau sembunyikan elemen hiasan (menu sidebar, tab Prompt/Agent, model selector, mic, badge counter palsu) sampai ada fitur nyata di baliknya.
- [ ] **T-023** Selaraskan nama/role/sapaan agent dengan identitas di workspace OpenClaw (`IDENTITY.md`); sumber data dari `GET /api/agents`, bukan hardcode. Lengkapi identitas Nana.

## Acceptance Criteria

**Epic-level**

- Token pertama tampil < 3 detik setelah gateway mulai membalas.
- Tidak ada elemen yang bisa diklik tanpa efek.
- Percakapan lama bisa ditemukan lewat pencarian.

**Per-task**

- **T-019** — Stop di tengah stream → upstream dibatalkan, teks parsial tersimpan dan ditandai "dihentikan".
- **T-020** — arsip menyembunyikan percakapan tanpa menghapus.
- **T-021** — pencarian tidak pernah mengembalikan pesan user lain.
- **T-023** — mengubah role agent cukup di satu tempat.

## Automation Log

- 2026-10-18 Epic dibuat dari audit UI (7 menu + kontrol topbar hanya hiasan) — backlog

## Dependencies

- EPIC-002 (API percakapan).
