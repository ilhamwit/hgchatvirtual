# HG Chat AI Agent — Epics

> **Canonical status registry.** File ini + frontmatter tiap `EPIC-XXX-*.md` adalah
> *status kerja yang hidup*. Kalau backlog, PRD, atau catatan lain berbeda dengan
> sebuah epic, **epic yang menang**. Template ada di
> [`EPIC-template.md`](EPIC-template.md) (dari agentic-workflow-kit).

Tujuan besar: menjadikan HG Chat AI Agent (agents.herrygunawan.com) sistem yang
layak pakai untuk **tim internal** (Ilham, Irfan, Cahyo, dll) — multi-user,
riwayat tersimpan di server, dan agent yang benar-benar membantu kerja tim.

## Registry

| Epic                                                   | Phase   | Focus                                   | Priority | Status  |
| ------------------------------------------------------ | ------- | --------------------------------------- | -------- | ------- |
| [EPIC-000](EPIC-000-foundation.md)                     | Phase 0 | Fondasi repo, struktur file, env        | P0       | done |
| [EPIC-001](EPIC-001-multi-user-auth.md)                | Phase 1 | Akun per orang & sesi login             | P0       | done |
| [EPIC-002](EPIC-002-server-side-history.md)            | Phase 1 | Riwayat percakapan di server + API chat | P0       | done |
| [EPIC-003](EPIC-003-streaming-chat-ux.md)              | Phase 2 | Streaming & UX percakapan               | P1       | backlog |
| [EPIC-004](EPIC-004-attachments-retention.md)          | Phase 2 | Lampiran per percakapan + retensi       | P1       | backlog |
| [EPIC-005](EPIC-005-operations.md)                     | Phase 2 | Operasional: backup, health, log        | P1       | done |
| [EPIC-006](EPIC-006-team-agents.md)                    | Phase 3 | Agent untuk kerja tim (Backstage dll)   | P2       | backlog |
| [EPIC-007](EPIC-007-hermes-backend.md)                 | Phase 1 | Backend agent pindah ke Hermes          | P0       | done |
| [EPIC-008](EPIC-008-whatsapp-agent.md)                 | Phase 2 | Menu WhatsApp (grup, ringkasan, nomor)  | P1       | ready-for-qa |
| [EPIC-009](EPIC-009-schedule.md)                       | Phase 2 | Schedule: jadwal & meeting (agenda, kirim ke grup, pengingat) | P1       | on-progress |
| [EPIC-010](EPIC-010-task-focus.md)                     | Phase 2 | Task Focus: tugas tim, fokus saya, papan | P1       | on-progress |
| [EPIC-011](EPIC-011-chat-sessions-files.md)            | Phase 2 | Sesi chat per agent & pratinjau file    | P1       | ready-for-qa |
| [EPIC-012](EPIC-012-team-discussion.md)                | Phase 2 | Chat & Discussion: channel, DM, real-time | P1       | ready-for-qa |
| [EPIC-013](EPIC-013-api-integration.md)                | Phase 2 | Integrasi API: agent WA membuat jadwal  | P1       | on-progress |
| [EPIC-014](EPIC-014-settings.md)                       | Phase 2 | Settings: akun tim, API key, status      | P1       | ready-for-qa |
| [EPIC-015](EPIC-015-reports.md)                        | Phase 2 | Reports: arsip laporan agent, mingguan   | P1       | ready-for-qa |
| [EPIC-016](EPIC-016-voice-mode.md)                     | Phase 3 | Voice mode: ngobrol suara dengan agent   | P1       | on-progress |

**Definition of MVP:** selesainya EPIC-000 → EPIC-002.

## Status Lifecycle

```
backlog → on-progress → coding → review → testing → deploying-dev → ready-for-qa → done
                                                                   ↘ blocked (on failure)
```

| Status          | Meaning                                                        |
| --------------- | -------------------------------------------------------------- |
| `backlog`       | Belum dimulai; **diabaikan otomasi**.                          |
| `on-progress`   | Diambil loop; siap diproses.                                   |
| `coding`        | Sedang mengimplementasi satu task.                             |
| `review`        | Sedang code/QA review.                                         |
| `testing`       | Menjalankan test/quality gate.                                 |
| `deploying-dev` | Deploy ke DEV (bukan production).                              |
| `ready-for-qa`  | Semua task lolos gate — **perlu QA manusia** sebelum done.     |
| `blocked`       | Gagal setelah `retries` maksimum — **perlu tindakan manusia**. |
| `done`          | Selesai; **diabaikan otomasi**.                                |

`environment` maju terpisah: `dev → staging → prod`. Catatan: saat ini Chat Center
hanya punya satu lingkungan (service `chat-center` di port 8643, dipublikasikan
lewat Cloudflare Tunnel) — EPIC-000 menyiapkan instance dev terpisah.

## Conventions

- **Satu epic = satu fitur/milestone.** Dipecah jadi blok `### task group`
  (seukuran satu PR) di dalam file epic.
- **T-ID berurutan lintas epic** (T-001, T-002, …) supaya tidak bentrok.
- **Automation Log adalah jangkar durabilitas.** Setiap keputusan penting dan
  setiap run dicatat di `## Automation Log` epic terkait, format
  `YYYY-MM-DD <apa yang terjadi> — <hasil>`.
- **Tambah epic baru:** salin [`EPIC-template.md`](EPIC-template.md), beri nomor
  berikutnya, lalu tambahkan baris di registry di atas.
