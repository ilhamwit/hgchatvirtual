# EPIC-012: Chat & Discussion — Ruang Diskusi Tim

status: on-progress
environment: dev
phase: 2
priority: P1
area: Fullstack
retries: 0
prd: ../product/PRD.md
stories: US-DSC-1 … US-DSC-7
tasks: T-067 … T-076

## Goal

Menu **Chat & Discussion** (saat ini hanya membuka chat agent, dengan badge
palsu yang sudah dihapus di EPIC-010) menjadi **ruang diskusi tim**: channel
per topik dan pesan langsung antar anggota, real-time, dengan badge belum
dibaca yang asli. Agent bisa dipanggil ke diskusi (tahap 2). Chat empat mata
dengan agent tetap di bagian **Agents** sidebar.

Keputusan pemilik (2026-10-19, menyetujui usulan):
1. Halaman pertama setelah login tetap chat agent; Chat & Discussion dibuka dari menu dan ber-badge.
2. Semua channel terbuka untuk seluruh tim; privat hanya DM. (Tim kecil → setiap orang otomatis "anggota" semua channel; tidak ada join/leave.)
3. Agent di channel hanya menjawab saat di-@sebut (tahap 2).
4. Pesan sendiri boleh diedit/dihapus kapan saja, dengan tanda "(diedit)" / "pesan dihapus".

## User Stories

- **US-DSC-1** — Sebagai anggota tim, saya ingin berdiskusi di channel per topik.
- **US-DSC-2** — Sebagai anggota tim, saya ingin mengirim pesan langsung ke satu rekan.
- **US-DSC-3** — Sebagai anggota tim, saya ingin pesan baru muncul langsung tanpa refresh dan tahu mana yang belum saya baca.
- **US-DSC-4** — Sebagai anggota tim, saya ingin menyebut rekan dengan @nama agar dia tahu.
- **US-DSC-5** — Sebagai anggota tim, saya ingin membalas dalam utas, melampirkan file, dan mengedit/menghapus pesan saya.
- **US-DSC-6** — Sebagai anggota tim, saya ingin memanggil agent ke diskusi dan meringkas diskusi.
- **US-DSC-7** — Sebagai anggota tim, saya ingin diberi tahu saat di-@sebut walau tidak sedang membuka web.

## Tasks

### Tahap 1 — diskusi tim

- [x] **T-067** Data (migrasi DB): channel, DM, pesan (utas, lampiran, edit/hapus), sebutan, posisi baca per orang; channel awal `#umum`.
- [x] **T-068** API: daftar ruang + jumlah belum dibaca/sebutan, buat channel, buka DM, pesan (halaman per 50, utas), kirim/edit/hapus, tandai dibaca. DM hanya untuk kedua anggotanya.
- [x] **T-069** Real-time lewat Server-Sent Events (`/api/stream`): pesan baru/edit/hapus, channel baru, siapa yang online; sesi kedaluwarsa/keluar → stream ditutup.
- [x] **T-070** Halaman Chat & Discussion: daftar channel + DM (online, belum dibaca, @), percakapan per hari, utas di panel kanan, lampiran + pratinjau, @sebut dengan saran nama, edit/hapus pesan sendiri.
- [x] **T-071** Badge sidebar asli (belum dibaca; tanda @ bila disebut), diperbarui real-time di halaman mana pun.

### Tahap 2 — agent ikut diskusi

- [ ] **T-072** @Dave/@Nana… di channel → agent menjawab di utas dengan konteks percakapan terakhir.
- [ ] **T-073** "Ringkas diskusi" oleh Aurix untuk rentang waktu.
- [ ] **T-074** Dari pesan: Jadikan tugas (Task Focus) / Buat acara (Schedule).

### Tahap 3 — notifikasi

- [ ] **T-075** Notifikasi browser saat di-@sebut / DM.
- [ ] **T-076** Notifikasi WhatsApp untuk @sebut / DM (perlu nomor per user).

## Acceptance Criteria

**Epic-level**

- DM tidak pernah terlihat atau terkirim (API maupun stream) ke selain kedua anggotanya.
- Semua fitur hanya untuk user login; stream berhenti saat sesi berakhir.

**Per-task**

- **T-067/T-068** — Nama channel unik (huruf kecil, angka, `-`); pesan kosong ditolak; edit/hapus hanya pesan sendiri; pesan dihapus tetap tampil sebagai "pesan dihapus" tanpa isi/lampiran.
- **T-069** — Pesan dari satu browser muncul di browser lain < 2 detik tanpa refresh; lewat Cloudflare.
- **T-070** — @nama hanya menyebut user aktif; utas menampilkan jumlah balasan; lampiran terbuka di popup.
- **T-071** — Badge = jumlah pesan orang lain yang belum dibaca; hilang saat dibaca.

## Automation Log

- 2026-10-19 Epic dibuat; pemilik menyetujui usulan (empat keputusan di atas) — on-progress
- 2026-10-19 Tahap 1 selesai (T-067…T-071). Skema v7: `rooms` (channel/dm), `room_members` (dm), `room_messages` (utas, lampiran, edit/hapus lunak), `room_mentions`, `room_reads`; `#umum` dibuat oleh migrasi. `lib/rooms.js` + `lib/hub.js` (SSE `/api/stream`: pesan/edit/hapus/channel/baca/presence; DM hanya ke dua anggota; heartbeat 25 dtk memeriksa sesi → logout menutup stream). `/api/files` juga melayani lampiran di ruang yang boleh dilihat user. UI `#discuss`: channel + DM (online, belum dibaca, @), pesan per hari & dikelompokkan per pengirim, utas di panel kanan, @sebut dengan saran nama (↑↓ Enter), lampiran + penampil, edit/hapus pesan sendiri, buat channel, ubah topik; badge sidebar real-time di semua halaman. Tes 103/103 (5 baru termasuk stream dua-arah + privasi DM, 1 UI), gates PASS. Screenshot sandbox dengan dua browser terpisah: pesan Irfan muncul di layar Ilham tanpa refresh, badge "@7" turun saat dibaca.

## Dependencies

- EPIC-001 (akun), EPIC-011 (lampiran + penampil file), EPIC-010/009 (tahap 2).
