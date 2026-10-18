# Loop Constraints

> This file is read before every enabled loop run. These rules are binding and
> supplement repository `AGENTS.md`, guardrails, and the `.agentic/config.yml`
> manifest; the stricter rule wins.

## Approval and external actions

- Never push, open or update a pull request, merge, deploy, publish, change a
  credential, or mutate a third-party system without explicit human approval.
- Never auto-merge. A loop may prepare evidence or a local patch only.
- Connectors are read-only unless a human explicitly expands their scope.

## Scope and safety

- Never edit `.env`, `.env.*`, `secrets/`, `credentials/`, `auth/`,
  `payments/`, infrastructure, or paths in `protected_paths` without a reviewed
  human task.
- Never disable, weaken, or delete tests to make a gate pass.
- One bounded item and one root cause per run; do not refactor unrelated code.
- Honor `max_attempts_per_item`; after the limit, record evidence and escalate.

## Budget and state

- If the kill-switch file exists, stop before triage and record `paused`.
- At 80% of the daily token budget, switch to report-only. At the limit, stop.
- Read state before each run and append exactly one structured run-log record at
  the end. Put durable product or engineering decisions in the epic Automation
  Log as well.

## L2 assisted changes

- Create an isolated worktree for every patch attempt.
- A separate verifier must run the relevant gates; the implementer cannot mark
  its own result done.
- A verifier rejection discards or escalates the attempt; it never triggers an
  unbounded retry loop.
