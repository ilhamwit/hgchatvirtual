---
description: Drop a raw task/enhancement, turn it into an epic/task group, scope with discovery-first routing (ECC/Ruflo/Graphify), and start the correct development workflow when ready.
argument-hint: '"task or enhancement brief"'
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
---

# /agentic-start

Start the `hg-chat-center` agentic loop from a raw task/enhancement.

Input: **$ARGUMENTS**

Operates under the global rules in `~/.claude/rules/ecc/common/*.md` (nervous-system, agent-routing,
self-learning, docs-source-of-truth). Read the project rules `CLAUDE.md`, `AGENTS.md`,
`CONVENTIONS.md` and the standard doc set under `docs`.

> **Graceful degradation.** Memory / graph / recommender steps are best-effort; skip any that are
> unavailable and continue.

## Hard Guardrails

- No production deploy. No force push. No destructive database command.
- No hardcoded secrets or real `.env` files.
- Do not mutate GitHub/project boards unless the user explicitly asks.
- Runtime memory is not the source of truth; copy durable decisions into docs.

## Step 0 — RETRIEVE (warm start)

Before classifying, warm the context (best-effort; merge what returns):

- **Memory** (HNSW recall): `npx ruflo memory search --query "$ARGUMENTS" --namespace "hg-chat-center"`
  (or `mcp__claude-flow__agentdb_pattern-search` / `agentdb_semantic-route`).
- **Graph**: query `graphify-out/graph.json` if it exists (relationships / where used).
- **Docs**: scan `docs/epics`, `docs/product/`,
  `docs/BACKLOG.md` for matching work.

## Algorithm

1. **Agent inventory (discovery-first).** Ask the recommender for candidate agents
   (`mcp__claude-flow__guidance_recommend` / `guidance_discover` / `hooks_route`, or
   `npx @claude-flow/cli hooks route --task "$ARGUMENTS"`). Then build the map:
   - **Pre-built (prefer):** ECC reviewers/resolvers/skills (planner, architect, React/TS reviewers,
     security reviewer, build resolvers, database reviewer, docs lookup, TDD, framework skills);
     Ruflo families (`ruflo-core:*`, `ruflo-swarm:*`, `ruflo-rag-memory:memory-specialist`).
   - **Custom (project-specific only):** `code-agent`, `review-qa-agent`, `security-agent`,
     `test-agent`, `deploy-agent`, `epic-orchestrator`.
   - **Graphify** if `graphify-out/graph.json` exists or the task is architecture/relationship-heavy.

   Do not call every agent. Select the smallest useful route; custom agents only for project-specific
   behavior (conventions, tenant scoping, repo gates).

2. **Intake.**
   - Classify the request: bug, enhancement, refactor, security, infra, docs, UI, backend, or cross-cutting.
   - If the input points to initial brief docs or asks to initialize a product from documents, run
     **Product synthesis** before epic shaping.
   - Classify area (by workspace `none` / single-app), risk (low/medium/high
     — high = auth, tenant scoping, money movement, DB migration, production config, security, or broad
     cross-module behavior), and uncertainty (known change / needs discovery / possibly already implemented).

3. **Product synthesis (only for initial project briefs).** Generate or refresh the durable artifacts
   before creating implementation epics, in the standard format:
   - `docs/product/PRD.md` — product goal, personas, scope, non-goals, features, success metrics.
   - `docs/epics` — user stories grouped by persona/domain with acceptance criteria.
   - `docs/epics` — PR-sized engineering breakdown with dependencies, area, risk, test notes.

   Use ECC `product-capability`, planner/architect for sequencing, Ruflo/AgentDB for parallel evidence
   extraction, Graphify only if a graph exists. Do not invent product truth; mark unknowns as `Open Questions`.

4. **Dynamic agent route.** Choose ONE route package (smallest useful), preferring pre-built agents:

   | Task shape | Route (prefer pre-built) |
   | ---------- | ------------------------ |
   | Simple one-file docs/workflow | main session direct; no swarm |
   | Simple page/component | `code-agent` + Context7 docs if API-specific + matching `ecc:*-reviewer` + `review-qa-agent` |
   | API endpoint | `code-agent` + framework skill + `ecc:typescript-reviewer` + `security-agent` |
   | Schema / query | `ecc:database-reviewer` + migration/ORM skill + `security-agent` |
   | Auth, tenant, role, money/security | `ecc:security-reviewer` + project `security-agent` from the start |
   | Build failure | `ecc:react-build-resolver` / `ecc:build-error-resolver` first, then rerun gates |
   | Unknown / broad cross-area | Ruflo swarm for read-only scoping + `ecc:architect` before implementation |
   | Possible duplicate/existing feature | Graphify query + `ruflo-core:researcher` before creating files |

   Record the selected route in the epic task's `Agent Routing` section.

5. **Evidence map.** Build a short map: source request · matching docs/epic · existing implementation ·
   likely files · risks · test targets · selected route and agents.

6. **Scope only when useful.** Use ECC planner/architect for breakdown/architecture; Context7 for
   current framework/library APIs; Ruflo swarm for broad multi-area exploration. Do not spawn swarms
   for simple one-file tasks. Store useful findings, then copy durable conclusions into docs.

7. **Epic/task shaping.**
   - If a matching epic exists, append or normalize one `###` task group.
   - If no epic exists, create the next `docs/epics/EPIC-XXX-<slug>.md`.
   - For initial briefs, derive epics from the product docs.
   - New epics start as `status: backlog` unless the user explicitly asked to start development now.
   - Task groups must include or imply Evidence, Scope, Acceptance Criteria, Test Plan, Agent Routing,
     and Done Signal.

8. **Start development when ready.** If the task is PR-sized and the user asked to start:
   - set the epic to `status: on-progress`
   - execute the `/task-work` algorithm for the selected task group in this same session
   - run review, security, and test gates
   - update `Automation Log`

   If the task is not ready: stop after writing/normalizing the epic and report what is missing.

9. **JUDGE + DISTILL + CONSOLIDATE.** When development ran, close the loop (best-effort):
   - **Judge:** `npx @claude-flow/cli hooks post-task --task-id "<slug>" --success <bool>` (or `agentdb_feedback`).
   - **Distill:** `npx ruflo memory store --namespace "hg-chat-center:<EPIC-ID>" --key "<slug>" --value "<lesson>"`
     (or `agentdb_context-synthesize`).
   - **Consolidate:** `npx @claude-flow/cli memory store --namespace patterns …` (or `agentdb_consolidate`),
     **and** append the decision to the epic `Automation Log`.

## Output

Print: intake classification · selected/created epic path · product docs generated or reused · task
group number/title · selected route (pre-built vs custom, with justification for any custom choice) ·
whether development started · distilled lessons · next command to run.
