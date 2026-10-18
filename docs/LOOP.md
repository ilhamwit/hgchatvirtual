# Loop Operations

> This document declares the loops that may invoke `/nerve`. It is the human
> review surface; `.agentic/config.yml` is the machine-readable control plane.

## Operating boundary

- Certified levels: **L1 report-only** and **L2 assisted**.
- Human approval is required before every remote or irreversible action.
- The loop never replaces `/nerve`; it supplies a bounded task, state, budget,
  and run id to `/nerve`.

## Active loops

| Pattern | Level | Cadence | State | Human gate | Status |
| --- | --- | --- | --- | --- | --- |
| Daily triage | L1 | Manual until approved | `docs/LOOP-STATE.md` | Required | disabled |

## Pattern rollout

1. **Daily / issue triage** — L1 only: inspect and report; no source edits.
2. **PR babysitter, CI, dependency sweeper** — L2 only after readiness passes:
   one worktree, one root cause, separate verifier, human review.
3. **Changelog drafter / post-merge cleanup** — draft-only until a human accepts
   the result.

## Coordination priority

When more than one loop could claim work: CI sweeper → PR babysitter →
dependency sweeper → post-merge/changelog → daily or issue triage. A write-capable
loop must claim an item before acting; a second loop reports the collision.

## Enablement record

Before enabling a pattern, record the chosen pattern, cadence, budget, owner,
and `bash scripts/loop-readiness.sh` result here. Changes to automation scope
require a fresh human review.

- _No enabled loops yet._
