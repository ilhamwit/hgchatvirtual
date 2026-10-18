---
description: Work ONE task from an epic (a single `### task group`) through the discovery-first gates, then auto branch → push → PR to the integration branch. DEV-only, never production.
argument-hint: EPIC-XXX [task-number]
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
---

# /task-work

Implement **one task** from an epic in this main session (you may use the Task tool to delegate).
Arguments: **$ARGUMENTS** → `<EPIC-ID> [task-number]` (e.g. `EPIC-002 3`).

A "task" is one `### <heading>` group under `## Tasks` (it usually maps 1:1 to a GitHub issue whose
title equals the heading). Each group contains several `- [ ]` sub-steps that you complete together.
If `task-number` is omitted, pick the **first group that still has unchecked `- [ ]` sub-steps**.

Operates under `~/.claude/rules/ecc/common/*.md` (nervous-system, agent-routing, self-learning).

> **Graceful degradation.** Memory / graph / recommender steps are best-effort; skip what's missing.

## Guardrails (hard limits)

- DEV only. NEVER deploy to production. NEVER force-push. NEVER run destructive DB commands.
  No hardcoded secrets. Do not change CI/CD deploy targets. Do not delete files unless the task requires it.
- Do not touch the protected/foundation paths: `docs/epics/EPIC-template.md`.

## Step 0 — RETRIEVE (warm start)

Before branching, warm the context (best-effort): recall prior decisions/patterns for this epic via
`npx ruflo memory search --query "<task heading>" --namespace "hg-chat-center:<EPIC-ID>"`
(or `mcp__claude-flow__agentdb_pattern-search`); query `graphify-out/graph.json` if present; read the
epic's `Automation Log`.

## Gate design (discovery-first; who runs in each gate)

Run pre-built ECC/Ruflo agents + custom agents **from this main session** (sub-agents cannot spawn
sub-agents) and aggregate findings into one verdict per gate. Route the recommender's suggestion
first (`hooks_route` / `guidance_recommend`), then the static fallback below.

- **Review gate** = matching `ecc:*-reviewer` for the file types that changed (`.tsx/.jsx` →
  `ecc:react-reviewer`; `.ts/.tsx` → `ecc:typescript-reviewer`; other languages → their reviewer)
  **plus** `review-qa-agent` (acceptance criteria + conventions + tenant scoping when
  `[] (multi-user, single-tenant)` is non-empty). **FAIL** on any CRITICAL/HIGH finding or `VERDICT: FAIL`.
- **Security gate** = `ecc:security-reviewer` + `security-agent` (runs `scripts/security-check.sh`).
  **FAIL** on any CRITICAL/HIGH finding, `VERDICT: FAIL`, or non-zero script exit.
- **Test gate** = `test-agent` (`scripts/qa.sh` then `scripts/test.sh`). **FAIL** on non-zero exit.

## Algorithm

1. **Locate the epic** `docs/epics/$EPIC-ID-*.md`. STOP if `status` is `done` or `backlog`.
   Select the target `### task group` per the rule above. If every sub-step is already `- [x]`, STOP
   and report "task already complete" (idempotent — do not re-run).
2. **Extract context**: the epic Goal, the group's sub-steps, and the `## Acceptance Criteria` relevant
   to this task. If the task is ambiguous or cross-cutting, normalize it first (Evidence, Scope,
   Acceptance Criteria, Test Plan, Agent Routing, Done Signal).
3. **Branch**: `git fetch origin` then
   `git switch -c feat/<epic-slug>-task-<n>-<heading-slug> origin/main`
   (slug = lowercased heading, non-alphanumerics → `-`). If the branch already exists, switch to it.
4. **Bounded loop (attempt 1..3)**:
   a. **Write tests first (RED)** → `Task(subagent_type: "test-agent")` derives automated tests from
   the task's acceptance criteria + Test Plan (unit/integration; one E2E smoke when the task touches
   a critical journey). New tests must FAIL before implementation and ship with the change. On a
   retry, reuse the existing tests instead of rewriting them.
   b. **Implement (GREEN)** → `Task(subagent_type: "code-agent")` with the task, its sub-steps,
   acceptance criteria, relevant paths, the failing tests to satisfy, and (if retry) the prior findings.
   c. **Review gate** → run the Review-gate agents (reviewers only for the file types that changed),
   aggregate to PASS/FAIL.
   d. **Security gate** → run `ecc:security-reviewer` + `security-agent`, aggregate to PASS/FAIL.
   e. **Test gate** → `Task(subagent_type: "test-agent")` runs the **full suite** — the new tests plus
   every existing test; a regression in an older feature is a FAIL like any other. If it FAILs on a
   TypeScript/compile/build error, route the fix to a build resolver (`ecc:react-build-resolver` /
   `ecc:build-error-resolver`), then re-run the gates.
   f. If all gates PASS → break. Else collect findings, `attempt += 1`, continue. After attempt 3 still
   failing → go to step 7 (blocked).
5. **On success — commit, push, PR**:
   - Mark every sub-step of the group `- [x]` (Edit) and add ` ✅` to the group heading (repo convention).
   - Append one line to a `## Automation Log` section (create it before `## Dependencies` if missing):
     `- <date> /task-work <EPIC-ID> #<n> "<heading>" → PASS (attempts: <k>), PR: <url>`.
   - **JUDGE + DISTILL + CONSOLIDATE** (best-effort):
     `npx @claude-flow/cli hooks post-task --task-id "<EPIC-ID>-<n>" --success true`;
     `npx ruflo memory store --namespace "hg-chat-center:<EPIC-ID>" --key "<slug>" --value "<lesson>"`;
     `npx @claude-flow/cli memory store --namespace patterns …` — and the Automation Log line above is
     the durable record.
   - Commit (conventional, e.g. `feat: <heading>`).
   - **Link the GitHub issue** (issue titles equal the task headings):
     `gh issue list --state all --search "<heading> in:title" --json number,title,state`. Match the
     title exactly, case-insensitively; if several match, prefer the `OPEN` one. Capture `<issue>`. If
     nothing matches, note "no issue matched" and proceed without a closing ref.
   - `git push -u origin <branch>` (non-force).
   - `gh pr create --base main --head <branch> --title "<conventional title>"`.
     Put `Closes #<issue>` on its **own line near the top of the PR body** (GitHub only auto-links from a
     closing ref in the body/commits). The body also lists the task, what changed, and the acceptance
     criteria. Capture the PR URL.
   - **Verify the link**: `gh pr view <pr> --json closingIssuesReferences` should list `<issue>`. If
     empty, patch with `gh pr edit <pr> --body-file <file>` adding `Closes #<issue>`.
6. Print a summary: task, attempts, each gate verdict, distilled lesson, branch, PR URL.
7. **On block after 3 attempts**: do NOT push. Append a `## Automation Log` line marking the task
   `→ BLOCKED` with the failing gate + findings. Distill the negative lesson. Leave the epic `status`
   unchanged (single task). Report the blocker and stop (L3 escalate).

## Notes

- One task = one focused, reviewable change. Never weaken or skip tests to make them pass.
- The orchestrator (you) flips checkboxes and runs git/PR — `code-agent` never commits or pushes.
- For broad discovery, use Ruflo/AgentDB as a read-only scoping layer, then copy durable findings into
  the epic `Automation Log`; runtime state dirs are not project docs.
