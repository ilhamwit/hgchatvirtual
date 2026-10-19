---
name: chat-center
description: "Buat jadwal/meeting/acara tim HG di Chat Center (agents.herrygunawan.com) dari WhatsApp, atau lihat jadwal mendatang."
version: 1.0.0
author: HG Chat Center (EPIC-013)
platforms: [linux]
metadata:
  hermes:
    tags: [Schedule, Meeting, Calendar, WhatsApp, HG]
---

# Chat Center — jadwal tim HG

Chat Center (agents.herrygunawan.com) adalah web internal tim HG. Menu
**Schedule** berisi acara/meeting tim: agenda disusun agent Aurix, lalu bot
mengirimnya ke grup WhatsApp beserta pengingat. Skill ini membuat acara di sana
dari permintaan di WhatsApp, dan membaca jadwal mendatang.

## Kapan dipakai

- "jadwalkan rapat …", "buatkan meeting …", "bikin acara … hari Jumat jam 10"
- "jadwal minggu ini apa saja?", "ada meeting apa besok?"

Jangan dipakai untuk pengingat pribadi biasa atau hal di luar jadwal tim.

## Membuat acara

1. **Kumpulkan data** dari pesan: judul/agenda, tanggal, jam (WIB), lokasi
   (ruangan, alamat, atau link), durasi (default 60 menit), peserta dan catatan
   bila disebut. Ubah tanggal relatif ("Jumat depan", "besok") menjadi
   `YYYY-MM-DD` berdasarkan tanggal hari ini di WIB; jam menjadi `HH:MM` 24 jam.
   Kalau judul, tanggal, atau jam belum jelas — **tanyakan dulu**, jangan menebak.
2. **Selalu tanyakan modenya** (kecuali peminta sudah menyebutnya), misalnya:
   > Mau dibuat sebagai *draf* dulu (dicek & dikirim dari web), atau *langsung
   > dibuatkan* — agenda langsung dikirim ke grup ini beserta pengingat?
   - draf → `--mode draft`
   - langsung → `--mode send`
3. **Jalankan** (lewat terminal):
   ```
   python3 ~/.hermes/skills/productivity/chat-center/scripts/chat_center.py create \
     --title "Rapat evaluasi Q4" --date 2026-10-24 --time 10:00 \
     --location "Ruang rapat lt.3" --mode draft
   ```
   Tambahkan `--duration`, `--attendees`, `--notes` bila ada. Kutip setiap nilai.
4. **Balas** dengan isi field `reply` dari JSON hasilnya, apa adanya. Kalau
   `ok` = false, sampaikan isi `message` dengan sopan. Contoh: peminta yang
   nomornya belum terverifikasi diminta memverifikasi di web
   (Profil & notifikasi).

## Melihat jadwal

```
python3 ~/.hermes/skills/productivity/chat-center/scripts/chat_center.py list --days 7
```
Ringkas hasilnya (judul, waktu, lokasi) dalam beberapa baris.

## Aturan

- Identitas peminta dan grup diambil skrip dari sesi WhatsApp — **jangan pernah**
  mengisi atau mengubah variabel `HERMES_SESSION_*`, dan jangan menambahkan
  nomor/ID siapa pun ke perintah.
- Jangan menulis atau membaca database Chat Center secara langsung; selalu lewat
  skrip ini.
- Hanya anggota tim dengan nomor terverifikasi yang bisa membuat acara; server
  yang memeriksa, cukup sampaikan pesannya bila ditolak.
