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

- [ ] **T-042** Koneksikan WA — _detail menyusul._
- [ ] **T-043** Pilih Group — _detail menyusul._
- [ ] **T-044** Inbox — _detail menyusul._
- [ ] **T-045** Summary Chating — _detail menyusul._

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

## Dependencies

- Tidak ada untuk kerangka menu. Fitur nanti kemungkinan bergantung pada WhatsApp bridge di Hermes.
