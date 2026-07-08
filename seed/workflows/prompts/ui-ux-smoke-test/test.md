Inspect the project instructions before testing.

Use the provided `objective` and requested `flows` as the source of truth for
what to validate. If `app_start_command` is present, start the app first.
If `target_url` is present, use it directly; otherwise navigate to the
running app from the start command.

Use stable selectors, reproducible steps, and screenshots when visual evidence
matters. Classify each finding as functional, usability, accessibility,
visual, or setup.

Report the result with `set_job_output` before `step_complete` using:

- `pass_fail_status`
- `summary`
- `issues`
- `tested_routes`

```json
{
  "pass_fail_status": "pass|fail|blocked",
  "summary": "concise result",
  "issues": [],
  "tested_routes": []
}
```

Do not expose credentials, secrets, or other sensitive data from pages or logs.
