---
description: Bootstrap or maintain this project's agentic state — auto-detects new | existing | maintenance and scaffolds the manifest, gates, hooks, agents, commands, and standardized docs.
argument-hint: "[new|existing|maintenance]"
---

# /agentic-init $ARGUMENTS

Bootstraps or maintains `hg-chat-center` against the agentic workflow. This is a **thin
frontend** over the model-agnostic spec in `~/.agentic-workflows/bootstrap-new-project.md` — read that
runbook for the authoritative steps; this command adapts them to Claude Code.

> **Graceful degradation.** Optional tooling (Ruflo, AgentDB, Graphify, MCP) is best-effort; the core
> scaffold only needs bash + git. Skip what's unavailable.
>
> **Existing-project safety.** In `existing` and `maintenance` modes the change is **strictly
> additive** — only `.agentic/`, `.claude/`, `docs`, and gate scripts are added or
> repaired. **Never edit application source code.** The result must be a clean additive `git diff`.

---

## 1. Determine mode

If `$ARGUMENTS` names a mode, use it. Otherwise auto-detect (first match wins):

| Mode | Signal |
|------|--------|
| **new** | empty / near-empty repo (no source tree; only README/LICENSE/.git) |
| **existing** | has app code but **no** `.agentic/config.yml` and no `.claude/` agentic wiring |
| **maintenance** | `.agentic/config.yml` already present (already agentic) |

Detect package manager (lockfile / `packageManager` field), monorepo tool
(`turbo.json`/`nx.json`/`lerna.json`), integration branch (current / remote HEAD), and project type
(workspaces → monorepo, else single-app). These populate `.agentic/config.yml`.

## 2. Run the mode

### new
1. Scaffold from `~/.agentic-workflows/templates/`: `claude/` (commands, agents, hooks, settings
   snippet), applicable `codex/` adapter, gate `scripts/`, `docs` skeletons — substitute `{{placeholders}}` from
   detection/answers.
2. Write `.agentic/config.yml` from the template with detected values; leave unknowns blank (auto at runtime).
3. Product synthesis in order: PRD → User Stories → Acceptance Criteria → Engineering Tasks → Backlog →
   `epics/README.md` → `EPIC-000-bootstrap.md` (standard format — see the `docs-source-of-truth` rule).
4. Make gate scripts executable; merge `.claude/settings.json` hooks non-destructively (preserve any
   existing rtk / guardrail entries).
5. Seed disabled loop constraints, state/run-log docs, and readiness/ledger/worktree helpers. Do not
   schedule or enable a loop before human review.
6. Kick off: `/nerve "<first task>"` or `/task-work EPIC-000 1`.

### existing (non-destructive)
1. Detect stack / pm / monorepo / branches / layout.
2. Write `.agentic/config.yml` with detected values; surface for user review. Leave
   `tenant.scope_fields: []` unless multi-tenant evidence is found.
3. Drop generic `scripts/`, `.claude/{hooks,agents,commands}/`, and the applicable `.codex/` or `.pi/`
   adapter; merge `settings.json` non-destructively. Never overwrite project customizations.
4. Reverse-engineer initial `docs` **from the actual code** (modules/routes/domains),
   in the standard format, marked as drafts for human review.
5. Add disabled loop controls; do not schedule or enable them.
6. Verify `git diff` shows ONLY `.agentic/`, `.claude/`, `docs/`, `scripts/`
   additions. Stop and report if anything else changed.

### maintenance
1. Sync generic scripts/hooks/agents/commands to the kit's current versions, preserving project customizations.
2. Fill missing standard artifacts (e.g. `DEFINITION-OF-DONE.md`, `ACCEPTANCE-CRITERIA.md`) and missing
   manifest keys with sane defaults. Add missing loop controls disabled; preserve any human-approved policy.
3. Normalize `docs/epics/*` statuses against the canonical lifecycle and the
   `epics/README.md` registry.
4. Run the gates to confirm no regression; report drift.

## 3. After any mode

- Run `bash install/verify.sh` (or the project's verify) to confirm wiring.
- Append a one-line note to the active epic `Automation Log` recording what the bootstrap did.

## Guardrails

No production deploy · no force-push · no destructive DB · no committed secrets · no app-code edits in
`existing`/`maintenance`.
