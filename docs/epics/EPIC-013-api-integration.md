# EPIC-013: Integrasi API — Agent WhatsApp Membuat Jadwal

status: on-progress
environment: dev
phase: 2
priority: P1
area: Fullstack
retries: 0
prd: ../product/PRD.md
stories: US-API-1 … US-API-3
tasks: T-077 … T-082

## Goal

Agent WhatsApp (Hermes profil default, bot "Aurix") bisa membuat acara di
**Schedule** Chat Center langsung dari grup WhatsApp, lewat **API resmi dengan
API key** — bukan dengan menulis database. Contoh: *"@Aurix jadwalkan rapat
evaluasi Q4 Jumat jam 10 di ruang rapat lt.3"* → acara muncul di web, agenda
disusun Aurix, dan bot membalas di grup.

Keputusan pemilik (2026-10-19):
- **Agent WA menanyakan** kepada peminta: dibuat sebagai **draf** (dicek dulu di
  web) atau **langsung dibuatkan** — langsung = agenda Aurix dikirim otomatis ke
  grup asal dan pengingat aktif tanpa klik "Kirim" di web. (Pengecualian sadar
  terhadap keputusan EPIC-009 "agenda selalu dicek dulu", khusus jalur ini dan
  atas pilihan peminta.)
- Hanya anggota tim yang **nomor WhatsApp-nya terverifikasi** di Profil Chat
  Center (EPIC-012 tahap 3) yang bisa meminta; orang lain ditolak dengan sopan.
- Izin API key awal: **buat acara** dan **lihat jadwal mendatang**.

Keamanan identitas: nomor peminta tidak diambil dari teks model, tetapi dari
variabel sesi yang dipasang gateway Hermes pada setiap perintah agent
(`HERMES_SESSION_USER_ID`, `HERMES_SESSION_CHAT_ID`). Untuk grup, server juga
memeriksa bahwa nomor itu memang baru menulis di grup tersebut (arsip grup,
15 menit terakhir).

## User Stories

- **US-API-1** — Sebagai anggota tim, saya ingin meminta agent WhatsApp membuat jadwal/meeting tanpa membuka web.
- **US-API-2** — Sebagai anggota tim, saya ingin memilih apakah acara itu draf atau langsung dikirim ke grup.
- **US-API-3** — Sebagai admin, saya ingin membuat dan mencabut API key untuk integrasi, dan melihat kapan dipakai.

## Tasks

- [x] **T-077** API key (migrasi DB): nama, awalan, hash, izin (`events:write`, `events:read`), pembuat, dipakai terakhir, dicabut. Kunci hanya ditampilkan sekali.
- [x] **T-078** API v1 (`Authorization: Bearer …`): `POST /api/v1/events` (draf / langsung) dengan identitas peminta dari WhatsApp; `GET /api/v1/events?days=` jadwal mendatang. Audit setiap pembuatan.
- [x] **T-079** "Langsung dibuatkan": setelah agenda Aurix siap, agenda dikirim ke grup + pengingat aktif; bila Aurix gagal, pakai agenda sederhana dari data acara.
- [x] **T-080** Halaman admin **Integrasi API** (di Profil): buat key (nama + izin), tampil sekali + salin, daftar, cabut.
- [x] **T-081** Skill Hermes `chat-center` + skrip pemanggil (membaca identitas sesi dari gateway) + skrip pasang untuk pemilik.
- [ ] **T-082** Uji nyata dari grup WhatsApp (pemilik).

## Acceptance Criteria

**Epic-level**

- Tanpa key yang sah dan berizin: 401/403. Key yang dicabut langsung tidak berlaku.
- Peminta yang nomornya tidak terverifikasi tidak bisa membuat acara.
- Semua acara dari WhatsApp tercatat (audit + "dibuat lewat WhatsApp oleh …").

**Per-task**

- **T-078** — Data tidak valid → 400 dengan pesan yang bisa diteruskan agent; grup harus dikenal bot; untuk grup, peminta harus baru menulis di grup itu.
- **T-079** — Mode langsung: agenda terkirim ke grup asal tanpa klik di web; pengingat terjadwal.
- **T-080** — Hanya admin; key tampil sekali; cabut berlaku seketika.

## Automation Log

- 2026-10-19 Epic dibuat atas permintaan pemilik (agent WA membuat jadwal di web; agent bertanya draf atau langsung). Riset: agent WA (profil default) punya tool terminal/file/skills, tanpa web/browser; gateway Hermes memasang `HERMES_SESSION_CHAT_ID/USER_ID/USER_ID_ALT/USER_NAME` pada setiap perintah terminal agent (tidak dari teks model); pada sesi grup WhatsApp `user_id` = nomor pengirim `@s.whatsapp.net` — on-progress
- 2026-10-19 T-077…T-081 selesai. Skema v10: `api_keys` (hash sha256, awalan, izin, dipakai terakhir, dicabut) + `events.source`/`events.auto_send_by`. `lib/integrations.js`: key `cc_…` tampil sekali, batas 60 panggilan/menit/key; `POST /api/v1/events` (mode wajib `draft`/`send`; peminta = nomor dari `HERMES_SESSION_USER_ID(_ALT)`, LID dipetakan lewat file lid-mapping bridge, harus nomor terverifikasi + di grup harus baru menulis ≤15 menit menurut arsip grup; grup tujuan default = grup asal) dan `GET /api/v1/events?days=`; galat berkode + pesan yang bisa diteruskan agent; audit `api_key_created/revoked`, `api_event_created`, `api_denied`. Mode langsung: begitu agenda Aurix siap → `send` atas nama peminta; Aurix gagal → agenda sederhana dari data acara lalu tetap dikirim. Admin-only kartu **Integrasi API** di Profil; Schedule menandai "Dibuat lewat WhatsApp". Skill Hermes `deploy/hermes/skills/chat-center` (SKILL.md + `scripts/chat_center.py`, identitas dari env sesi gateway, key dari file) + `scripts/install-hermes-skill.sh` untuk pemilik. Tes 125/125 (7 baru termasuk skrip Python sungguhan melawan server uji, 1 UI), gates PASS, screenshot sandbox. Sisa: T-082 uji nyata dari grup (pemilik memasang skill).
- 2026-10-19 Restart oleh agent: PID 826375 → 890569, gates PASS, `/healthz` ok, skema v10 — live; `/api/v1/events` tanpa key → 401 JSON lewat Cloudflare. Menunggu pemilik: buat key, jalankan `scripts/install-hermes-skill.sh`, uji dari grup (T-082).
- 2026-10-19 Permintaan pemilik: nama bot WhatsApp di Chat Center ditulis **Aurix**, bukan "Rederp" (UI Profil, Integrasi API, README, skrip pasang, dokumen ini). Nama yang terlihat di grup WhatsApp berasal dari nama profil akun WhatsApp bot (`creds.json` → "Rederp") dan diganti pemilik dari aplikasi WhatsApp.

## Dependencies

- EPIC-009 (Schedule), EPIC-012 tahap 3 (nomor WhatsApp terverifikasi), EPIC-008 (arsip grup WhatsApp).
