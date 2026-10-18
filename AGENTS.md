# hg-chat-center — Agent Instructions

This file is the model-agnostic entry point for `hg-chat-center`. Claude Code uses
`CLAUDE.md` and the project slash commands; Codex and any other harness use this file to follow the
same operating model without pretending Claude-only commands exist here.

## Load Order

Before changing code or workflow docs, read:

1. `CLAUDE.md` — project operating system, nervous-system pointers, custom agents, gates.
2. `CONVENTIONS.md` — project conventions (protected paths, page pattern, shared types).
3. The global rules at `~/.claude/rules/ecc/common/*.md` — nervous-system, agent-routing,
   self-learning, memory-protocol, graph-intelligence, docs-source-of-truth, testing-taxonomy.
4. The standardized doc set under `docs` (PRD, User Stories, Acceptance Criteria,
   Epics, Tasks, Backlog, Definition of Done).

## The Front Door — `/nerve` (thin-frontend translation)

`/nerve` is the centralized brain. In a non-Claude harness, translate it into its underlying steps —
sense → retrieve → route → run gates → judge/distill/consolidate — driven by
`~/.agentic-workflows/nerve-runbook.md`. The organ commands (`/agentic-start`, `/task-work`,
`/epic-loop`, `/epic-new`, `/agentic-init`) likewise map to concrete actions: locate the epic task,
inspect scope, implement minimally, run gates, update docs, summarize. Do not claim to "run" a
Claude-only command — perform the steps it describes.

## Discovery-First Default

Route every task by capability, ask the recommender (`hooks_route` / `guidance_recommend` when
available), and **prefer pre-built ECC/Ruflo agents** over hand-rolling. Use the custom project agents
(`code-agent`, `review-qa-agent`, `security-agent`, `test-agent`, `deploy-agent`, `epic-orchestrator`)
only for the project-specific slice — conventions, tenant scoping (`[] (multi-user, single-tenant)`),
and the repo gate scripts. Choose the smallest useful set; do not call every installed agent.

## Tool Responsibilities

| Tool | Use for |
| ---- | ------- |
| Claude Code | Main development sessions, `/task-work`, `/epic-loop`, sub-agents, branch/PR execution |
| Codex / other harness | Workflow hygiene, docs/runbook cleanup, status normalization, focused reviews, small scoped patches |
| Ruflo / AgentDB | Parallel exploration and reusable memory; copy durable findings into tracked docs |
| Graphify | Codebase relationship queries and cached architecture graph when `graphify-out/` exists |

## Defaults In This Repo

- Start from `docs` whenever the task references roadmap, epics, backlog, or product work.
- Prefer one `###` epic task group as the unit of work.
- Keep workflow changes small and auditable. Do not rewrite `CLAUDE.md` or generated content wholesale
  unless the user asks for a migration.
- Memory is a cache, not the record: copy durable decisions into the epic `Automation Log`.
- Preserve project guardrails: no production deploy, no force push, no destructive database commands,
  no hardcoded secrets, no real `.env` files.

## Verification

For code changes, use the project gates that match the blast radius:

- `bash scripts/qa.sh`
- `bash scripts/test.sh`
- `bash scripts/security-check.sh`
- focused E2E specs when UI behavior changes

For workflow-only changes, verify JSON/TOML/Markdown structure where possible and inspect `git diff`
before reporting completion.
