# EPIC-014: Settings — Pengaturan Tim

status: ready-for-qa
environment: dev
phase: 2
priority: P1
area: Fullstack
retries: 0
prd: ../product/PRD.md
stories: US-SET-1 … US-SET-4
tasks: T-083 … T-087

## Goal

Menu **Settings** (hiasan) menjadi pusat pengaturan tim untuk admin: akun
anggota (hari ini hanya lewat terminal `scripts/users.js`), API key integrasi
(pindah dari halaman Profil), dan status sistem. Setiap orang juga bisa
mengganti password sendiri di Profil.

Keputusan desain: password sementara **dibuat server** dan ditampilkan sekali
(seperti API key), bukan diketik admin — tidak ada password orang lain yang
lewat tangan admin. Pengguna disarankan menggantinya di Profil.

## User Stories

- **US-SET-1** — Sebagai admin, saya ingin menambah anggota, menjadikan admin/member, menonaktifkan, dan mereset password dari web.
- **US-SET-2** — Sebagai admin, saya ingin mengelola API key integrasi di satu tempat dengan pengaturan tim lain.
- **US-SET-3** — Sebagai admin, saya ingin melihat status sistem: server, database, backup terakhir, Hermes, bot WhatsApp.
- **US-SET-4** — Sebagai anggota, saya ingin mengganti password saya sendiri.

## Tasks

- [x] **T-083** API admin akun tim: daftar (peran, status, sesi aktif, terakhir terlihat), tambah (password sementara dibuat server), ubah peran, nonaktifkan/aktifkan, reset password (sementara, sekali tampil), akhiri sesi. Admin tidak bisa menonaktifkan/menurunkan dirinya sendiri; admin terakhir tidak bisa diturunkan.
- [x] **T-084** API status sistem (admin): versi aplikasi (commit), skema DB, ukuran DB, uptime, backup terakhir, Hermes, bridge WhatsApp, jumlah akun/sesi.
- [x] **T-085** Halaman **Settings** (admin): tab Akun tim, Integrasi API (dipindah dari Profil), Sistem. Member melihat pesan "hanya admin".
- [x] **T-086** Profil: ganti password sendiri (password lama + baru, sesi lain diakhiri).
- [x] **T-087** `scripts/users.js` tetap bekerja (sumber yang sama), README diperbarui.

## Acceptance Criteria

- Semua endpoint admin: member → 403; tanpa login → 401.
- Password sementara tidak pernah tersimpan/terlihat selain sekali di layar admin; audit mencatat tindakan tanpa password.
- Menonaktifkan akun mengakhiri sesinya seketika (sudah dijamin `setDisabled`).
- Ganti password sendiri: password lama salah → 400; sukses → sesi lain berakhir, sesi ini tetap.

## Automation Log

- 2026-10-19 Epic dibuat atas persetujuan pemilik (urutan: Settings → Reports → Automation → Performance) — on-progress
- 2026-10-19 T-083…T-087 selesai. `lib/settings.js` (akun tim: tambah dengan password sementara 14 karakter dibuat server & tampil sekali, ubah peran, nonaktifkan/aktifkan, reset password, akhiri sesi; pagar: bukan untuk diri sendiri, admin terakhir tidak bisa diturunkan/dinonaktifkan; status sistem: commit, skema, ukuran DB, uptime, backup terakhir, Hermes, bridge WA, hitungan; ganti password sendiri → sesi lain berakhir, cookie sesi ini diterbitkan ulang). API `/api/settings/*` (admin), `POST /api/profile/password` (server.js, karena memasang cookie). Audit via `scripts/users.js audit` menampilkan tindakan web (`by <admin> (web)`) tanpa password. UI: halaman Settings (tab Akun tim / Integrasi API / Sistem; member melihat pesan hanya admin), kartu Integrasi API dipindah dari Profil, kartu Ganti password di Profil. Tes 131/131 (4 baru + UI), gates PASS, screenshot sandbox. Sisa: QA pemilik.
- 2026-10-19 Restart oleh agent: PID 910227 → 924955, gates PASS, `/healthz` ok — live, menunggu QA pemilik.

## Dependencies

- EPIC-001 (akun), EPIC-005 (audit, backup), EPIC-013 (API key).
