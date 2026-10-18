# hg-chat-center — Conventions

This file is the stable convention entry point referenced by both `CLAUDE.md` and `AGENTS.md`. All
values are sourced from `.agentic/config.yml` so the conventions stay in sync with the manifest.

## Global Guardrails

- Never hardcode secrets. Use environment variables and `.env.example`.
- Never deploy production from autonomous loops. DEV-only automation uses
  `(none yet — EPIC-000 T-005)`.
- Never force-push or run destructive database commands from an agent loop.
- Keep changes scoped to the task. Avoid unrelated refactors.

## Protected / Foundation Paths

Shared/foundation files are protected unless the task explicitly requires a reviewed foundation change:

`docs/epics/EPIC-template.md`

Agents (especially `code-agent`) must read but not modify these without an explicit reviewed task.

## Project Conventions

- **Page pattern:** `n/a (single page: hg-chat-ai-agent.html + login.html)` — new pages/routes follow this shape.
- **Shared types:** `n/a` — import shared contracts/types from here;
  do not redeclare them locally.
- **Workspaces:** `none` (tool: `none`).
- **Package manager:** `npm`.
- **Notes:** LIVE FOLDER: systemd `chat-center.service` (port 8643, agents.herrygunawan.com) runs from this directory — HTML edits go live on the next page load and `server.js` edits go live on restart. Never restart the service from an agent; test on a separate port. Vanilla Node v26, no framework, no build step; prefer built-in modules (`node:sqlite`, `node:crypto`, `node:test`) over new dependencies. Secrets live only in `~/.config/chat-center.env`. User-facing copy is Bahasa Indonesia.
- Reuse existing utilities/components before creating local replacements.

## Tenant Scoping

`tenant.scope_fields` = `[] (multi-user, single-tenant)`.

- When **non-empty**, every data-access path / API handler must be scoped by these fields; the review
  and security gates enforce it.
- When **empty (`[]`)**, this project is single-tenant / non-SaaS and tenant checks are **skipped**
  entirely.

## Branches

- **Integration branch** (PRs target this): `main`.
- **Primary branch** (production-tracking): `main`.

## Gates

| Gate | Script |
| ---- | ------ |
| QA (lint + static) | `scripts/qa.sh` |
| Test (build + tests) | `scripts/test.sh` |
| Security | `scripts/security-check.sh` |

Every task clears the project Definition of Done (`docs/DEFINITION-OF-DONE.md`) before it is
considered done.
