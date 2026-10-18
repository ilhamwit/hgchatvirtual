# EPIC-006: Agent untuk Kerja Tim

status: backlog
environment: dev
phase: 3
priority: P2
area: Backend
retries: 0
prd: -
stories: -
tasks: T-031 … T-034

## Goal

Agent tidak hanya menjawab chat, tetapi membantu pekerjaan tim sehari-hari:
membaca dan membuat task di Backstage (task management yang sudah berjalan di
`~/taskmanagement`, Next.js + Postgres), membuat ringkasan, dan bekerja di ruang
percakapan bersama. **Lingkup detail perlu masukan dari tim** — task di bawah
adalah usulan awal.

## User Stories

- **US-TEAM-1** — Sebagai anggota tim, saya ingin meminta agent "buatkan task untuk Irfan, deadline Jumat", supaya tidak perlu pindah aplikasi.
- **US-TEAM-2** — Sebagai anggota tim, saya ingin ringkasan harian pekerjaan tim dari agent.
- **US-TEAM-3** — Sebagai tim, kami ingin satu percakapan bersama dengan agent yang bisa dibaca semua anggota.

## Tasks

### Discovery

- [ ] **T-031** Wawancara singkat tim: 3–5 pekerjaan berulang yang paling ingin dibantu agent; putuskan agent mana memegang peran apa (Operations, People, Technology, Data, Finance).

### Integrasi Backstage

- [ ] **T-032** Tool/skill OpenClaw untuk Backstage (list/create/update task) dengan akun layanan berizin terbatas; agent bertindak atas nama user yang meminta.

### Ringkasan & ruang bersama

- [ ] **T-033** Ringkasan harian per agent lewat heartbeat/cron OpenClaw, dikirim ke percakapan tim.
- [ ] **T-034** Percakapan bersama (`shared`): terlihat semua anggota, pengirim tiap pesan ditampilkan.

## Acceptance Criteria

**Epic-level**

- Minimal satu alur kerja nyata tim selesai end-to-end lewat agent tanpa membuka Backstage.
- Setiap aksi agent di Backstage tercatat atas nama user peminta.

**Per-task**

- **T-031** — daftar prioritas tertulis dan disetujui di epic ini.
- **T-032** — agent tidak bisa menghapus task (izin dibatasi).
- **T-033** — ringkasan terkirim tepat waktu 5 hari berturut-turut.
- **T-034** — user non-anggota percakapan tidak bisa membacanya.

## Automation Log

- 2026-10-18 Epic dibuat sebagai usulan; menunggu discovery dengan tim — backlog

## Dependencies

- EPIC-002, EPIC-003. Integrasi Backstage butuh akses API/DB `taskmanagement`.
