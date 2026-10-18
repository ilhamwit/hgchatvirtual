# EPIC-010: Task Focus — Tugas Tim

status: on-progress
environment: dev
phase: 2
priority: P1
area: Fullstack
retries: 0
prd: ../product/PRD.md
stories: US-TSK-1 … US-TSK-6
tasks: T-053 … T-061

## Goal

Menu **Task Focus** (saat ini hanya hiasan) menjadi daftar tugas tim yang
sederhana untuk pengguna high-level: siapa mengerjakan apa, kapan tenggatnya,
dan apa yang harus saya fokuskan hari ini. Agent membantu membuat dan
mengerjakan tugas; bot WhatsApp mengingatkan.

Keputusan pemilik (2026-10-19):
- Tugas disimpan di Chat Center sendiri, **bukan** Kanban Hermes
  (`~/.hermes/kanban.db` kosong dan dirancang untuk dispatch antar-agent —
  terlalu teknis, pelajaran yang sama dengan cron di EPIC-009).
- **Semua tugas terlihat oleh seluruh tim**; semua user login boleh membuat dan
  mengubah tugas.
- Pengingat: **ringkasan harian ke satu grup WhatsApp** dulu; DM pribadi
  menyusul setelah nomor WhatsApp per user tersedia.
- **Agent tidak pernah menandai tugas selesai** — agent hanya mengusulkan dan
  membantu; manusia yang menandai selesai.

## User Stories

- **US-TSK-1** — Sebagai anggota tim, saya ingin menambah tugas dengan cepat (cukup judulnya), lalu melengkapi penanggung jawab dan tenggat.
- **US-TSK-2** — Sebagai anggota tim, saya ingin melihat fokus saya: yang terlambat, hari ini, minggu ini.
- **US-TSK-3** — Sebagai anggota tim, saya ingin melihat papan tugas seluruh tim per status dan per orang.
- **US-TSK-4** — Sebagai anggota tim, saya ingin berdiskusi di tugas (komentar) dan melihat riwayat perubahannya.
- **US-TSK-5** — Sebagai anggota tim, saya ingin tindak lanjut meeting / ringkasan grup diusulkan agent menjadi tugas, dan meminta bantuan agent untuk sebuah tugas.
- **US-TSK-6** — Sebagai anggota tim, saya ingin tim diingatkan lewat WhatsApp tentang tugas hari ini dan yang terlambat.

## Tasks

### Tahap 1 — daftar tugas tim

- [x] **T-053** Data tugas (migrasi DB): judul, catatan, penanggung jawab, tenggat (tanggal WIB), prioritas, status (belum/dikerjakan/selesai), pembuat, selesai oleh/kapan; aktivitas (komentar + riwayat perubahan). API daftar/buat/ubah/hapus/komentar.
- [x] **T-054** Halaman **Fokus saya**: tambah cepat; kelompok Terlambat / Hari ini / Minggu ini / Nanti / Tanpa tenggat; centang selesai; selesai hari ini.
- [x] **T-055** **Papan tim**: kolom Belum / Dikerjakan / Selesai, filter per orang, pindah status dengan seret.
- [x] **T-056** Detail tugas: ubah semua isian, komentar, riwayat ("Irfan mengubah tenggat menjadi …").
- [x] **T-057** Badge sidebar Task Focus = tugas saya yang terlambat + hari ini (badge palsu "3" di Chat & Discussion dihapus).

### Tahap 2 — agent membantu

- [ ] **T-058** Dari acara Schedule / ringkasan grup → Aurix mengusulkan tindak lanjut (judul, orang, tenggat) → user mencentang mana yang dibuat.
- [ ] **T-059** "Minta bantuan agent" di tugas: buka chat dengan agent pilihan berisi konteks tugas; hasil bisa disimpan sebagai komentar.

### Tahap 3 — pengingat WhatsApp

- [ ] **T-060** Ringkasan harian 08.00 WIB ke grup pilihan: tugas hari ini per orang + yang terlambat.
- [ ] **T-061** Pengingat tenggat (H-1, hari H); DM pribadi setelah nomor per user tersedia.

## Acceptance Criteria

**Epic-level**

- Semua user login melihat semua tugas; tidak ada yang bisa diakses tanpa login.
- Status "selesai" hanya berubah oleh tindakan manusia.
- Tanggal "hari ini / terlambat" dihitung dalam WIB.

**Per-task**

- **T-053** — Judul kosong ditolak; penanggung jawab harus user aktif; tenggat harus tanggal valid; hapus hanya oleh pembuat atau admin; setiap perubahan tercatat di riwayat.
- **T-054** — Tugas tanpa penanggung jawab ditugaskan ke pembuatnya; tugas jatuh di kelompok yang benar; centang → pindah ke "Selesai hari ini".
- **T-055** — Seret kartu ke kolom lain mengubah status dan tercatat; filter orang bekerja.
- **T-056** — Komentar tampil berurutan dengan nama dan waktu.
- **T-057** — Badge sesuai jumlah, hilang bila 0, diperbarui setelah perubahan.

## Automation Log

- 2026-10-19 Epic dibuat atas permintaan pemilik ("catat sebagai EPIC-010 dan mulai tahap 1"), dengan keputusan default di atas. Riset: `~/.hermes/kanban.db` ada tetapi semua tabel kosong (tasks, task_runs, …) → tidak dipakai — on-progress
- 2026-10-19 Tahap 1 selesai (T-053…T-057). Skema v6: `tasks` + `task_activity`. `lib/tasks.js`: validasi (judul wajib, penanggung jawab = user aktif, tenggat tanggal valid, prioritas/status enum), tanpa penanggung jawab → pembuat, riwayat kalimat per perubahan ("Cahyo mengubah tenggat menjadi 22 Okt 2026"), selesai dicap `done_by/done_at`, hapus hanya pembuat/admin (403), selesai >14 hari tidak tampil, ringkasan badge (terlambat + hari ini, WIB). API `/api/tasks…` (login wajib). UI `#tasks`: Fokus saya (Terlambat/Hari ini/7 hari ke depan/Nanti/Tanpa tenggat/Selesai hari ini), Papan tim (3 kolom, filter orang, seret untuk ubah status), panel detail (status, penanggung jawab, tenggat, prioritas, catatan, komentar & riwayat, hapus dengan konfirmasi), sapaan + angka hari ini. Badge sidebar asli (merah bila ada yang terlambat, refresh 5 menit); badge palsu "3" di Chat & Discussion dihapus. Tes 92/92 (6 baru untuk tasks, juga lulus dengan TZ=UTC), gates PASS, screenshot sandbox. Perlu restart chat-center.

## Dependencies

- EPIC-001 (akun per orang), EPIC-009 (acara, untuk tahap 2), EPIC-008/009 (bot WhatsApp, untuk tahap 3).
