# EPIC-018: Virtual Office

status: ready-for-qa
environment: dev
phase: 3
priority: P2
area: Frontend
retries: 0
prd: ../product/PRD.md
stories: US-VO-1 … US-VO-2
tasks: T-107 … T-114

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

- T-111 Chat di dalam Virtual Office (pemilik: "interaksi chatnya jangan pindah
  page"): klik agent membuka panel chat di kanan (bottom sheet di ponsel), ruangan
  tetap terlihat. Percakapan sama dengan halaman chat (`activeConv`, `convs`,
  `pending`): kirim, sesi baru, stop, polling bila koneksi putus, tombol ↗ ke
  halaman chat untuk lampiran/riwayat sesi. Balasan muncul juga sebagai gelembung
  di atas kepala agent selama 9 dtk.
- T-112 Aurix (bot WhatsApp) berdiri di ujung meja meeting (menggantikan podium):
  sosok robot penuh (cut-out transparan dari `~/Pictures/Aurix.jpg`, avatar di latar
  gelap seperti foto resmi), label "Aurix · Bot WA", chip sendiri. Klik → panel
  daftar grup WhatsApp tempat Aurix berada (arsip baca-saja yang sama dengan Pilih
  Group); pilih grup → percakapan bergaya WhatsApp, muat pesan lama, muat ulang
  tiap 15 dtk, pesan baru muncul sebagai gelembung di atas Aurix; tombol ke halaman
  Pilih Group dan Summary Chat.
- T-113 three.js (pemilik: "pakai three.js, lebih detail dan realistis"; izin unduh
  diberikan di chat). three.js 0.170.0 (MIT) di `public/vendor/three/` lewat import
  map, dimuat hanya saat Virtual Office dibuka (`public/office3d.js`). Material PBR,
  tone mapping ACES, pantulan RoomEnvironment, bayangan lembut, dinding belakang
  berlubang jendela sehingga matahari masuk ke lantai (siang/senja; malam: lampu meja
  menyala), tekstur prosedural (lantai kayu, karpet, langit kota, papan tugas, logo,
  jam WIB, layar per peran agent). Orang 3D duduk dan mengetik saat membalas, Aurix
  sebagai robot 3D mengikuti maskotnya. Kamera OrbitControls dibatasi di sisi terbuka;
  klik agent = panel chat + kamera mendekat, tutup = kembali. Tanpa WebGL: ruangan
  CSS 3D lama tetap dipakai.
- T-114 Mengendalikan Aurix seperti Diablo (pemilik): klik Aurix → terpilih (cincin
  hijau berdenyut, bilah kontrol "Aurix dipilih" + Baca grup WA / Selesai, kursor
  crosshair + cincin bayangan di lantai), klik/tap lantai → Aurix berjalan ke sana.
  Grid 20 cm dari kotak pembatas furnitur (+ radius robot), A* 8 arah tanpa memotong
  sudut, string-pulling, kurva Catmull-Rom centripetal; percepatan/pengereman, belok
  halus, langkah kaki dari sendi pinggul, ayunan lengan, sedikit memantul. Tujuan yang
  tertutup furnitur → sel kosong terdekat. Posisi disimpan di browser (localStorage).
  Esc pertama melepas kontrol. Chip Aurix tetap membuka daftar grup.

## Acceptance Criteria

- Given menu Virtual Office, When dibuka, Then kelima agent tampil di mejanya.
- Given seorang agent, When diklik (wajah, meja, atau chip), Then panel chat
  dengan agent itu terbuka di Virtual Office tanpa pindah halaman.
- Given pesan saya sedang dijawab agent, Then mejanya menandai sedang membalas.

## Automation Log

- 2026-10-19 T-107…T-110 dibangun di worktree `office`. Diuji visual dengan
  Chromium headless (CDP) di instance uji port 8653 (salinan DB, bridge/Hermes ke
  port mati, akun uji hanya di salinan): 1440×900 (awal, hover, diputar/zoom) dan
  390×844 (awal, klik wajah Nana → chat Nana terbuka). Tes baru
  `test/office.test.js` (adegan dirender di sandbox `vm`: satu meja per agent,
  escape nama, slot maks 6, 5 sisi per kotak, billboard membatalkan rotasi
  kamera) + tes UI menu/registry. Tes 148/148, gates PASS.

- 2026-10-19 T-111: panel chat di kantor. Diuji dengan Hermes tiruan lokal
  (balas 2,5 dtk, tanpa model) di instance uji: panel terbuka dengan riwayat yang
  sama, status "sedang membalas" (titik mengetik, tombol stop, gelembung di meja),
  balasan tampil di panel dan sebagai gelembung 3D; ponsel = bottom sheet. Tes
  baru: klik tidak pindah halaman, isi pesan di-escape. Tes 149/149, gates PASS.
- 2026-10-19 Bug dari pemilik: tombol kirim di panel chat tidak berfungsi di ponsel.
  Direproduksi dengan ketukan sentuh CDP (emulasi Android): `TypeError: voSend is
  not a function` di `onsubmit`. Penyebab: handler inline mencari nama di form lebih
  dulu, dan tombol ber-id `voSend` membayangi fungsi `voSend()` (Enter tetap jalan
  karena lewat `voTaKey`). Bug yang sama ada di komentar Task Focus (`#tfComment`
  vs `tfComment()`): tombol Kirim dan Ctrl+Enter komentar tidak berfungsi. Perbaikan:
  id `voSendBtn`, `voTypingRow`, `tfCommentTa`; `onsubmit` memanggil
  `window.voSend()`. Tes penjaga baru: tidak boleh ada id yang sama dengan nama
  fungsi. Diverifikasi ulang dengan ketukan sentuh: pesan terkirim, balasan tampil
  di panel dan gelembung 3D. Tes 150/150, gates PASS.
- 2026-10-19 T-112: Aurix di meja meeting. Foto resmi yang dikirim pemilik di chat
  tidak tersimpan sebagai file di server, jadi avatar dibuat dari
  `~/Pictures/Aurix.jpg` (robot yang sama) di latar gelap; bisa diganti bila file
  foto resminya diletakkan di server. Diuji di instance uji: hover, daftar 2 grup,
  baca grup "WIT. Surabaya - Strategic", ponsel bottom sheet. Tes baru di
  `test/office.test.js`.
- 2026-10-19 Pemilik: avatar Aurix yang sekarang dipakai (file foto resmi tidak ada
  di server), tapi sosoknya tembus ke meja. Penyebab: billboard menghadap kamera
  sepenuhnya, jadi saat kamera melihat dari atas bidangnya condong ke belakang dan
  bagian atasnya masuk ke meja. Perbaikan: `voStandee` (tegak, hanya berputar di
  sumbu vertikal; tinggi dikompensasi 1/sin(kemiringan)), posisi digeser ke
  x=1058. Dicek dari beberapa sudut kamera (rz 10/40/55/80, rx 42/58).
- 2026-10-19 T-113 three.js. Diuji dengan Chromium headless + SwiftShader di instance
  uji (Hermes tiruan): ruangan lengkap, Aurix + daftar grup, chat Nana (kamera
  mendekat, cincin, gelembung balasan), ponsel, cadangan CSS saat `voWebGL()` false.
  Bug ditemukan & diperbaiki: komentar menelan `scene.add(robot)`; boot memanggil
  `switchAgent` yang menutup halaman yang baru dibuka (sekarang `switchAgent(id,
  keepPage)`). Tes 155/155, gates PASS.
- 2026-10-19 Pemilik: semua agent memakai business attire hitam yang sama, kursi di
  dekat Aurix terbalik, 3D lebih detail. Seragam: jas & celana hitam, kemeja putih,
  dasi hitam, kerah, lapel, saku, manset, sepatu; warna agent hanya di pin kerah (dan
  label, cincin, mug). Kursi meeting: sandaran sekarang menjauhi meja (keenam kursi
  terbalik sebelumnya). Detail baru: tirai kerai (bayangan bergaris di lantai), sudut
  santai (karpet, sofa + bantal, kursi kulit, meja kopi bundar, lampu lantai), TV
  presentasi di ujung meja meeting, dispenser air, printer + lemari, AC dinding, dua
  lukisan, tanaman dekat jendela; per meja: panel akustik, alas meja, tempat pena,
  HP, bingkai foto agent, tempat sampah. Tes 156/156, gates PASS.
- 2026-10-19 T-114 diuji di instance uji (Chromium headless + SwiftShader): Aurix dari
  meja meeting ke sudut santai mengitari meja meeting dan meja kerja, tiba di sel
  kosong terdekat, posisi tersimpan. Cincin lantai dan glow layar tidak dihitung
  sebagai penghalang (sebelumnya menutup lorong antar meja). dt per frame dibatasi
  0,1 dtk supaya perangkat lambat tetap berjalan dengan kecepatan nyata.

## Dependencies

- EPIC-006 (agent tim), EPIC-011 (sesi chat), EPIC-017 (mobile).
