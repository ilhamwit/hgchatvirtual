---
description: The centralized brain — sense a task, retrieve context, route to the best pre-built agent or organ command, run gates, then learn from the result.
argument-hint: "<task>"
---

# /nerve "$ARGUMENTS"

`/nerve` is the front door of the agentic nervous system for `hg-chat-center`. It is a
**thin frontend** over the model-agnostic spec in `~/.agentic-workflows/nerve-runbook.md` — read that
runbook for the authoritative algorithm; this command adapts it to Claude Code.

It also operates under the global rules auto-loaded from `~/.claude/rules/ecc/common/*.md`
(nervous-system, self-learning, graph-intelligence, memory-protocol, agent-routing,
testing-taxonomy, loop-engineering). Follow them.

> **Graceful degradation.** Every memory / graph / recommendation step is best-effort. If
> `.agentic/config.yml`, Ruflo, AgentDB, Graphify, or an MCP tool is missing, skip that step and
> continue. A no-op is always acceptable; never block the task on optional tooling.

---

## Setup

Read `.agentic/config.yml` if present. Resolve once:

- **namespace** = `hg-chat-center` → else `hg-chat-center` → else git repo basename.
- **branch** = `git rev-parse --abbrev-ref HEAD` (default `main`).
- **gates** = `scripts/qa.sh`, `scripts/test.sh`, `scripts/security-check.sh`.

Memory keys are `<namespace>[:<branch>][:<epic>]`.

### Loop preflight (only when enabled)

If `.agentic/config.yml` sets `loop.enabled: true`, read the configured loop
constraints, state, and run log before triage. Stop with a recorded `paused`
outcome if the kill-switch exists; stop at the daily budget and switch to
report-only at 80%. Run `bash scripts/loop-readiness.sh` when available.

An L1 loop may report only. An L2 loop may make one local attempt only in an
isolated worktree with a separate verifier. Neither level may push, open a PR,
merge, deploy, or mutate a third-party service without explicit human approval.

## Algorithm

1. **L1 — SENSE.** Classify `$ARGUMENTS` into one capability
   (`review · build-fix · security · architecture · research · coding · docs · test · deploy · memory`)
   and a complexity/risk level. If it is a trivial, low-risk, single-file transform, just do it
   directly with `Edit`, run the matching gate, and skip to step 5.

   **Persona auto-select.** After classifying, map to the default expert persona
   from `~/.agentic-workflows/expert-personas.md` and print it as a framing header:

   | Capability | Persona |
   |------------|---------|
   | coding — greenfield / MVP | `startup-mvp` |
   | review — architecture / unfamiliar codebase | `codebase-audit` |
   | build-fix / bug / debugging | `debug-production` |
   | performance / optimization | `perf-optimize` |
   | refactor / clean-up | `clean-architecture` |
   | coding — backend / API / DB | `backend-systems` |
   | coding — frontend / UI | `frontend-engineer` |
   | architecture / planning | `tech-lead` |
   | security | `security-audit` |
   | deploy / devops / infra | `devops-deploy` |

   Override with `/engage <persona> "$ARGUMENTS"` to force a specific persona.

2. **RETRIEVE.** Warm the context from all available sources (merge what returns):
   - Memory: `npx ruflo memory search --query "$ARGUMENTS" --namespace "<namespace>"`
     (or `mcp__claude-flow__agentdb_pattern-search` / `agentdb_semantic-route` MCP).
   - Graph: query `graphify-out/graph.json` if it exists ("which files relate / where used").
   - Docs: read the relevant `/docs` source-of-truth + active epic `Automation Log`.
   - External: Context7 for library/API docs before implementing anything library-specific.

3. **DECIDE TIER.** Trivial → done in step 1. Standard → **L2**. High-risk or ambiguous or
   conflicting recall → **L3** (clarify with `AskUserQuestion` + Sequential-Thinking MCP) first, then L2.

4. **L2 — COORDINATE (discovery-first).**
   - Ask for a recommendation: `mcp__claude-flow__guidance_recommend` / `guidance_discover` /
     `hooks_route`, or `npx @claude-flow/cli hooks route --task "$ARGUMENTS"`.
   - **Prefer pre-built agents/skills:** ECC reviewers/resolvers (`ecc:react-reviewer`,
     `ecc:typescript-reviewer`, `ecc:security-reviewer`, `ecc:database-reviewer`,
     `ecc:react-build-resolver`, `ecc:build-error-resolver`), then Ruflo families
     (`ruflo-core:*`, `ruflo-swarm:*`, `ruflo-rag-memory:memory-specialist`).
   - **Custom project agents only for project-specific behavior** (conventions, tenant scoping,
     repo gates): `code-agent`, `review-qa-agent`, `security-agent`.
   - **Or invoke an organ command** when the task is already shaped:
     `/agentic-start` (raw drop), `/task-work` (one task → PR), `/epic-loop` (whole epic).
     `/nerve` orchestrates these; it does not replace them.
   - Implement the minimal change. Respect `docs/epics/EPIC-template.md`,
     `n/a (single page: hg-chat-ai-agent.html + login.html)`, and `[] (multi-user, single-tenant)` (when non-empty).

5. **RUN GATES.** Run each gate that exists; collect PASS/FAIL:
   ```
   bash scripts/qa.sh
   bash scripts/test.sh
   bash scripts/security-check.sh
   ```
   Any failure → return to step 4 (max 3 retries, then escalate).

6. **JUDGE.** `success = all run gates passed`. Label the trajectory:
   `npx @claude-flow/cli hooks post-task --task-id "<slug>" --success <true|false> --store-results true`
   (or `mcp__claude-flow__agentdb_feedback` MCP).

7. **DISTILL.** Store the minimal reusable lesson:
   `npx ruflo memory store --namespace "<namespace>" --key "<slug>" --value "<lesson>"`
   (or `mcp__claude-flow__agentdb_context-synthesize` MCP).

8. **CONSOLIDATE.** Merge into long-term memory + record durably:
   `npx @claude-flow/cli memory store --namespace patterns --key "<slug>" --value "<lesson>"`
   (or `mcp__claude-flow__agentdb_consolidate` MCP), **and** append the decision to the active epic
   `Automation Log` (memory is a cache, docs are the system of record).

9. **L3 — ESCALATE** if blocked: after 3 gate failures set the task/epic `status: blocked`, record
   `reason · logs · recommended action`, and stop.

## Guardrails

DEV deploy only · no force-push · no destructive DB · no committed secrets. These are enforced by the
`guardrail.sh` PreToolUse hook — do not work around them.
