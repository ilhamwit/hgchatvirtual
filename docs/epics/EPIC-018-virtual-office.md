# EPIC-018: Virtual Office

status: ready-for-qa
environment: dev
phase: 3
priority: P2
area: Frontend
retries: 0
prd: ../product/PRD.md
stories: US-VO-1 … US-VO-2
tasks: T-107 … T-110

## Goal

Menu baru **Virtual Office** di bawah daftar Agents (permintaan pemilik,
2026-10-19): kantor 3D yang cukup detail tempat setiap agent duduk di mejanya,
dan agent bisa diklik untuk langsung chat. Referensi pemilik adalah reel
Instagram yang tidak bisa dibuka dari server (perlu login; ekstensi Chrome tidak
tersambung), jadi bentuknya mengikuti gaya "AI agents virtual office" isometrik.

## User Stories

- US-VO-1 — Sebagai anggota tim, saya melihat semua agent di kantor virtual dan
  bisa memilih siapa yang diajak chat dengan mengklik agent itu.
- US-VO-2 — Sebagai anggota tim, saya melihat agent mana yang sedang membalas
  pesan saya (monitor menyala, gelembung "sedang membalas…").

## Tasks

- T-107 Mesin 3D tanpa library/unduhan: CSS 3D transforms (`public/office.js`):
  kotak 5 sisi berbayang dari satu warna (`voBox`), panel tegak (`voPanel`),
  bidang lantai (`voFlat`), billboard yang selalu menghadap kamera (`voSprite`).
- T-108 Ruangan: lantai kayu, dua dinding + plint, jendela dengan langit menurut
  jam WIB (siang/senja/malam + cahaya meja di malam hari), logo HG, jam dinding
  (waktu WIB), rak server HERMES dengan LED berkedip, pojok kopi, rak buku,
  papan tugas dengan sticky notes, ruang meeting (karpet, meja, 6 kursi, laptop,
  layar), tanaman, bayangan.
- T-109 Agent: meja, monitor dengan warna agent (pindaian saat membalas), kursi,
  badan, wajah (foto) sebagai billboard, label nama; hover/fokus = cincin di
  lantai + kartu (peran, chat terakhir); klik meja/agent/chip = `switchAgent`.
  Status sibuk dari `pending` percakapan pengguna (diperbarui tiap 1,5 dtk).
- T-110 Kamera: geser untuk memutar (dibatasi supaya dinding tidak menutupi),
  scroll/pinch untuk zoom, tombol ⟲ ⟳ ＋ － ⌂; klik setelah menggeser diabaikan;
  ponsel: skala lebih besar, chip agent di bawah; `prefers-reduced-motion`.

## Acceptance Criteria

- Given menu Virtual Office, When dibuka, Then kelima agent tampil di mejanya.
- Given seorang agent, When diklik (wajah, meja, atau chip), Then chat dengan
  agent itu terbuka.
- Given pesan saya sedang dijawab agent, Then mejanya menandai sedang membalas.

## Automation Log

- 2026-10-19 T-107…T-110 dibangun di worktree `office`. Diuji visual dengan
  Chromium headless (CDP) di instance uji port 8653 (salinan DB, bridge/Hermes ke
  port mati, akun uji hanya di salinan): 1440×900 (awal, hover, diputar/zoom) dan
  390×844 (awal, klik wajah Nana → chat Nana terbuka). Tes baru
  `test/office.test.js` (adegan dirender di sandbox `vm`: satu meja per agent,
  escape nama, slot maks 6, 5 sisi per kotak, billboard membatalkan rotasi
  kamera) + tes UI menu/registry. Tes 148/148, gates PASS.

## Dependencies

- EPIC-006 (agent tim), EPIC-011 (sesi chat), EPIC-017 (mobile).
