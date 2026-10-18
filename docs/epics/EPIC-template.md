# EPIC-{{NNN}}: {{EPIC_TITLE}}

status: backlog
environment: dev
phase: {{N}}
priority: {{P0_P1_P2}}
area: {{AREA}}
retries: 0
prd: ../product/PRD.md
stories: ../product/USER-STORIES.md
tasks: ../product/ENGINEERING-TASKS.md ({{T_RANGE}})

<!--
This is the canonical unit of work (see rules/docs-source-of-truth.md). The
frontmatter above is read by the /nerve orchestrator:
  - status:      one of the lifecycle values (see epics/README.md). Set to
                 `on-progress` to make the loop pick this epic up.
  - environment: dev → staging → prod. Automation operates on `dev` only.
  - retries:     attempt counter; after max retries the loop sets `blocked`.
Keep the section order below — the loop and gates look for these headings.
-->

## Goal

{{ONE_PARAGRAPH_GOAL}} — the outcome this epic delivers, in product terms.

## User Stories

<!-- Optional: the US-XXX stories this epic satisfies (see USER-STORIES.md). -->

- **US-{{DOM}}-{{N}}** — As a {{ROLE}}, I want {{CAPABILITY}}, so that {{OUTCOME}}.

## Tasks

<!--
One `### {task title}` group per PR-sized task. The orchestrator works ONE group
at a time. Inside each group, list the concrete checklist items with their T-ID.
-->

### {{TASK_TITLE}}

- [ ] **T-{{NNN}}** {{CONCRETE_IMPLEMENTATION_STEP}}

### {{TASK_TITLE}}

- [ ] **T-{{NNN}}** {{CONCRETE_IMPLEMENTATION_STEP}}

## Acceptance Criteria

**Epic-level**

<!-- The outcomes that mark the WHOLE epic acceptable (see ACCEPTANCE-CRITERIA.md). -->

- {{EPIC_LEVEL_CRITERION}}
- {{EPIC_LEVEL_CRITERION}}

**Per-task**

- **T-{{NNN}}** — {{OBSERVABLE_BAR_THIS_TASK_MUST_CLEAR}}
- **T-{{NNN}}** — {{OBSERVABLE_BAR_THIS_TASK_MUST_CLEAR}}

> Done means each criterion is demonstrably true (test asserts it, a gate passes,
> or a reviewer verifies it) AND the cross-project `DEFINITION-OF-DONE.md` checklist passes.

## Automation Log

<!--
Durability anchor. Append one line per automated run / decision. Distilled memory
from the self-learning loop is ALSO copied here (memory is a cache; this is the
version-controlled record). Format: `YYYY-MM-DD <what happened> — <result>`.
-->

- {{YYYY-MM-DD}} {{EVENT}} — {{RESULT}}

## Dependencies

- {{DEPENDS_ON_EPIC_OR_TASK_OR_NONE}}
