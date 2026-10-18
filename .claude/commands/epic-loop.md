---
description: Autonomous epic loop — retrieve, plan, code, review & QA, security, test, deploy DEV, update epic, with bounded retries and self-learning. DEV-only, never production.
argument-hint: docs/epics/EPIC-XXX.md
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
---

# /epic-loop

Act as the **epic-orchestrator** in this main session (you may use the Task tool to delegate to the
sub-agents). Target epic: **$ARGUMENTS**

If `$ARGUMENTS` is empty, scan `docs/epics/EPIC-*.md` and pick the first with
`status: on-progress`.

Operates under `~/.claude/rules/ecc/common/*.md` (nervous-system, agent-routing, self-learning,
docs-source-of-truth).

> **Graceful degradation.** Memory / graph / recommender steps are best-effort; skip what's missing
> and continue. A no-op never blocks the loop.

## Guardrails (hard limits)

- Process the epic ONLY if its frontmatter `status: on-progress`. Otherwise STOP and report.
- Deploy to **DEV only** via `(none yet — EPIC-000 T-005)`. NEVER deploy to production. NEVER
  force-push. NEVER run destructive database commands. Do not delete files unless necessary and
  explained. Do not change CI/CD deploy targets without explicit user review. No hardcoded secrets.

## Step 0 — RETRIEVE (warm start)

Before planning, warm the context (best-effort; merge what returns): recall prior decisions for this
epic via `npx ruflo memory search --query "<epic goal>" --namespace "hg-chat-center:<EPIC-ID>"`
(or `mcp__claude-flow__agentdb_pattern-search` / `agentdb_hierarchical-recall`); query
`graphify-out/graph.json` if present; read the epic Goal + Acceptance Criteria + `Automation Log`.
If a SessionStart warm-start block was injected, consume it instead of re-recalling.

## Gate design (discovery-first; who runs in each gate)

Prefer pre-built ECC/Ruflo reviewers for generic quality/security; the custom agents cover the
project-specific slice. Route the recommender's suggestion first (`hooks_route` /
`guidance_recommend`), then the static fallback. Run them **from this main session** (sub-agents
cannot spawn sub-agents) and aggregate into one verdict per gate.

- **Review gate** = matching `ecc:*-reviewer` for the changed file types (`.tsx/.jsx` →
  `ecc:react-reviewer`; `.ts/.tsx` → `ecc:typescript-reviewer`; other languages → their reviewer)
  **plus** `review-qa-agent` (acceptance criteria + conventions + tenant scoping when
  `[] (multi-user, single-tenant)` is non-empty). **FAIL** on any CRITICAL/HIGH finding or `VERDICT: FAIL`.
- **Security gate** = `ecc:security-reviewer` + `security-agent` (runs `scripts/security-check.sh`).
  **FAIL** on any CRITICAL/HIGH finding, a `VERDICT: FAIL`, or non-zero script exit.
- **Test gate** = `test-agent` (`scripts/qa.sh` then `scripts/test.sh`). **FAIL** on non-zero exit.

## Algorithm

1. **Read** the epic. Extract the slug (e.g. `EPIC-001`), Goal, acceptance criteria, and the unchecked
   `### task group` headings under `## Tasks`. Build an ordered plan (lowest-risk / dependency-first).
   Print the plan. If a task group is ambiguous, normalize it (Evidence, Scope, Acceptance Criteria,
   Test Plan, Agent Routing, Done Signal) before implementation.
2. **For each task group** (sequentially):
   - Derive `<heading-slug>` = lowercased heading, non-alphanumerics → `-`.
   - **Branch**: `git fetch origin`. Base = the **previous group's branch** when its PR has not
     merged yet (stacked — the gates must run WITH the prior group's code; basing on the integration
     branch without it means this group's gates run blind to the previous change), else
     `origin/main`. Then
     `git switch -c feat/<epic-slug>-task-<n>-<heading-slug> <base>`
     (if the branch already exists, switch to it).
   - attempt = 1
   - While attempt <= 3:
     1. **Write tests first (RED)** → Task(subagent_type: "test-agent") derives automated tests from
        this group's acceptance criteria + Test Plan (unit/integration; one E2E smoke when the task
        touches a critical journey). The new tests must FAIL before implementation and ship with the
        change. On a retry, reuse the existing tests instead of rewriting them.
     2. **Implement (GREEN)** → Task(subagent_type: "code-agent") with the sub-steps, acceptance
        criteria, relevant paths, the failing tests to satisfy, and (if retry) the prior findings.
     3. **Review gate** → run the Review-gate agents (reviewers only for the changed file types) and
        aggregate into one PASS/FAIL.
     4. **Security gate** → run `ecc:security-reviewer` and `security-agent`; aggregate into PASS/FAIL.
     5. **Test gate** → Task(subagent_type: "test-agent") runs the **full suite** — the new tests plus
        every existing test; a regression in an older feature is a FAIL like any other. Parse
        `VERDICT:`. If it FAILs on a TypeScript/compile/build error, route the fix to a build resolver
        (`ecc:react-build-resolver` / `ecc:build-error-resolver`), then re-run the gates.
     6. If all gates PASS → break. Else collect FAIL findings, attempt += 1, continue.
   - If still failing after attempt 3: record the task as a blocker (step 4) and stop the loop.
   - **On success — commit, push, PR**:
     - Mark every sub-step of the group `- [x]` and add ` ✅` to the group heading (Edit).
     - Append one line to a `## Automation Log` section (create it before `## Dependencies` if missing):
       `- <date> /epic-loop <EPIC-ID> #<n> "<heading>" → PASS (attempts: <k>), PR: <url>`.
     - **JUDGE + DISTILL + CONSOLIDATE** (best-effort):
       `npx @claude-flow/cli hooks post-task --task-id "<EPIC-ID>-<n>" --success true`;
       `npx ruflo memory store --namespace "hg-chat-center:<EPIC-ID>" --key "<slug>" --value "<lesson>"`;
       `npx @claude-flow/cli memory store --namespace patterns …` — the Automation Log line is the durable record.
     - Commit (conventional, e.g. `feat: <heading>`).
     - **Link the GitHub issue** (titles equal the task group headings):
       `gh issue list --state all --search "<heading> in:title" --json number,title,state`. Match
       exactly, case-insensitively; prefer the `OPEN` one if several match. Capture `<issue>`; if none,
       note "no issue matched" and proceed.
     - `git push -u origin <branch>` (non-force).
     - `gh pr create --base <PR-base> --head <branch> --title "<conventional title>"` — `<PR-base>` is
       the previous group's branch when stacked, else `main` (GitHub
       retargets the PR automatically when a stacked base merges and its branch is deleted).
       Put `Closes #<issue>` on its **own line near the top** of the PR body. The body also lists the
       task, what changed, and the acceptance criteria. Capture the PR URL.
     - **Verify the link**: `gh pr view <pr> --json closingIssuesReferences` should list `<issue>`. If
       empty, patch with `gh pr edit <pr> --body-file <file>` adding `Closes #<issue>`.
3. **After all tasks pass**:
   - Task(subagent_type: "deploy-agent") → runs `(none yet — EPIC-000 T-005)` (DEV only); parse
     VERDICT. If no dev_command is configured, skip.
   - If deploy PASS: set the epic `status:` to `ready-for-qa` (Edit the frontmatter line).
4. **If any task blocked after 3 retries** (L3 escalate):
   - Set the epic `status:` to `blocked` (Edit). Distill the negative lesson.
   - Append a `## Blocker` section: failing task, attempts made, and review/security/test findings.
5. Print a final summary: tasks completed, retries used, PRs created, deploy result, final status,
   distilled lessons, blockers.

## Notes

- Keep each code change small and reviewable: one task = one focused change.
- Never weaken or skip tests to make them pass.
- The gate scripts (`scripts/qa.sh`, `scripts/test.sh`, `scripts/security-check.sh`,
  `(none yet — EPIC-000 T-005)`) are used by the test/security/deploy agents.
- Pre-built ECC/Ruflo agents are invoked from this main session as part of the gates — never from
  inside a custom sub-agent (sub-agents cannot spawn sub-agents).
- Ruflo/AgentDB may be used for read-only exploration before coding; copy durable findings into tracked
  docs. Runtime state dirs are not the system of record.
