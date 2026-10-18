# EPIC-008: WhatsApp Agent

status: on-progress
environment: dev
phase: 2
priority: P1
area: Frontend
retries: 0
prd: ../product/PRD.md
stories: -
tasks: T-041 … T-045

## Goal

Menu baru **WhatsApp Agent** di sidebar HG Chat, dengan empat bagian:
Koneksikan WA, Pilih Group, Inbox, dan Summary Chating. Tahap pertama hanya
kerangka menu dan halaman placeholder; **detail tiap fitur akan dijelaskan
user** dan dipecah jadi task setelahnya.

Konteks teknis untuk nanti: Hermes sudah menjalankan WhatsApp bridge
(`scripts/whatsapp-bridge/bridge.js`, port 3010, sesi di
`~/.hermes/whatsapp/session`, mode bot) sebagai bagian dari `hermes-gateway`.

## User Stories

- **US-WA-1** — Sebagai anggota tim, saya ingin menu WhatsApp Agent di sidebar, supaya semua fitur WhatsApp ada di satu tempat.
- **US-WA-2..5** — _menunggu penjelasan user untuk tiap submenu._

## Tasks

### Kerangka menu

- [x] **T-041** Grup sidebar "WhatsApp Agent" (bisa dibuka/tutup) dengan 4 submenu; tiap submenu membuka halaman sendiri menggantikan panel riwayat + chat, dengan judul, deskripsi singkat, dan status "Segera hadir"; alamat `#wa-connect`, `#wa-groups`, `#wa-inbox`, `#wa-summary` bertahan saat reload; kembali ke chat lewat "Chat & Discussion" atau memilih agent.

### Fitur (detail menyusul dari user)

- [x] **T-042** Koneksikan WA — status nomor WhatsApp Hermes + pairing QR dari web ke sesi pending; pemasangan & restart Hermes lewat `scripts/wa-apply.sh` (dijalankan manusia), dengan backup dan rollback.
- [x] **T-043** Pilih Group — daftar grup dari arsip grup bridge Hermes (nama dari bridge) → chat read-only.
- [ ] **T-044** Inbox — _detail menyusul._
- [x] **T-045** Summary Chating — grup + rentang tanggal + agent (default Dave) → ringkasan Markdown oleh agent Hermes, tersimpan dengan riwayat.

## Acceptance Criteria

**Epic-level**

- Keempat submenu bisa dibuka dari sidebar dan kembali ke chat tanpa reload.
- (Fitur) ditentukan setelah user menjelaskan detailnya.

**Per-task**

- **T-041** — menu tampil di sidebar; klik submenu menampilkan halamannya dan menandai item aktif; reload di `#wa-inbox` membuka Inbox lagi; klik "Chat & Discussion" atau agent kembali ke chat; chat yang sedang berjalan tidak terganggu.

## Automation Log

- 2026-10-18 Epic dibuat atas permintaan user: menu WhatsApp Agent + 4 submenu, kerangka dulu; detail fitur menyusul — on-progress
- 2026-10-18 T-041: grup sidebar "WhatsApp Agent" (di atas Tools, bisa dibuka/tutup, chevron, aria-expanded) dengan 4 submenu → halaman placeholder (breadcrumb, ikon, badge "Segera hadir", deskripsi singkat) yang menggantikan panel riwayat + chat; `#wa-connect|groups|inbox|summary` dibuka lagi saat reload; "Chat & Discussion", menu lain, atau memilih agent kembali ke chat (turn yang sedang berjalan tetap tersimpan di server). Hanya frontend (`public/`), tidak perlu restart. 4 test wiring (`test/ui.test.js`), total 55 PASS. Belum dilihat di browser oleh agent (tidak ada browser di server) — done
- 2026-10-18 T-042..T-045 menunggu penjelasan detail dari user — on-progress
- 2026-10-18 T-042 Koneksikan WA — permintaan user: pairing QR WhatsApp Hermes dari web, termasuk ganti nomor. Riset: WhatsApp Hermes milik profil default (bot mode, bridge :3010, sesi ~/.hermes/whatsapp/session); bridge punya mode `--pair-only --pair-json` (dipakai dashboard Hermes, yang tidak berjalan); Hermes tidak punya operasi ganti nomor (start pairing dengan creds lama = langsung "connected"). Desain pertama (web me-restart hermes-gateway) DITOLAK classifier keamanan (Production Deploy / Interfere With Workloads); user memilih desain aman — info
- 2026-10-18 T-042 implementasi: `lib/whatsapp.js` (status bridge + akun dari creds.json, pairing ke staging `session.pairing-*` → `session.pending` setelah scan, QR → SVG memakai encoder qrcode-terminal milik bridge Hermes, satu pairing sekaligus, kedaluwarsa 3 menit, batal, bersih-bersih staging saat start, proses pairing dihentikan saat server berhenti); API `GET /api/wa/status`, `POST/DELETE /api/wa/pair` (semua user login, keputusan user); audit `wa_pair_started|scanned|cancelled|failed`. `scripts/wa-apply.sh` (manusia): tampilkan lama→baru, konfirmasi (EOF = tidak), stop gateway, sesi lama → `.bak-<waktu>`, pasang baru, start, tunggu bridge connected sebagai akun baru (90 dtk), rollback otomatis bila gagal, audit `wa_number_changed|wa_apply_failed`. UI: kartu nomor aktif + status bridge, kartu "nomor baru siap" + perintah + tombol Salin, area QR + langkah scan, Batal; polling 2 dtk saat pairing. Juga: `hashchange` diikuti (back/forward). 12 test baru dengan bridge/systemctl/health palsu (2 bug ditemukan & diperbaiki: prompt EOF keluar diam-diam; cwd bridge), total 67 PASS. Screenshot UI via Chromium bawaan Hermes (sandbox, bridge palsu): menu, QR, nomor siap — tampil benar. Belum: uji scan sungguhan oleh user — implemented
- 2026-10-18 T-043/T-045 — permintaan user: Pilih Group = daftar grup bot → chat read-only; Summary Chating = grup + rentang tanggal → ringkasan. Riset: bridge Hermes punya arsip grup opt-in (`WHATSAPP_GROUP_ARCHIVE`) yang ternyata sudah aktif (15 pesan, 2 grup sejak 21:17), group_policy open + require_mention; nama grup lewat bridge `GET /chat/<id>`; cron Hermes `wa-group-summary` sudah ada. Keterbatasan disampaikan & disetujui: riwayat sejak arsip aktif, balasan bot tidak diarsip (bridge melewati fromMe di grup), media hanya label, grup muncul setelah pesan pertama. Keputusan user: semua user login boleh membaca semua grup; agent peringkas bisa dipilih, default Dave — info
- 2026-10-18 T-043/T-045 implementasi: migrasi 4 (`wa_messages` + unique dedup, `wa_groups`, `wa_archive_state` dengan offset+inode+hash kepala file, `wa_summaries`); `lib/wa-archive.js` (indeks inkremental hanya-baca, baris setengah ditulis ditunda, rotasi aman; nama grup dari bridge di-cache 6 jam; halaman pesan newest-first + hasMore; ringkasan latar belakang via `lib/gateway.js` dengan sesi Hermes `hgchat-wasum-<id>-<n>`, map-reduce per 20k karakter, prompt melarang tool & kirim pesan, maks 92 hari/5000 pesan, satu proses per grup, yang terputus restart ditandai gagal). API `GET /api/wa/groups`, `GET /api/wa/groups/:id/messages`, `GET|POST /api/wa/summaries`, `GET /api/wa/summaries/:id`. UI: daftar grup + chat read-only gaya WhatsApp (pemisah hari, warna pengirim, label media, link, muat lebih lama, refresh 15 dtk); form ringkasan (grup, dari/sampai, agent) + hasil Markdown + riwayat. Renderer Markdown umum diperbaiki: heading `#..####` dan list di tengah blok (juga memperbaiki balasan agent di chat). 7 test baru (temuan: rotasi file bisa memakai ulang inode → ditambah hash kepala file), total 74 PASS; migrasi v3→v4 diuji pada salinan DB production; screenshot dengan data contoh — done

## Dependencies

- Tidak ada untuk kerangka menu. Fitur nanti kemungkinan bergantung pada WhatsApp bridge di Hermes.
