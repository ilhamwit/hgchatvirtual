# Task checks

Checks are the executable acceptance criteria for a single task. Put draft
checks in `checks/drafts/`. After review, copy the approved checks to
`checks/approved/` and do not edit them during implementation.

Each check must state its setup, action, expected result, and command. Prefer
small deterministic checks over subjective “looks good” assertions.
