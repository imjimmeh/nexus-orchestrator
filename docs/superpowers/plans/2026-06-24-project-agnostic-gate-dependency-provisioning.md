# Project-Agnostic Gate Dependency Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the heavy execution container provision the _mounted repo's_ dependencies from the _mounted repo's own lockfile_ at startup, so the merge quality gate (and every other heavy step) builds against correct deps for any repo — eliminating the whole "stale/incomplete baked `node_modules`" class of false-negative merge blocks.

**Architecture:** The runner is project-agnostic: `/app/node_modules` holds only the _harness runtime's_ own deps, while `/workspace/node_modules` must be derived at runtime from whatever `package-lock.json` is mounted at `/workspace`. The entrypoint stops trusting the baked tree as the answer (a lockfile-checksum compare that is blind to whether the baked tree is actually complete) and instead uses the baked tree only as a hardlink _cache seed_, then reconciles against the mounted lockfile — fatal on failure, with the mounted lockfile restored if `npm` churns it. A secondary hardening stops the LLM remediation agent from inventing bogus `.d.ts` type shims when a dependency is merely uninstalled.

**Tech Stack:** POSIX `sh` (`docker/heavy-entrypoint.sh`), Node 24 (`node -e` lockfile probe; guaranteed present in the image), `sh` test harness (`docker/heavy-entrypoint.test.sh`), seed prompt Markdown, NestJS/Vitest (`apps/api` failure-classification rule + spec), Docker (`make build-heavy` / `build-light`, both `--no-cache`).

## Global Constraints

- **Root cause, verbatim:** `Dockerfile.heavy` runtime stage copies only `package.json` for `core` + `harness-runtime` + `harness-engine-pi` (no `apps/*` manifest), then `npm install`. App-only deps (e.g. `lucide-react`) are pruned from `/app/node_modules` even though the baked `/app/package-lock.json` (the full root lockfile) still lists them. The entrypoint's `lockfiles_match` compares the _workspace_ lockfile checksum vs the _baked_ lockfile checksum — both are the identical full root lockfile, so it always takes the symlink fast-path and never reconciles. Gate then fails `TS7016: Could not find a declaration file for module 'lucide-react'`.
- **Project-agnostic principle (non-negotiable):** correctness of `/workspace/node_modules` must derive ONLY from the mounted `/workspace/package-lock.json`, never from what the image baked. No solution may assume the mounted repo is nexus-orchestrator.
- **No new "complete the bake" footgun:** do NOT fix this by enumerating workspace manifests in the Dockerfile — that only works for the dogfood repo and re-breaks on the next new app.
- **Node is guaranteed:** the image is a Node runtime (`DEFAULT_EXEC` runs `node`); the entrypoint MAY shell out to `node -e`. Tests run on hosts with Node 24 present.
- **Strict lint policy:** no `eslint-disable` / `@ts-ignore` in the `apps/api` change. Fix in code.
- **Branch:** implement on `main` (per user instruction). Frequent atomic commits, conventional-commit messages, end each with the `Co-Authored-By` trailer.
- **Existing test harness contract:** `docker/heavy-entrypoint.test.sh` overrides `HEAVY_ENTRYPOINT_APP_DIR`, `WORKSPACE_PATH`, `HEAVY_ENTRYPOINT_NPM`, `HEAVY_ENTRYPOINT_EXEC`. New code must keep honoring these and add `HEAVY_ENTRYPOINT_NODE` for the probe so the test can stub/observe it.

---

## File Structure

| File                                                                         | Responsibility                                                                              | Change                                                           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `docker/heavy-entrypoint.sh`                                                 | Provision `/workspace/node_modules` from the mounted lockfile; baked tree = cache seed only | Modify                                                           |
| `docker/heavy-entrypoint.test.sh`                                            | POSIX-sh behavioural contract for the entrypoint                                            | Modify (real-JSON lockfiles + new cases)                         |
| `seed/workflows/prompts/work-item-ready-to-merge/remediate-quality-gate.md`  | LLM remediation prompt                                                                      | Modify (broaden dep-staleness recognition; forbid `.d.ts` shims) |
| `apps/api/src/workflow/workflow-repair/failure-classification-rules.ts`      | Maps failure text → repair class                                                            | Modify (recognise the missing-declaration variant)               |
| `apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts` | Rule unit tests                                                                             | Modify (add TS7016 case)                                         |
| `docs/guide/...` + `CLAUDE.md` Architecture Quirks                           | Docs                                                                                        | Modify (document the project-agnostic provisioning model)        |

**Out of scope (decided during design):**

- No `Dockerfile.heavy`/`.light` structural change for correctness — the entrypoint owns provisioning. (Image rebuild to _ship_ the new entrypoint is an operational step, Task 7.)
- No rewire into `repair.dependency.add_declared_package` — it resolves to a `sysadmin_workflow` (another LLM path), not a deterministic `npm ci`. The deterministic install-and-retry IS the entrypoint (Task 1–5).
- No named-volume dep cache / GitHub-Actions relocation (lower-scored alternatives; revisit only if image-rebuild latency becomes the pain).

---

## Task 1: Lockfile-satisfaction probe (replaces the checksum compare)

**Files:**

- Modify: `docker/heavy-entrypoint.sh`
- Test: `docker/heavy-entrypoint.test.sh`

**Interfaces:**

- Produces: `deps_present_in <root_dir>` — returns 0 iff every non-link, non-optional top-level package the _workspace_ lockfile declares (`packages` keys starting `node_modules/`) exists under `<root_dir>/<key>`. Returns 1 if there is no workspace lockfile or any required package dir is absent. Uses `${HEAVY_ENTRYPOINT_NODE:-node}`.
- Consumes (later tasks): replaces `lockfiles_match` in `provision_node_modules`.

- [ ] **Step 1: Write the failing test** — append a new probe case to `docker/heavy-entrypoint.test.sh` _before_ the `RESULT:` line. It builds a real-JSON workspace lockfile that requires a package absent from the baked tree, and asserts the entrypoint installs (does not symlink). Reuse `make_sandbox`/`run_entrypoint`; add a `NODE` passthrough.

First, extend `run_entrypoint` to forward Node (edit the existing function):

```sh
run_entrypoint() {
  HEAVY_ENTRYPOINT_APP_DIR="$APP" \
  WORKSPACE_PATH="$WS" \
  HEAVY_ENTRYPOINT_NPM="$BIN/npm" \
  HEAVY_ENTRYPOINT_NODE="${HEAVY_ENTRYPOINT_NODE:-node}" \
  HEAVY_ENTRYPOINT_EXEC="echo __EXEC_HANDOFF__" \
  sh "$ENTRYPOINT" > "$ROOT/entrypoint.out" 2>&1
}
```

Then add the case:

```sh
# --- Case 4: baked tree MISSING a required dep -> install (the lucide-react repro) ---
echo "case: incomplete baked tree triggers reconcile even when lockfiles 'match'"
make_sandbox
# Baked tree has ONLY baked-pkg; workspace lockfile requires lucide-react too.
cat > "$APP/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": { "version": "1.0.0" } } }
JSON
cat > "$WS/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": { "version": "1.0.0" }, "node_modules/lucide-react": { "version": "1.20.0" } } }
JSON
run_entrypoint
if [ -d "$WS/node_modules" ] && [ ! -L "$WS/node_modules" ]; then
  pass "incomplete baked tree -> real workspace node_modules"
else
  fail "incomplete baked tree should reconcile to a real directory, not a symlink"
fi
if npm_was_called; then
  pass "npm install invoked to add the missing dep"
else
  fail "npm install should run when baked tree does not satisfy the workspace lockfile"
fi
rm -rf "$ROOT"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `sh docker/heavy-entrypoint.test.sh`
Expected: FAIL on case 4 — current code sees identical-content lockfiles? No: here baked≠workspace, so today's code already installs. To make this a true RED for the probe, ALSO add Case 5 where lockfiles are byte-identical but the baked tree is incomplete (today's `lockfiles_match` returns true → wrongly symlinks):

```sh
# --- Case 5: byte-identical lockfiles but incomplete baked tree -> still install ---
echo "case: identical lockfiles do NOT excuse an incomplete baked tree"
make_sandbox
cat > "$APP/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": {}, "node_modules/lucide-react": {} } }
JSON
cp "$APP/package-lock.json" "$WS/package-lock.json"   # byte-identical, as in the real bug
# baked tree still only has baked-pkg (lucide-react was pruned at image build)
run_entrypoint
if [ -d "$WS/node_modules" ] && [ ! -L "$WS/node_modules" ] && npm_was_called; then
  pass "identical lockfiles + incomplete baked tree -> reconcile (install)"
else
  fail "must reconcile when baked tree is missing a lockfile-declared package, even if lockfiles are identical"
fi
rm -rf "$ROOT"
```

Run: `sh docker/heavy-entrypoint.test.sh`
Expected: FAIL on Case 5 — today's `lockfiles_match` is true (identical files) so it symlinks and never calls npm.

- [ ] **Step 3: Add the probe to `docker/heavy-entrypoint.sh`** — add `NODE_BIN` and `deps_present_in`, leave `provision_node_modules` for Task 2. Insert after `BAKED_LOCK` line and after `checksum()`:

```sh
NODE_BIN="${HEAVY_ENTRYPOINT_NODE:-node}"
```

```sh
# Returns 0 iff every top-level package the WORKSPACE lockfile declares is present
# under <root>/node_modules/... . The baked lockfile is irrelevant: correctness of
# the workspace tree derives ONLY from the mounted repo's own lockfile (the runner
# is project-agnostic). link:true (workspace symlinks) and optional deps are skipped.
deps_present_in() {
  root="$1"
  [ -f "$WORKSPACE_LOCK" ] || return 1
  "$NODE_BIN" -e '
    const fs = require("fs");
    let lock;
    try { lock = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { process.exit(1); }            // unreadable lockfile -> treat as not-satisfied
    const root = process.argv[2];
    const pkgs = lock.packages || {};
    for (const key of Object.keys(pkgs)) {
      if (!key.startsWith("node_modules/")) continue;   // skip the workspace roots ("", "apps/web", ...)
      const entry = pkgs[key] || {};
      if (entry.link || entry.optional) continue;       // workspace symlinks / optional deps may be absent
      if (!fs.existsSync(root + "/" + key)) process.exit(1);
    }
    process.exit(0);
  ' "$WORKSPACE_LOCK" "$root" 2>/dev/null
}
```

- [ ] **Step 4: Re-run the test** (probe exists but `provision_node_modules` not yet rewired)

Run: `sh docker/heavy-entrypoint.test.sh`
Expected: Cases 4 & 5 still FAIL (wiring lands in Task 2). This step only confirms no syntax error: the script still runs and Cases 1–3 still pass.

- [ ] **Step 5: Commit**

```bash
git add docker/heavy-entrypoint.sh docker/heavy-entrypoint.test.sh
git commit -m "test(entrypoint): add lockfile-satisfaction probe + incomplete-baked-tree cases"
```

---

## Task 2: Reconcile against the mounted lockfile (rewire `provision_node_modules`)

**Files:**

- Modify: `docker/heavy-entrypoint.sh`
- Test: `docker/heavy-entrypoint.test.sh` (Cases 4 & 5 from Task 1 go GREEN)

**Interfaces:**

- Consumes: `deps_present_in` (Task 1), existing `link_image_modules`, `install_workspace_modules`.
- Produces: `provision_node_modules` that fast-paths (symlink) only when the baked tree actually satisfies the mounted lockfile; otherwise reconciles.

- [ ] **Step 1: Confirm RED** — Cases 4 & 5 fail (from Task 1, Step 2).

Run: `sh docker/heavy-entrypoint.test.sh`
Expected: FAIL on Cases 4 and 5.

- [ ] **Step 2: Replace `provision_node_modules`** in `docker/heavy-entrypoint.sh`:

```sh
provision_node_modules() {
  [ -d "$WORKSPACE_DIR" ] || return 0
  [ -d "$APP_DIR/node_modules" ] || return 0

  # No mounted lockfile: nothing to reconcile against; expose image deps as a
  # best-effort convenience (an arbitrary repo without a lockfile declares nothing).
  if [ ! -f "$WORKSPACE_LOCK" ]; then
    link_image_modules
    return 0
  fi

  # Fast path ONLY when the baked tree genuinely satisfies the MOUNTED lockfile.
  if deps_present_in "$APP_DIR"; then
    link_image_modules
    return 0
  fi

  # Baked tree is incomplete for this repo -> reconcile from the mounted lockfile.
  install_workspace_modules
}
```

- [ ] **Step 3: Run the test to verify Cases 4 & 5 pass and 1–3 still pass**

Run: `sh docker/heavy-entrypoint.test.sh`
Expected: PASS — `RESULT: N passed, 0 failed`.

- [ ] **Step 4: Update the header comment** in `docker/heavy-entrypoint.sh` (lines 1–22) to describe the project-agnostic model (baked tree = cache seed; correctness from the mounted lockfile). Replace the old two-situations comment:

```sh
# Heavy execution-container entrypoint.
#
# The runner is PROJECT-AGNOSTIC: any repo can be bind-mounted at /workspace.
# /app/node_modules holds the harness runtime's OWN deps and is used here only as
# a fast hardlink *cache seed*. The correctness of /workspace/node_modules derives
# solely from the mounted repo's own /workspace/package-lock.json:
#
#   * If the baked tree already satisfies the mounted lockfile (deps_present_in),
#     expose it via a symlink — the fast path.
#   * Otherwise materialise a workspace-local node_modules that satisfies the
#     mounted lockfile (hardlink-seed from the image, then `npm install` the
#     delta). This covers BOTH a drifted lockfile AND an image whose baked tree
#     was never complete for this repo (e.g. app-only deps pruned at build time).
#
# Test overrides (see heavy-entrypoint.test.sh):
#   HEAVY_ENTRYPOINT_APP_DIR  image root that holds the baked node_modules (/app)
#   HEAVY_ENTRYPOINT_NPM      npm executable (default: npm)
#   HEAVY_ENTRYPOINT_NODE     node executable for the lockfile probe (default: node)
#   HEAVY_ENTRYPOINT_EXEC     final handoff command (default: the harness runtime)
```

Also delete the now-dead `lockfiles_match` function (it is no longer referenced — aggressive hygiene). Keep `checksum` (Task 4 reuses it for the lockfile-churn guard).

- [ ] **Step 5: Run the test again after the comment/deletion edit**

Run: `sh docker/heavy-entrypoint.test.sh`
Expected: PASS — `RESULT: N passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add docker/heavy-entrypoint.sh docker/heavy-entrypoint.test.sh
git commit -m "fix(entrypoint): provision workspace deps from the mounted lockfile, not a baked-tree checksum"
```

---

## Task 3: Make a failed reconcile fatal (no silent false-negative)

**Files:**

- Modify: `docker/heavy-entrypoint.sh`
- Test: `docker/heavy-entrypoint.test.sh`

**Interfaces:**

- Produces: `install_workspace_modules` returns the `npm` exit code (no `|| true`); `provision_node_modules` propagates it; the script exits non-zero before `exec` if provisioning fails.

- [ ] **Step 1: Write the failing test** — add a case where `npm` fails; assert the entrypoint exits non-zero and does NOT hand off. Add a stub-npm-fail helper and case before `RESULT:`:

```sh
# --- Case 6: failed reconcile is FATAL (no silent handoff to the gate) ---
echo "case: npm install failure aborts the entrypoint"
make_sandbox
# Make the fake npm fail.
cat > "$BIN/npm" <<EOF
#!/bin/sh
echo "npm \$*" >> "$ROOT/npm-calls.log"
exit 1
EOF
chmod +x "$BIN/npm"
cat > "$APP/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": {} } }
JSON
cat > "$WS/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": {}, "node_modules/lucide-react": {} } }
JSON
HEAVY_ENTRYPOINT_APP_DIR="$APP" WORKSPACE_PATH="$WS" \
  HEAVY_ENTRYPOINT_NPM="$BIN/npm" HEAVY_ENTRYPOINT_NODE="${HEAVY_ENTRYPOINT_NODE:-node}" \
  HEAVY_ENTRYPOINT_EXEC="echo __EXEC_HANDOFF__" \
  sh "$ENTRYPOINT" > "$ROOT/entrypoint.out" 2>&1
rc=$?
if [ "$rc" -ne 0 ]; then
  pass "entrypoint exits non-zero when reconcile fails (rc=$rc)"
else
  fail "entrypoint should fail when npm reconcile fails"
fi
if grep -q "__EXEC_HANDOFF__" "$ROOT/entrypoint.out"; then
  fail "must NOT hand off to the gate after a failed reconcile"
else
  pass "no handoff after failed reconcile"
fi
rm -rf "$ROOT"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `sh docker/heavy-entrypoint.test.sh`
Expected: FAIL on Case 6 — today `install_workspace_modules` ends with `|| true`, so the script still `exec`s the handoff.

- [ ] **Step 3: Make the reconcile fatal** in `docker/heavy-entrypoint.sh`. Change the final line of `install_workspace_modules` from `( cd ... npm install ... ) || true` to propagate, and propagate through `provision_node_modules` + the call site:

```sh
install_workspace_modules() {
  if [ -L "$WORKSPACE_DIR/node_modules" ]; then
    rm -f "$WORKSPACE_DIR/node_modules"
  fi
  if [ ! -d "$WORKSPACE_DIR/node_modules" ]; then
    cp -al "$APP_DIR/node_modules" "$WORKSPACE_DIR/node_modules" 2>/dev/null \
      || cp -a "$APP_DIR/node_modules" "$WORKSPACE_DIR/node_modules" 2>/dev/null \
      || mkdir -p "$WORKSPACE_DIR/node_modules"
  fi
  ( cd "$WORKSPACE_DIR" && "$NPM_BIN" install --no-audit --no-fund --ignore-scripts )
}
```

Change the call site (bottom of file) from a bare call to a guarded `exec`:

```sh
if ! provision_node_modules; then
  echo "heavy-entrypoint: dependency provisioning failed; aborting before handoff" >&2
  exit 1
fi

# shellcheck disable=SC2086 # intentional word-splitting of the handoff command
exec ${HEAVY_ENTRYPOINT_EXEC:-$DEFAULT_EXEC}
```

(`provision_node_modules` already `return`s the result of its last command on each branch; `link_image_modules` returns 0.)

- [ ] **Step 4: Run the test to verify Case 6 passes and 1–5 still pass**

Run: `sh docker/heavy-entrypoint.test.sh`
Expected: PASS — `RESULT: N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add docker/heavy-entrypoint.sh docker/heavy-entrypoint.test.sh
git commit -m "fix(entrypoint): fail fast when dependency reconcile fails instead of running the gate against incomplete deps"
```

---

## Task 4: Restore the mounted lockfile if `npm install` churns it

**Files:**

- Modify: `docker/heavy-entrypoint.sh`
- Test: `docker/heavy-entrypoint.test.sh`

**Why:** `npm install` (not `npm ci`) may rewrite `/workspace/package-lock.json`. On a _commit_ step (e.g. `implement_and_commit`) that would stage spurious lockfile churn. The lockfile is the source of truth; the entrypoint must only materialise `node_modules`, never edit the declared lockfile.

**Interfaces:**

- Produces: after a successful reconcile, if the mounted lockfile changed, restore it from git when the workspace is a git repo; otherwise restore from a pre-install copy.

- [ ] **Step 1: Write the failing test** — fake npm that _mutates_ the workspace lockfile; assert the lockfile is byte-restored after the entrypoint. Add before `RESULT:`:

```sh
# --- Case 7: a lockfile-churning npm install does not alter the mounted lockfile ---
echo "case: workspace lockfile is restored if npm rewrites it"
make_sandbox
cat > "$BIN/npm" <<EOF
#!/bin/sh
echo "npm \$*" >> "$ROOT/npm-calls.log"
# Simulate npm rewriting the workspace lockfile.
echo '{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": {}, "node_modules/lucide-react": {}, "MUTATED": true } }' > "$WS/package-lock.json"
EOF
chmod +x "$BIN/npm"
cat > "$APP/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": {} } }
JSON
cat > "$WS/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": {}, "node_modules/lucide-react": {} } }
JSON
ORIG_SUM=$(sha256sum "$WS/package-lock.json" | cut -d' ' -f1)
run_entrypoint
NEW_SUM=$(sha256sum "$WS/package-lock.json" | cut -d' ' -f1)
if [ "$ORIG_SUM" = "$NEW_SUM" ]; then
  pass "mounted lockfile unchanged after reconcile"
else
  fail "entrypoint must not leave the mounted lockfile mutated"
fi
rm -rf "$ROOT"
```

(The sandbox `$WS` is not a git repo, so this exercises the non-git restore-from-copy path.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `sh docker/heavy-entrypoint.test.sh`
Expected: FAIL on Case 7 — the mutated lockfile is left in place.

- [ ] **Step 3: Add the churn guard** to `install_workspace_modules` in `docker/heavy-entrypoint.sh`. Snapshot before install, restore after if changed:

```sh
install_workspace_modules() {
  if [ -L "$WORKSPACE_DIR/node_modules" ]; then
    rm -f "$WORKSPACE_DIR/node_modules"
  fi
  if [ ! -d "$WORKSPACE_DIR/node_modules" ]; then
    cp -al "$APP_DIR/node_modules" "$WORKSPACE_DIR/node_modules" 2>/dev/null \
      || cp -a "$APP_DIR/node_modules" "$WORKSPACE_DIR/node_modules" 2>/dev/null \
      || mkdir -p "$WORKSPACE_DIR/node_modules"
  fi

  # The mounted lockfile is the source of truth; we materialise node_modules but
  # must not leave the declared lockfile mutated (npm install may rewrite it).
  lock_before="$(checksum "$WORKSPACE_LOCK" 2>/dev/null || echo none)"
  cp "$WORKSPACE_LOCK" "$WORKSPACE_DIR/.heavy-entrypoint-lock.bak" 2>/dev/null || true

  ( cd "$WORKSPACE_DIR" && "$NPM_BIN" install --no-audit --no-fund --ignore-scripts )
  install_rc=$?

  if [ "$install_rc" -eq 0 ] && [ -f "$WORKSPACE_LOCK" ]; then
    lock_after="$(checksum "$WORKSPACE_LOCK" 2>/dev/null || echo none)"
    if [ "$lock_before" != "$lock_after" ]; then
      if command -v git >/dev/null 2>&1 \
        && ( cd "$WORKSPACE_DIR" && git rev-parse --is-inside-work-tree >/dev/null 2>&1 ); then
        ( cd "$WORKSPACE_DIR" && git checkout -- package-lock.json 2>/dev/null ) \
          || cp "$WORKSPACE_DIR/.heavy-entrypoint-lock.bak" "$WORKSPACE_LOCK" 2>/dev/null || true
      else
        cp "$WORKSPACE_DIR/.heavy-entrypoint-lock.bak" "$WORKSPACE_LOCK" 2>/dev/null || true
      fi
    fi
  fi
  rm -f "$WORKSPACE_DIR/.heavy-entrypoint-lock.bak" 2>/dev/null || true

  return "$install_rc"
}
```

- [ ] **Step 4: Run the test to verify Case 7 passes and 1–6 still pass**

Run: `sh docker/heavy-entrypoint.test.sh`
Expected: PASS — `RESULT: N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add docker/heavy-entrypoint.sh docker/heavy-entrypoint.test.sh
git commit -m "fix(entrypoint): restore the mounted lockfile if npm install churns it"
```

---

## Task 5: Recognise the missing-declaration variant as a dependency failure (classifier)

**Files:**

- Modify: `apps/api/src/workflow/workflow-repair/failure-classification-rules.ts:105-116`
- Test: `apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts`

**Why:** The exact failure (`TS7016: Could not find a declaration file for module 'lucide-react'`) is not matched by the current `dependency_missing` regex (`cannot find module|module not found|...`). Any job-failure path that _does_ reach classification should treat it as a dependency issue, not a generic failure. (The gate path itself is fixed by Tasks 1–4; this is defence-in-depth for other paths.)

**Interfaces:**

- Consumes: existing `classifyFailure(searchableText)` returning `{ class, confidence, reason }`.
- Produces: `dependency_missing` also matches `could not find a declaration file for module`.

- [ ] **Step 1: Write the failing test** — add to the existing parametrised table in `failure-classification-rules.spec.ts` (mirror the `['Cannot find module @scope/missing-package', 'dependency_missing']` row):

```typescript
[
  "error TS7016: Could not find a declaration file for module 'lucide-react'.",
  'dependency_missing',
],
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- failure-classification-rules`
Expected: FAIL — the TS7016 string currently classifies as something other than `dependency_missing`.

- [ ] **Step 3: Broaden the regex** in `failure-classification-rules.ts` (the `dependency_missing` block):

```typescript
if (
  /(cannot find module|module not found|missing dependency|no module named|command not found|package .* not found|import .* failed|could not find a declaration file for module)/i.test(
    searchableText,
  )
) {
  return {
    class: "dependency_missing",
    confidence: 0.82,
    reason:
      "Failure evidence indicates a missing dependency, module, or binary.",
  };
}
```

- [ ] **Step 4: Run the test to verify it passes (and the rule suite is green)**

Run: `npm run test --workspace=apps/api -- failure-classification-rules`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-repair/failure-classification-rules.ts apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts
git commit -m "fix(repair): classify TS7016 missing-declaration as dependency_missing"
```

---

## Task 6: Stop the LLM remediation agent inventing `.d.ts` shims

**Files:**

- Modify: `seed/workflows/prompts/work-item-ready-to-merge/remediate-quality-gate.md:59-72`

**Why:** The prompt's existing dependency-staleness guard keys on `"Cannot find module '<pkg>'"` (TS2307). The real failure was `TS7016: Could not find a declaration file for module 'lucide-react'`, so the agent read "declaration file," concluded "missing types," and hand-wrote `apps/web/src/types/lucide-react.d.ts` — wedging the run. With Tasks 1–4 the container self-provisions so this should never trigger, but the guard must still recognise the variant and explicitly forbid shim files.

**Interfaces:** prose only — no code contract.

- [ ] **Step 1: Replace the "Environment / dependency-staleness failures" section** (lines 59–72) with a broadened, container-self-provisioning-aware version:

```markdown
Dependency-provisioning failures are NOT agent-fixable and must NOT be patched in code:

- The execution container provisions `node_modules` from the mounted
  `package-lock.json` at startup. If the build STILL fails because a declared
  dependency is missing or untyped — ANY of:
  - `Cannot find module '<pkg>'` (TS2307), or
  - `Could not find a declaration file for module '<pkg>'` (TS7016), or
  - a runtime `MODULE_NOT_FOUND` —
    while `<pkg>` IS present in `package.json` and `package-lock.json`, this is a
    dependency-PROVISIONING problem, not a code or types defect.
- NEVER "fix" this by writing a `*.d.ts` shim, a `declare module` stub, a
  `// @ts-ignore`, or by editing tsconfig. Packages declared in the lockfile
  ship (or resolve) their own types; a shim only masks an install gap and sends
  the merge into a doomed re-validation loop.
- NEVER run `npm install` and report success: it patches only THIS ephemeral
  container and leaves nothing to commit, so the fresh gate container fails
  identically.
- In that situation call set_job_output with `{ ok: false, response:
"dependency-provisioning failure: <pkg> declared in package.json + lockfile
but unresolved in node_modules; the container did not provision deps — infra
issue, no source fix possible" }` and step_complete.
```

- [ ] **Step 2: Validate the seed still parses**

Run: `npm run validate:seed-data`
Expected: PASS (no schema/template errors introduced).

- [ ] **Step 3: Commit**

```bash
git add seed/workflows/prompts/work-item-ready-to-merge/remediate-quality-gate.md
git commit -m "fix(merge-remediation): recognise TS7016 dep-provisioning failures; forbid .d.ts shims"
```

---

## Task 7: Ship & document (image rebuild + docs)

**Files:**

- Modify: `CLAUDE.md` (Architecture Quirks), `docs/guide/README.md` (or the relevant guide page)

**Why:** The new entrypoint only takes effect once the heavy/light images are rebuilt (fix-forward: the next merge attempt then provisions correctly). Document the project-agnostic provisioning model so future devs don't "fix the bake."

- [ ] **Step 1: Run the full entrypoint test suite once more (regression)**

Run: `sh docker/heavy-entrypoint.test.sh`
Expected: PASS — `RESULT: N passed, 0 failed`.

- [ ] **Step 2: Document the model** — add an Architecture-Quirks bullet to `CLAUDE.md`:

```markdown
- **Execution containers are project-agnostic**: the heavy/light image bakes the
  _harness runtime's_ deps at `/app/node_modules` only. A mounted repo's
  `/workspace/node_modules` is provisioned at container start from the mounted
  `package-lock.json` (`docker/heavy-entrypoint.sh`: baked tree = hardlink cache
  seed; `deps_present_in` decides symlink-vs-reconcile). NEVER "fix" a missing
  app dependency by enumerating workspace manifests in `Dockerfile.heavy` — that
  only works for this repo and re-breaks for the next app. Provisioning failure
  is fatal (the gate must not run against incomplete deps).
```

- [ ] **Step 3: Commit the docs**

```bash
git add CLAUDE.md docs/guide/README.md
git commit -m "docs: project-agnostic container dependency provisioning"
```

- [ ] **Step 4: Rebuild the heavy/light images (deploy — fix-forward)**

Run:

```bash
make build-heavy
make build-light
```

Expected: both build clean. (`make build-*` uses `--no-cache`; the new `docker/heavy-entrypoint.sh` is COPY'd to `/app/entrypoint.sh`.)

- [ ] **Step 5: Verify the shipped entrypoint provisions a previously-pruned dep**

Run (smoke test against the real image, using this repo as the mounted workspace):

```bash
docker run --rm --entrypoint sh \
  -v "$(pwd)":/workspace nexus-heavy:latest \
  -c 'HEAVY_ENTRYPOINT_EXEC="echo OK" /app/entrypoint.sh >/dev/null 2>&1; ls -d /workspace/node_modules/lucide-react'
```

Expected: prints `/workspace/node_modules/lucide-react` (the dep that previously caused `TS7016`). If it errors, provisioning did not run — investigate before relying on the gate.

---

## Self-Review

**Spec coverage:**

- Project-agnostic provisioning from the mounted lockfile → Tasks 1–2. ✔
- Baked tree demoted to cache seed → Task 2 (`deps_present_in` + comment). ✔
- Fatal on provisioning failure (no silent false-negative) → Task 3. ✔
- Lockfile-churn guard for commit steps → Task 4. ✔
- De-LLM the dependency-provisioning remediation / no bogus `.d.ts` shims → Tasks 5 (classifier) + 6 (prompt). ✔
- Fix-forward (no separate stuck-run recovery) → Task 7 image rebuild. ✔ (run `0398e2f2` is intentionally left to fail/age out per the "fix forward only" decision.)
- Docs → Task 7. ✔

**Placeholder scan:** No TBD/TODO; every code/edit step shows the literal content. ✔

**Type/name consistency:** `deps_present_in`, `provision_node_modules`, `install_workspace_modules`, `link_image_modules`, `checksum`, `NODE_BIN`/`HEAVY_ENTRYPOINT_NODE` used consistently across Tasks 1–4. `dependency_missing` class name matches the existing union. ✔

**Notes for the implementer:**

- A `fix-merge-gate-node-modules` git worktree exists from prior work — IGNORE it; implement on `main` as instructed.
- The test harness currently has 3 cases; this plan adds Cases 4–7. Keep the `RESULT: N passed, 0 failed` gate (final line `[ "$FAIL" -eq 0 ]`).
- Do not remove `checksum` (Task 4 reuses it); DO remove `lockfiles_match` (dead after Task 2).

```

```
