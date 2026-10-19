# EPIC-015: Reports — Laporan dari Agent

status: ready-for-qa
environment: dev
phase: 2
priority: P1
area: Fullstack
retries: 0
prd: ../product/PRD.md
stories: US-RPT-1 … US-RPT-4
tasks: T-088 … T-093

## Goal

Menu **Reports** (badge "5" palsu) menjadi arsip semua laporan yang dihasilkan
agent, di satu tempat dan bisa dibaca kapan saja: ringkasan grup WhatsApp
(Summary Chat), hasil otomatis bot tiap 6 jam (cron Hermes `wa-group-summary`
yang selama ini tidak terlihat di web), ringkasan diskusi (yang sekarang hilang
saat dialog ditutup), dan **laporan mingguan tim** oleh Aurix yang dibuat
otomatis tiap Senin pagi. Badge = laporan yang belum dibaca.

Permintaan pemilik: UI dirapikan dan **konsisten** — tidak ada komponen yang
tampil beda dari gaya halaman lain.

## User Stories

- **US-RPT-1** — Sebagai anggota tim, saya ingin membaca semua laporan agent di satu tempat, tanpa harus mencarinya di WhatsApp atau membuat ulang.
- **US-RPT-2** — Sebagai anggota tim, saya ingin laporan mingguan tim otomatis: tugas selesai/terlambat, acara, topik diskusi.
- **US-RPT-3** — Sebagai anggota tim, saya ingin tahu ada laporan baru (badge) dan bisa mengirim laporan ke grup WhatsApp.
- **US-RPT-4** — Sebagai anggota tim, saya ingin tampilan yang rapi dan seragam di semua halaman.

## Tasks

- [x] **T-088** Data laporan (migrasi DB): jenis, judul, periode, agent, isi (Markdown), sumber (dedup), status, pembuat, dikirim ke; tanda dibaca per orang.
- [x] **T-089** Sumber otomatis: impor ringkasan grup (wa_summaries) dan hasil cron Hermes (`cron/output/*.md`, bagian Response) — hanya-baca; ringkasan diskusi disimpan saat selesai.
- [x] **T-090** Laporan mingguan oleh Aurix: data Senin–Minggu lalu (tugas, acara, diskusi, ringkasan WA) → Aurix menulis laporan; otomatis Senin 07.00 WIB, dan "Buat sekarang".
- [x] **T-091** API: daftar + filter jenis + belum dibaca, baca (menandai dibaca), buat mingguan, kirim ke grup WhatsApp, hapus (pembuat/admin).
- [x] **T-092** Halaman Reports: daftar di kiri (filter jenis, belum dibaca ditebalkan), bacaan di kanan (Markdown), aksi Salin / Kirim ke grup / Hapus; badge sidebar asli.
- [x] **T-093** Penyeragaman UI: audit semua halaman (screenshot), samakan tombol, pil status, tab, tabel, kepala halaman; perbaiki komponen yang menyimpang.

## Acceptance Criteria

- Laporan yang sama tidak diimpor dua kali; file Hermes tidak pernah ditulis.
- Badge = jumlah laporan yang belum dibaca user; hilang setelah dibuka.
- Laporan mingguan dibuat sekali per minggu walau server restart berkali-kali.
- Kirim ke grup memakai format WhatsApp (tebal `*…*`, daftar `•`), hanya grup yang dikenal bot.

## Automation Log

- 2026-10-19 Epic dibuat (urutan Settings → Reports → Automation → Performance; pemilik minta UI konsisten) — on-progress
- 2026-10-19 T-088…T-093 selesai. Skema v11 `reports` + `report_reads`. `lib/reports.js`: impor otomatis (wa_summaries selesai → `wa_summary`; file `cron/output/<job>/*.md` Hermes → `wa_digest`, hanya bagian Response, run "-" dilewati, hanya-baca; dedup `source_key`), ringkasan diskusi disimpan saat selesai (hook `onSummary` di rooms; peminta otomatis sudah-baca), laporan mingguan Aurix (data Senin–Minggu lalu: tugas selesai/terlambat/baru, acara, acara minggu depan, aktivitas channel, jawaban agent, pesan terpanjang, ringkasan WA) otomatis Senin ≥07.00 WIB sekali per minggu (idempoten lewat `weekly:<tanggal>`), "Buat sekarang" menulis ulang; baca = tanda per orang; kirim ke grup via bridge dengan format WhatsApp; hapus pembuat/admin; audit `report_sent/report_deleted`. API `/api/reports…`. UI: daftar kiri (filter jenis, belum dibaca tebal + titik emas, pratinjau), bacaan kanan (Markdown), aksi Salin/Kirim ke grup/Hapus, badge sidebar asli. **T-093 penyeragaman**: audit screenshot semua halaman → halaman chat agent masih template Inggris: tab Prompt/Agent dan kotak cari palsu dihapus, tombol ikon mati dihapus, "Chat is Protected" → "Percakapan privat", "HG Certified Agent" → "Agent tim HG", chip cepat jadi Indonesia & berguna (Ringkas, Daftar tugas, Draf balasan, Poin penting), tombol Options/Model (mati) dihapus, placeholder "Tulis pesan ke <agent>…", peran & sapaan agent dalam Bahasa Indonesia; empty state Pilih Group & Chat History disamakan dengan gaya halaman lain; input form Settings & pil status dirapikan. Tes 138/138 (6 baru + UI), gates PASS.
- 2026-10-19 Restart oleh agent: PID 924955 → 956176, gates PASS, `/healthz` ok, skema v11 — live; impor pertama di production berjalan saat start. Menunggu QA pemilik; laporan mingguan pertama otomatis Senin 26 Okt 07.00 WIB.
- 2026-10-19 Permintaan pemilik: menu Performance dan Automation menjadi halaman **Segera hadir** (bukan hiasan) berisi rencana fiturnya; tidak ada lagi item sidebar yang tidak berfungsi.

## Dependencies

- EPIC-008 (ringkasan grup, arsip), EPIC-009 (acara), EPIC-010 (tugas), EPIC-012 (diskusi, ringkasan).
