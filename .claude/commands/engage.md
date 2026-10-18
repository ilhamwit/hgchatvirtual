---
description: Activate a named expert persona for the current session — primes the agent mindset for development or debugging.
argument-hint: '<persona-name> "<task>"'
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
---

# /engage

Activate an expert persona, then execute the task with that mindset.

Usage: `/engage <persona> "<task>"` — or `/engage <persona>` to describe the task interactively.

Personas live in `~/.agentic-workflows/expert-personas.md`.

## Available Personas

| Persona | Best for |
|---------|----------|
| `startup-mvp` | Greenfield project, MVP from scratch |
| `codebase-audit` | Reverse-engineer & audit an unfamiliar codebase |
| `debug-production` | Root-cause a bug or production outage |
| `perf-optimize` | Performance bottlenecks, memory, scaling |
| `clean-architecture` | Refactor messy code into clean architecture |
| `backend-systems` | API, database, caching, backend infra |
| `frontend-engineer` | UI components, accessibility, responsive design |
| `tech-lead` | Pre-code planning, tradeoff analysis, architecture |
| `security-audit` | Security vulnerabilities, auth flaws, injection |
| `devops-deploy` | CI/CD, Docker/Kubernetes, monitoring, deployment |

## Algorithm

1. **Parse** `$ARGUMENTS`: first word = persona name; remainder = task. If only a persona name is given, use `AskUserQuestion` to get the task description.

2. **Load** the persona: read `~/.agentic-workflows/expert-personas.md`, find the section matching the persona name, print it as a visible framing header. This makes the active mindset explicit in the session.

3. **Adopt** the persona fully. Every response, plan, and output for the remainder of this task must reflect the persona's priorities, decision framework, and output format — not a generic assistant mode.

4. **Execute** the task as `/nerve "$task"` would — RETRIEVE → DECIDE TIER → COORDINATE → GATES → JUDGE → DISTILL — but with the persona mindset applied throughout every step.

   Respect `docs/epics/EPIC-template.md` and all project gates.

5. **On completion**, note any persona-specific insights worth distilling to memory.

## Guardrails

Same as `/nerve`: DEV deploy only · no force-push · no destructive DB · no committed secrets.
