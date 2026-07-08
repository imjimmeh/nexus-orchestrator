# Dependency patches

We patch third-party packages with [`patch-package`](https://github.com/ds300/patch-package).
Each `*.patch` file in this directory is a version-pinned diff against a published
package; `patch-package` re-applies them on top of a clean `node_modules`.

## How it is wired

- **Local / CI installs:** the root `package.json` has `"postinstall": "patch-package"`,
  so `npm install` re-applies every patch automatically.
- **Docker images:** the `docker/Dockerfile.*` images install with `--ignore-scripts`
  (so the `postinstall` hook does **not** run). They instead `COPY patches ./patches`
  and run `RUN npx patch-package` explicitly after `npm install`. `patch-package` is a
  runtime **dependency** (not devDependency) so it is present even in `--omit=dev`
  (light) images.

## Current patches

### `@earendil-works+pi-ai+0.78.1.patch`

Fixes `parseStreamingJson`/`repairJson` in `dist/utils/json-parse.js` silently
**truncating a field and dropping every sibling key parsed after it** when a tool
call's JSON arguments contain a single unescaped `"` inside a string value (e.g.
an unescaped quote embedded in model-generated markdown or code — observed from
MiniMax-family models). This affects both flat string fields and nested
object/array fields, and reproduces whether the argument is genuinely large or
not.

Root cause: `repairJson` unconditionally treated _every_ bare `"` inside a string
as the string's terminator. When that assumption is wrong (a stray content quote,
not a real terminator), `JSON.parse` throws again, and `parseStreamingJson` falls
through to the lenient `partial-json` package, which is designed to recover
**genuinely incomplete** streaming JSON by returning the object accumulated so
far. Because that fallback is indistinguishable at that point from real
incompleteness, it treats the fully-received-but-malformed blob as if the stream
had simply stopped there — truncating the offending string and discarding every
key that would otherwise have appeared after it in the object, even though the
full JSON had actually arrived.

Fix: `repairJson`'s in-string quote handling now looks ahead (skipping
whitespace) past a bare `"` for a character that can legally follow a real JSON
string terminator (`,`, `}`, `]`, `:`, or end of input). If none is found, the
quote is stray content and gets escaped (`\"`) instead of ending the string, so
`JSON.parse` succeeds on the repaired text without ever reaching the
incomplete-JSON fallback. This is a lookahead check, not a rewrite of the
scanner: well-formed JSON is unaffected (a real terminator is always followed by
one of those characters per the JSON grammar), and genuinely incomplete
mid-stream JSON is unaffected (verified against the pre-existing partial-result
behavior at multiple truncation points — see the regression test below).

Known limitation: the heuristic still misclassifies a stray quote as a real
terminator whenever that quote is immediately followed (after whitespace) by
one of `,`/`}`/`]`/`:`. This is not a rare edge case — it is a common shape in
exactly the domain this patch targets. Compact JSON embedded unescaped inside a
string field has its first internal quote (e.g. the quote closing `"key"` in
`{"key":"value"}`) immediately followed by `:` with zero intervening
whitespace, and ordinary quoted prose is frequently followed immediately by a
comma (e.g. `he said "yes",and left`). So this residual failure mode is real
and systematic, not coincidental. It remains narrower than the pre-patch bug,
which broke on _any_ stray quote regardless of what followed it, but it is not
eliminated — a fully correct fix would require actual bracket/depth-aware
re-parsing, which was judged out of scope for a surgical vendor patch.

All changes are marked in the patched file with
`// PATCH earendil-works/pi-ai#json-parse-nested-quote`. There is no known
upstream issue tracking this (not filed against `earendil-works/pi` as of this
writing).

Regression test: `patches/__tests__/pi-ai-json-parse-nested-quote.test.mjs` — run
directly with `node patches/__tests__/pi-ai-json-parse-nested-quote.test.mjs`.
It covers the reproduced nested-object and flat-string failure cases, confirms
well-formed JSON and garbage input are unaffected, and pins the exact partial
results returned for genuinely incomplete streaming JSON at several truncation
points as a regression guard.

### `@earendil-works+pi-coding-agent+0.78.0.patch`

Fixes the pi SDK throwing **`Cannot continue from message role: assistant`** when a
large-context step finishes — auto-compaction (or a retry) runs after the final
assistant turn, then the SDK calls `continue()` on a context still ending in that
assistant turn. Upstream issues:

- [earendil-works/pi#5463](https://github.com/earendil-works/pi/issues/5463) —
  `_handlePostAgentRun` returns `true` after compaction even with no queued work →
  return `this.agent.hasQueuedMessages()` instead.
- [earendil-works/pi#5445](https://github.com/earendil-works/pi/issues/5445) —
  retry/overflow recovery strips only one trailing message, re-exposing an
  `assistant` turn → strip **all** consecutive trailing assistant turns.

All changes are marked in the patched file with `// PATCH earendil-works/pi#####`.

## Updating a patched package

The patch filename pins the version (`...+0.78.0.patch`). When the dependency is
bumped, `patch-package` will fail to apply and the build will surface it — that is
intentional. To refresh:

1. Bump the dependency and `npm install`.
2. Re-apply the change in `node_modules/<pkg>/...` (or confirm upstream now ships the
   fix and the patch can be **deleted**).
3. Regenerate: `npx patch-package <package-name>`.
4. Delete the stale version's `*.patch`.

Always re-check whether the upstream fix has shipped before re-creating a patch.
