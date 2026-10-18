# EPIC-011: Sesi Chat per Agent & Pratinjau File

status: ready-for-qa
environment: dev
phase: 2
priority: P1
area: Fullstack
retries: 0
prd: ../product/PRD.md
stories: US-CHS-1 … US-CHS-4
tasks: T-062 … T-066

## Goal

Panel **Chat History** saat ini mencampur semua agent. Permintaan pemilik
(2026-10-19): riwayat mengikuti agent yang dipilih — klik Dave, yang tampil
hanya sesi chat dengan Dave — dan setiap agent bisa punya banyak sesi. Sesi bisa
diganti nama, diarsipkan / dikeluarkan dari arsip, atau dihapus lewat klik
kanan pada kartu. Lampiran di chat (gambar, PDF, dan file lain) bisa dibuka
langsung dalam popup seperti di WhatsApp.

## User Stories

- **US-CHS-1** — Sebagai anggota tim, saya ingin riwayat chat hanya berisi sesi dengan agent yang sedang saya pilih.
- **US-CHS-2** — Sebagai anggota tim, saya ingin membuat banyak sesi dengan satu agent dan berpindah di antaranya.
- **US-CHS-3** — Sebagai anggota tim, saya ingin mengganti nama, mengarsipkan, mengeluarkan dari arsip, dan menghapus sesi lewat klik kanan.
- **US-CHS-4** — Sebagai anggota tim, saya ingin membuka lampiran (gambar, PDF, teks) dalam popup tanpa mengunduh.

## Tasks

- [x] **T-062** Panel riwayat per agent: hanya sesi agent terpilih, judul sesi + cuplikan + waktu, tombol sesi baru, bagian "Arsip".
- [x] **T-063** Menu klik kanan (dan tombol ⋯ untuk layar sentuh) pada kartu: Ganti nama (langsung di kartu), Arsipkan / Keluarkan dari arsip, Hapus (dengan konfirmasi). API hapus sesi; sesi yang sedang dijawab agent tidak bisa dihapus.
- [x] **T-064** Sesi yang diarsipkan bisa dibuka dan dibaca; mengirim pesan di sana mengeluarkannya dari arsip.
- [x] **T-065** Endpoint file lampiran (login + pemilik sesi saja): tipe konten aman (teks selalu `text/plain`), `nosniff`, sandbox CSP, opsi unduh.
- [x] **T-066** Pratinjau di chat: gambar tampil sebagai thumbnail di gelembung; klik → popup (gambar besar, PDF di viewer, teks/CSV/JSON/Markdown dibaca langsung); file Office/HEIC → kartu file + tombol unduh.

## Acceptance Criteria

**Epic-level**

- Sesi dan file milik orang lain tidak pernah terlihat (404).
- Menghapus sesi menghapus pesannya di Chat Center; tidak ada yang hilang tanpa konfirmasi.

**Per-task**

- **T-062** — Pindah agent mengganti isi riwayat; sesi baru muncul paling atas setelah pesan pertama.
- **T-063** — Ganti nama tersimpan di server; arsip/kembalikan memindahkan kartu antar bagian; hapus sesi yang sedang berjalan ditolak (409).
- **T-065** — File yang tidak ada di pesan milik user → 404; nama di luar folder lampiran → 404; HTML/SVG tidak pernah dirender sebagai halaman.
- **T-066** — Gambar, PDF, dan teks terbuka di popup; Esc / klik di luar menutup popup; tombol unduh bekerja.

## Automation Log

- 2026-10-19 Epic dibuat atas permintaan pemilik (riwayat per agent, banyak sesi, klik kanan ganti nama/arsip/hapus, pratinjau file seperti WA). Riset: `lib/conversations.js` sudah mendukung filter agent, `archived`, dan ganti judul; belum ada hapus. Lampiran disimpan di folder media (`<slug>---<uuid>.<ext>`) dan belum pernah disajikan lewat HTTP. LibreOffice tidak terpasang → pratinjau Word/Excel/PowerPoint belum bisa (unduh saja); `pdftoppm` ada — on-progress
- 2026-10-19 T-062…T-066 selesai. Server: `DELETE /api/conversations/:id` (pemilik saja, 409 bila agent masih menjawab), kirim pesan di sesi arsip → keluar dari arsip, `GET /api/files/<nama-upload>` hanya untuk lampiran di pesan milik user (lainnya 404): gambar/PDF inline, teks selalu `text/plain`, Office/HEIC hanya unduh, `nosniff`, CSP sandbox (kecuali PDF). UI: riwayat hanya sesi agent terpilih (judul `Chat History · Dave`), bagian Arsip, menu klik kanan + tombol ⋯ (ganti nama di kartu, arsip/keluarkan, hapus dengan dialog konfirmasi), banner sesi arsip; lampiran: thumbnail gambar di gelembung, popup penampil (galeri ← →, PDF viewer browser, tabel CSV/TSV, JSON rapi, Markdown, teks; Word/Excel → kartu unduh), Esc/klik luar menutup. Tes 97/97 (4 baru + 1 UI; tes lama "DELETE → 405" diganti karena hapus sesi kini fitur), gates PASS, screenshot sandbox. Catatan: hapus sesi tidak menghapus transkrip di Hermes (state.db milik Hermes) maupun file lampiran di folder media — ready-for-qa

## Dependencies

- EPIC-002 (percakapan di server), EPIC-004 (lampiran).
