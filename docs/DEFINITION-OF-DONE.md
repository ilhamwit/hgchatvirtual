# HG Chat Center — Definition of Done

> Batas yang harus dilewati setiap task sebelum dianggap **done**. Acceptance
> criteria di epic menyatakan *apa* yang harus benar; daftar ini menambahkan
> bukti *proses*. Path dideklarasikan di `.agentic/config.yml` →
> `docs.definition_of_done`.

## The checklist

- [ ] **Committed on `main` after review** — perubahan ditinjau manusia (diff dilihat) lalu di-commit; tidak pernah force-push. (Belum ada remote/PR; bila nanti ada, ganti jadi "merged via reviewed PR".)
- [ ] **Acceptance Criteria pass** — setiap kriteria task di epic terbukti: test menegaskannya, gate lulus, atau reviewer memverifikasi di instance dev. Sebelum epic lewat `ready-for-qa`, setiap kriteria level-epic harus ditegaskan oleh test otomatis di `scripts/test.sh`.
- [ ] **Gates green** — `scripts/qa.sh`, `scripts/test.sh`, `scripts/security-check.sh` semuanya PASS.
- [ ] **Tests added/updated** — perilaku baru/berubah dicakup `node:test` (unit/integrasi) atau smoke di `test.sh`.
- [ ] **Security reviewed** — tidak ada secret ter-commit; tidak ada celah authz/injection/SSRF baru; setiap query data user dicek kepemilikannya (setelah EPIC-002); `protected_paths` tidak tersentuh.
- [ ] **Docs updated** — `## Automation Log` epic pemilik mencatat hasilnya; `MEMORY.md`, PRD, atau README diperbarui bila faktanya berubah.
- [ ] **Diuji di instance dev, bukan production** — dijalankan di port terpisah (setelah EPIC-000 T-005: `npm run dev`). Folder ini disajikan langsung oleh `chat-center.service`: rilis ke production (restart service) adalah langkah manusia.

## Who enforces each line

| DoD line            | Enforced by                                              |
| ------------------- | -------------------------------------------------------- |
| Committed on main   | Review manusia + guardrail hook (no force-push)          |
| Acceptance Criteria | review-qa-agent terhadap kriteria di epic                |
| Gates green         | `scripts/qa.sh` · `scripts/test.sh` · `scripts/security-check.sh` |
| Tests added         | test gate                                                |
| Security reviewed   | security gate + security-agent                           |
| Docs updated        | langkah update Automation Log di `/nerve` / `/task-work` |
| Diuji di dev        | test gate (boot smoke di port acak) + verifikasi manual  |

> Single-tenant (`tenant.scope_fields: []`): sub-item tenant dilewati, tetapi
> pengecekan kepemilikan per user tetap wajib setelah EPIC-002.
