# EPIC-009: Schedule — Jadwal Agent

status: on-progress
environment: dev
phase: 2
priority: P1
area: Frontend
retries: 0
prd: ../product/PRD.md
stories: -
tasks: T-046 … T-049

## Goal

Menu **Schedule** di sidebar (saat ini hanya hiasan) menjadi tempat tim melihat
dan nanti mengelola **pekerjaan terjadwal agent** — cron Hermes. Contoh yang
sudah berjalan: `wa-group-summary`, tiap 6 jam meringkas grup WhatsApp dan
mengirimnya ke grup.

Sumber data (milik Hermes, dibaca hanya-baca oleh Chat Center):
`~/.hermes/cron/jobs.json` (dan `~/.hermes/profiles/<p>/cron/jobs.json` bila
ada), riwayat run di `cron/executions.db`, hasil tiap run di
`cron/output/<job>/<waktu>.md`. Perubahan (jeda, buat, ubah) nanti lewat CLI
resmi `hermes cron …`, bukan menulis file Hermes langsung.

## User Stories

- **US-SCH-1** — Sebagai anggota tim, saya ingin melihat semua jadwal agent: apa yang dikerjakan, kapan jalan berikutnya, dan apakah run terakhir berhasil.
- **US-SCH-2** — Sebagai anggota tim, saya ingin menjeda/mengaktifkan jadwal atau menjalankannya sekarang.
- **US-SCH-3** — Sebagai anggota tim, saya ingin membuat jadwal baru dari web tanpa terminal.
- **US-SCH-4** — Sebagai anggota tim, saya ingin agent mengingatkan saya pada waktu tertentu.

## Tasks

### Daftar jadwal (hanya-baca)

- [x] **T-046** Halaman Schedule: daftar job dari semua profil Hermes — nama, profil, jadwal dalam bahasa manusia, status (aktif/dijeda/error), jalan berikutnya & terakhir, tujuan kirim (nama grup WhatsApp bila dikenal), instruksi (prompt) & skrip; detail: riwayat run dari `executions.db` dan hasil run terakhir (Markdown) dari `output/`. Menu sidebar Schedule tersambung.

### Kendali (perlu keputusan izin)

- [ ] **T-047** Jeda / aktifkan / jalankan sekarang lewat `hermes cron pause|resume|run`. Catatan: mirip Koneksikan WA — web mengendalikan Hermes; classifier keamanan bisa menolak, sehingga alternatifnya perintah terminal yang ditampilkan halaman.
- [ ] **T-048** Buat & ubah jadwal dari web (`hermes cron create|edit`): agent/profil, instruksi, jadwal, tujuan kirim.

### Pengingat

- [ ] **T-049** Pengingat pribadi ("ingatkan saya besok 09.00") yang dikirim agent ke WhatsApp/Telegram.

## Acceptance Criteria

**Epic-level**

- Jadwal yang ada di Hermes tampil sama persis dengan `hermes cron list`.
- Chat Center tidak pernah menulis file cron Hermes secara langsung.

**Per-task**

- **T-046** — `wa-group-summary` tampil: "Setiap 6 jam", aktif, berikutnya 03.23, terakhir OK, kirim ke grup "HG Bot Testing"; riwayat 1 run selesai; hasil terakhir bisa dibuka. Job error/dijeda ditandai jelas. Hanya user login.

## Automation Log

- 2026-10-18 Epic dibuat atas permintaan user (Schedule dulu, mulai dari daftar cron Hermes). Riset: 1 job (`wa-group-summary`, profil default, interval 360 menit, skrip `wa_group_digest.py` + prompt, deliver `whatsapp:<grup>`), `executions.db` (1 run completed), output Markdown per run; profil lain punya folder cron tanpa job; CLI `hermes cron list|create|edit|pause|resume|run|runs` tersedia — on-progress

- 2026-10-19 T-046 selesai: `lib/schedule.js` (baca `jobs.json` semua profil, `executions.db` read-only, `output/` terbaru + bagian `## Response`), API `GET /api/schedule/jobs` dan `GET /api/schedule/jobs/:profil/:id` (login wajib, id/profil divalidasi, POST → 405), halaman Schedule (`#schedule`) di slot halaman WhatsApp: kartu per job (status Aktif/Dijeda/Gagal, jadwal bahasa Indonesia, berikutnya/terakhir, tujuan kirim dengan nama grup, error terakhir), detail: hasil terakhir, file lengkap, riwayat run, instruksi, skrip. Cek data asli: `wa-group-summary` → "Setiap 6 jam", aktif, kirim ke "WhatsApp · HG Bot Testing", 1 run Berhasil/Terkirim. Tes 81/81 (5 baru, termasuk bukti file Hermes tidak berubah), gates PASS, screenshot desktop + mobile. Perlu restart chat-center (server.js + lib).

## Dependencies

- EPIC-008 (nama grup WhatsApp dari `wa_groups` untuk menampilkan tujuan kirim).
