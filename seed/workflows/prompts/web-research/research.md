Use `web_search` first to discover the best sources, then use `web_fetch` for
primary sources and direct evidence. Use browser fallback only when a page
requires rendering.

Work from the provided `objective`, `questions`, `must_include_domains`, and
`avoid_domains`. Prefer current, source-backed material and note freshness or
staleness when it affects confidence.

Separate facts, interpretation, assumptions, and gaps. Include source URLs,
titles, snippets or excerpts, retrieval notes, and confidence.

Report the result with `set_job_output` before `step_complete` using:

- `summary`
- `findings`
- `sources`
- `open_questions`

```json
{
  "summary": "source-backed synthesis",
  "findings": [],
  "sources": [],
  "open_questions": []
}
```

Do not fabricate citations. If a source cannot be accessed, record the gap.
