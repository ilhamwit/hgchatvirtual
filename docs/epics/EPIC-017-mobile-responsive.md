# EPIC-017: Mobile Responsive

status: ready-for-qa
environment: dev
phase: 3
priority: P1
area: Frontend
retries: 0
prd: ../product/PRD.md
stories: US-MOB-1 … US-MOB-3
tasks: T-102 … T-106

## Goal

Chat Center rapi dan nyaman dipakai dari ponsel (permintaan pemilik,
2026-10-19: "buatkan mobile responsive nya yang rapi"). Sebelumnya sidebar 220 px
selalu tampil di ponsel, sehingga chat dan semua halaman terjepit dan terpotong.

## User Stories

- US-MOB-1 — Sebagai anggota tim, saya bisa membuka menu, berpindah halaman, dan
  memilih agent dari ponsel tanpa layar terjepit.
- US-MOB-2 — Sebagai anggota tim, saya bisa chat dengan agent, membuka riwayat
  sesi, dan berdiskusi di channel/DM dari ponsel seperti aplikasi chat biasa.
- US-MOB-3 — Sebagai anggota tim, saya bisa memakai Jadwal, Task Focus, Reports,
  Pilih Group, Settings, dan Profil di ponsel tanpa scroll ke samping.

## Tasks

- T-102 Kerangka ≤760 px: tombol menu ☰, sidebar jadi drawer (latar gelap, tutup
  saat memilih/Esc), topbar ringkas, tinggi `100dvh`, input 16 px (iOS tidak zoom),
  safe-area bawah.
- T-103 Riwayat chat: panel penuh di ponsel (tombol tutup), panel melayang di
  tablet 761–1100 px; tertutup setelah memilih sesi atau ketuk di luar.
- T-104 Daftar → detail dengan tombol kembali: Chat & Discussion, Pilih Group,
  Reports (`.m-detail`, `mDetail()`, `M_BACK`); thread diskusi layar penuh.
- T-105 Halaman: kalender ringkas, form acara 2 kolom, form tugas membungkus,
  panel jadwal/tugas digulir ke tampilan (`mReveal`), tabel akun tim & API key
  jadi kartu; login dengan gutter 16 px.
- T-106 Verifikasi: screenshot 390×844, 820×1180, 1440×900 semua halaman; tes UI.

## Acceptance Criteria

- Given lebar ≤760 px, When halaman apa pun dibuka, Then tidak ada scroll
  horizontal dan menu tersedia lewat ☰.
- Given Chat & Discussion/Pilih Group/Reports di ponsel, When item dipilih, Then
  detail tampil layar penuh dengan tombol kembali ke daftar.
- Given desktop ≥1101 px, Then tampilan tidak berubah dari sebelumnya.

## Automation Log

- 2026-10-19 T-102…T-106 dibangun di worktree `mobile`. Uji visual memakai Chromium
  headless (Playwright cache) lewat Chrome DevTools Protocol dari Node tanpa
  dependensi, terhadap instance uji port 8653 dengan salinan DB di scratchpad
  (bridge WA & Hermes diarahkan ke port mati supaya tidak ada kirim pesan),
  akun uji `mobiletest` hanya di salinan. Semua halaman 390 px: scrollWidth = 390
  (tanpa overflow). Desktop 1440 px tidak berubah. Tablet 820 px: riwayat melayang.
  Tes 144/144, gates PASS.

## Dependencies

- EPIC-009 … EPIC-016 (halaman yang disesuaikan).
