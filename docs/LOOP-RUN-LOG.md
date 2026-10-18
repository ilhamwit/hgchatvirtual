# Loop Run Log

Append one JSON object per loop run. Keep entries for the retention period your
team chooses; summarize material decisions in the relevant epic Automation Log.

## Format

```json
{
  "run_id": "2026-07-13T08:00:00Z-daily-triage",
  "pattern": "daily-triage",
  "level": "L1",
  "mode": "report-only",
  "duration_s": 0,
  "items_found": 0,
  "actions_taken": 0,
  "attempts": 0,
  "escalations": 0,
  "tokens_estimate": 0,
  "outcome": "no-op"
}
```

Allowed outcomes: `no-op`, `report-only`, `fix-proposed`, `verified-local`,
`escalated`, `paused`, `budget-exhausted`, `blocked`.

## Runs

<!-- Append JSON objects below this line. -->
