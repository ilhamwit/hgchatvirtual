# EPIC-009: Schedule — Jadwal & Meeting

status: on-progress
environment: dev
phase: 2
priority: P1
area: Fullstack
retries: 0
prd: ../product/PRD.md
stories: US-SCH-1 … US-SCH-5
tasks: T-046 … T-052

## Goal

Menu **Schedule** menjadi tempat tim (pengguna high-level, bukan teknis)
membuat **acara/meeting**: cukup menulis agendanya apa, kapan, dan di mana.
Agent **Aurix** menyusun agenda meeting yang rapi. Setelah dicek dan disetujui
manusia, **bot WhatsApp** mengirim agenda itu ke grup yang dipilih (boleh lebih
dari satu), lalu mengirim **pengingat** otomatis ke grup yang sama. Semua acara
tampil di **kalender bawaan** Chat Center; sambungan ke Google Calendar
menyusul.

Keputusan pemilik (2026-10-19):
- Daftar cron Hermes (versi pertama T-046) terlalu teknis → **dihapus**.
- Semua user yang login boleh membuat, mengubah, dan mengirim acara.
- Agenda **selalu dicek dulu**: tidak ada yang terkirim ke grup sebelum
  seseorang menekan "Kirim ke grup". Pengingat aktif setelah pengiriman itu.
- Agent penyusun: Aurix (tetap, tanpa pilihan), seperti ringkasan grup.

## User Stories

- **US-SCH-1** — Sebagai anggota tim, saya ingin membuat acara cukup dengan judul/agenda, waktu, dan lokasi.
- **US-SCH-2** — Sebagai anggota tim, saya ingin agent menyusun agenda meeting yang rapi, yang bisa saya ubah sebelum dikirim.
- **US-SCH-3** — Sebagai anggota tim, saya ingin bot mengirim agenda ke grup WhatsApp yang saya pilih.
- **US-SCH-4** — Sebagai anggota tim, saya ingin grup diingatkan otomatis sebelum acara.
- **US-SCH-5** — Sebagai anggota tim, saya ingin melihat semua acara di kalender, dan nanti menyambungkannya ke Google Calendar.

## Tasks

### Tahap 0 — bersih-bersih

- [x] **T-046** ~~Halaman daftar cron Hermes (hanya-baca)~~ — dibangun 2026-10-19 lalu **dihapus** atas permintaan pemilik (terlalu teknis). Kode, API, dan tesnya dicabut.

### Tahap 1 — acara, agenda, kalender

- [x] **T-047** Data acara (migrasi DB): judul, mulai, durasi, lokasi, peserta, catatan, agenda, grup tujuan, pilihan pengingat, pembuat, status (draf/terkirim/dibatalkan). API buat/ubah/hapus/daftar.
- [x] **T-048** Agenda oleh Aurix: dibuat otomatis saat acara dibuat, bisa dibuat ulang, bisa diedit; format WhatsApp (pratinjau seperti di WhatsApp).
- [x] **T-049** Halaman Schedule: kalender bulanan + daftar acara mendatang, form acara, detail acara. Menu sidebar Schedule tersambung.

### Tahap 2 — kirim & pengingat

- [x] **T-050** Kirim agenda ke grup WhatsApp terpilih lewat bot (bridge Hermes `POST /send`), setelah dicek manusia; status per grup; kirim ulang.
- [x] **T-051** Pengingat otomatis (H-1 09.00, hari H 08.00, 1 jam / 30 / 15 menit sebelum): antrean di DB, dicek server tiap 30 detik, tahan restart, coba ulang bila bot tidak tersambung; batal → pengingat dihentikan dan grup bisa dikabari.

### Tahap 3 — Google Calendar (belum dijadwalkan)

- [ ] **T-052** Sambungkan ke Google Calendar (skill `google-workspace` Hermes; perlu OAuth client Google Cloud + login Google sekali oleh pemilik).

## Acceptance Criteria

**Epic-level**

- Tidak ada pesan terkirim ke grup tanpa klik "Kirim ke grup" oleh user yang login.
- Pengingat tidak pernah terkirim untuk acara yang dibatalkan, sudah lewat, atau belum disetujui.
- Waktu acara dan pesan memakai WIB (Asia/Jakarta).

**Per-task**

- **T-047** — Acara tanpa judul/waktu ditolak; grup harus dari daftar grup bot; hanya user login; acara terkirim tidak bisa dihapus (harus dibatalkan).
- **T-048** — Agenda memuat judul, waktu, lokasi, susunan acara; status "sedang disusun" terlihat; gagal → pesan error + tombol coba lagi.
- **T-049** — Acara tampil di tanggal yang benar di kalender; klik tanggal → form dengan tanggal itu; klik acara → detail.
- **T-050** — Agenda yang dikirim = teks yang terlihat di pratinjau; status per grup (terkirim/gagal); bot terputus → dicoba ulang, lalu gagal dengan alasan.
- **T-051** — Pengingat terjadwal tampil dengan jamnya; mengubah waktu acara menjadwalkan ulang pengingat; pengingat yang waktunya sudah lewat saat dijadwalkan tidak dibuat.

## Automation Log

- 2026-10-18 Epic dibuat atas permintaan user (Schedule dulu, mulai dari daftar cron Hermes). Riset cron Hermes: `jobs.json`, `executions.db`, output Markdown, CLI `hermes cron` — on-progress
- 2026-10-19 T-046 versi cron selesai (f5cbe3a: halaman hanya-baca daftar job, riwayat run, hasil terakhir), belum sempat direstart. Pemilik menilai terlalu teknis untuk pengguna high-level → dihapus. Epic ditulis ulang menjadi **Jadwal & Meeting** (acara → agenda Aurix → dicek → bot kirim ke grup → pengingat; kalender bawaan, Google Calendar menyusul). Riset: bridge WhatsApp Hermes punya `POST /send {chatId, message}` (port 3010); skill Hermes `google-workspace` tersedia tetapi belum ada `google_token.json` (belum tersambung).
- 2026-10-19 T-047…T-051 selesai (tahap 1 + 2). Skema v5: `events` + `event_messages` (antrean kirim). `lib/events.js`: validasi (WIB tetap +07:00, waktu lewat ditolak, grup harus dikenal bot), agenda Aurix di latar (`event-<id>-<n>`, format WhatsApp), `agenda_at` = versi detail yang dipakai → tanda "detail berubah"; "Kirim ke grup" (langkah konfirmasi di UI) mengantrekan agenda persis seperti pratinjau dan menjadwalkan pengingat; worker tiap 30 dtk kirim lewat bridge `POST /send`, coba ulang 1/2/4/8 menit lalu gagal dengan alasan; pengingat dilewati bila acara dibatalkan/sudah mulai; ubah waktu → pengingat dijadwalkan ulang; batal → opsi kabari grup yang sudah menerima agenda; acara terkirim tidak bisa dihapus. Audit: `event_sent`, `event_cancelled`. API `/api/events…` (login wajib). UI: kalender bulanan + acara mendatang + form + detail (pratinjau gelembung WhatsApp, tabel pengiriman bot). Tes 85/85 (7 baru untuk events, dijalankan juga dengan TZ=UTC), gates PASS, screenshot sandbox (Aurix & bridge palsu: 3 kirim tepat ke grup terpilih). Belum diuji dengan WhatsApp asli — perlu restart chat-center. T-052 (Google Calendar) menunggu keputusan pemilik.
- 2026-10-19 Uji nyata (restart PID 382572, skema v5): ilham membuat "Meeting Evaluasi Q3" (00.45 WIB) ke grup HG Bot Testing dengan pengingat H-1/1 jam/15 menit. Agenda terkirim 00.25.19 (1 percobaan); H-1 dan 1 jam tidak dibuat karena sudah lewat (sesuai aturan); pengingat 15 menit jatuh tempo 00.30.00 dan terkirim 00.30.26 (tick 30 dtk) — T-050/T-051 terverifikasi dengan WhatsApp asli.

## Dependencies

- EPIC-008 (daftar grup WhatsApp dari arsip; bridge WhatsApp Hermes untuk mengirim).
