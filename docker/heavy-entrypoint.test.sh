#!/bin/sh
# POSIX shell test for docker/heavy-entrypoint.sh.
#
# The heavy runner is project-agnostic: /app/node_modules holds only the
# harness runtime's own deps. /workspace/node_modules must be derived at
# startup from the mounted repo's own package-lock.json. The baked
# /app/node_modules is used only as a hardlink cache seed; correctness
# is never assumed from it.
#
# Provisioning contract:
#   * No workspace lockfile → expose baked deps via symlink (fast path).
#   * All lockfile-declared deps already present in baked tree → fast path.
#   * Any required dep missing from baked tree → materialise workspace
#     node_modules via install. Fatal on failure.
#   * npm must not permanently rewrite the workspace lockfile.
#
# Run: sh docker/heavy-entrypoint.test.sh
set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENTRYPOINT="$SCRIPT_DIR/heavy-entrypoint.sh"

PASS=0
FAIL=0

fail() {
  FAIL=$((FAIL + 1))
  echo "  NOT OK: $1"
}
pass() {
  PASS=$((PASS + 1))
  echo "  ok: $1"
}

# Build an isolated sandbox emulating /app (image) and /workspace (mount).
make_sandbox() {
  ROOT=$(mktemp -d)
  APP="$ROOT/app"
  WS="$ROOT/workspace"
  mkdir -p "$APP/node_modules/baked-pkg" "$WS"
  echo "baked" > "$APP/node_modules/baked-pkg/index.js"
  # A fake npm that records its invocation instead of installing.
  BIN="$ROOT/bin"
  mkdir -p "$BIN"
  cat > "$BIN/npm" <<EOF
#!/bin/sh
echo "npm \$*" >> "$ROOT/npm-calls.log"
EOF
  chmod +x "$BIN/npm"
  : > "$ROOT/npm-calls.log"
}

run_entrypoint() {
  HEAVY_ENTRYPOINT_APP_DIR="$APP" \
  WORKSPACE_PATH="$WS" \
  HEAVY_ENTRYPOINT_NPM="$BIN/npm" \
  HEAVY_ENTRYPOINT_NODE="${HEAVY_ENTRYPOINT_NODE:-node}" \
  HEAVY_ENTRYPOINT_EXEC="echo __EXEC_HANDOFF__" \
  sh "$ENTRYPOINT" > "$ROOT/entrypoint.out" 2>&1
}

npm_was_called() { [ -s "$ROOT/npm-calls.log" ]; }

# --- Case 1: workspace lockfile requires a dep absent from baked tree -> install ---
echo "case: workspace lockfile requires a dep absent from baked tree -> install"
make_sandbox
cat > "$WS/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": { "version": "1.0.0" }, "node_modules/new-dep": { "version": "2.0.0" } } }
JSON
run_entrypoint
if [ -d "$WS/node_modules" ] && [ ! -L "$WS/node_modules" ]; then
  pass "workspace node_modules is a real directory, not a symlink"
else
  fail "workspace node_modules should be a real directory when a dep is missing"
fi
if npm_was_called; then
  pass "npm install was invoked to reconcile missing dep"
else
  fail "npm install should run when a lockfile dep is absent from the baked tree"
fi
grep -q "__EXEC_HANDOFF__" "$ROOT/entrypoint.out" && pass "handed off to main process" || fail "should exec main process"
rm -rf "$ROOT"

# Portable check: image deps are reachable through the workspace node_modules,
# regardless of whether the platform realised `ln -s` as a true symlink (Linux)
# or a copy (some MSYS/Windows shells). The behavioural contract is "fast path =
# image deps exposed + no install", which the npm-call log captures precisely.
image_deps_exposed() { [ -e "$WS/node_modules/baked-pkg/index.js" ]; }

# --- Case 2: all lockfile-declared deps present in baked tree -> fast path (no install) ---
echo "case: all lockfile-declared deps present in baked tree -> fast path (no install)"
make_sandbox
cat > "$WS/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": { "version": "1.0.0" } } }
JSON
run_entrypoint
if image_deps_exposed; then
  pass "image deps exposed at workspace node_modules"
else
  fail "all-present deps should expose image deps at the workspace"
fi
if npm_was_called; then
  fail "npm install must NOT run when all deps are present in baked tree"
else
  pass "no npm install on the fast path"
fi
rm -rf "$ROOT"

# --- Case 3: no workspace lockfile -> fast path (no install) ---
echo "case: missing workspace lockfile keeps the fast path (no install)"
make_sandbox
# No $WS/package-lock.json
run_entrypoint
if image_deps_exposed; then
  pass "image deps exposed at workspace node_modules"
else
  fail "missing workspace lockfile should expose image deps at the workspace"
fi
if npm_was_called; then
  fail "npm install must NOT run when there is no workspace lockfile"
else
  pass "no npm install without a workspace lockfile"
fi
rm -rf "$ROOT"

# --- Case 4: baked tree missing a required dep -> install (the lucide-react scenario) ---
echo "case: incomplete baked tree triggers install even when lockfiles are both provided"
make_sandbox
# APP lockfile lists only baked-pkg; WS lockfile adds lucide-react which is NOT in APP node_modules.
cat > "$APP/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": { "version": "1.0.0" } } }
JSON
cat > "$WS/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": { "version": "1.0.0" }, "node_modules/lucide-react": { "version": "0.263.1" } } }
JSON
run_entrypoint
if [ -d "$WS/node_modules" ] && [ ! -L "$WS/node_modules" ] && npm_was_called; then
  pass "incomplete baked tree -> reconcile via install"
else
  fail "must reconcile when baked tree is missing a lockfile-declared package"
fi
rm -rf "$ROOT"

# --- Case 5: byte-identical lockfiles but incomplete baked tree -> MUST install (the bug) ---
echo "case: identical lockfiles do NOT excuse an incomplete baked tree"
make_sandbox
cat > "$APP/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": { "version": "1.0.0" }, "node_modules/lucide-react": { "version": "0.263.1" } } }
JSON
cp "$APP/package-lock.json" "$WS/package-lock.json"
# Baked tree still only has baked-pkg -- lucide-react is NOT installed despite being in the lockfile.
run_entrypoint
if [ -d "$WS/node_modules" ] && [ ! -L "$WS/node_modules" ] && npm_was_called; then
  pass "identical lockfiles + incomplete baked tree -> reconcile"
else
  fail "must reconcile when baked tree is missing a lockfile-declared package even if lockfiles are identical"
fi
rm -rf "$ROOT"

# --- Case 6: npm install failure -> abort, no exec handoff ---
echo "case: npm install failure aborts the entrypoint (no silent handoff)"
make_sandbox
# npm stub that fails
cat > "$BIN/npm" <<'EOF'
#!/bin/sh
exit 1
EOF
chmod +x "$BIN/npm"
# WS lockfile requires a dep not in APP node_modules to force the install path.
cat > "$WS/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": {}, "node_modules/missing-dep": {} } }
JSON
run_entrypoint
rc=$?
if [ "$rc" -ne 0 ]; then
  pass "entrypoint exits non-zero when dependency provisioning fails"
else
  fail "entrypoint must abort (non-zero exit) when npm install fails"
fi
if grep -q "__EXEC_HANDOFF__" "$ROOT/entrypoint.out"; then
  fail "entrypoint must NOT exec handoff when provisioning fails"
else
  pass "no exec handoff on provisioning failure"
fi
rm -rf "$ROOT"

# --- Case 7: lockfile-churn guard restores workspace lockfile if npm rewrites it ---
echo "case: lockfile-churn guard restores workspace lockfile after npm rewrites it"
make_sandbox
ORIGINAL_LOCK='{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": {}, "node_modules/missing-dep": {} } }'
# npm stub that rewrites the workspace lockfile (simulates npm rewriting during install).
cat > "$BIN/npm" <<EOF
#!/bin/sh
echo "npm \$*" >> "$ROOT/npm-calls.log"
printf '{ "modified": true }\\n' > "$WS/package-lock.json"
EOF
chmod +x "$BIN/npm"
printf '%s\n' "$ORIGINAL_LOCK" > "$WS/package-lock.json"
run_entrypoint
actual_lock=$(cat "$WS/package-lock.json")
if [ "$actual_lock" = "$ORIGINAL_LOCK" ]; then
  pass "lockfile restored to original after npm rewrites it"
else
  fail "original lockfile must be restored even if npm rewrites it during install"
fi
rm -rf "$ROOT"

# --- Case 8: a stamped tree for the same lockfile is reused (no reinstall) ---
echo "case: a previously provisioned tree (matching stamp) is reused without reinstalling"
make_sandbox
cat > "$WS/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": { "version": "1.0.0" }, "node_modules/new-dep": { "version": "2.0.0" } } }
JSON
run_entrypoint   # first run installs + writes the provision stamp
: > "$ROOT/npm-calls.log"   # forget the first install
run_entrypoint   # second run, same lockfile
if npm_was_called; then
  fail "must NOT reinstall when node_modules carries a stamp matching the lockfile"
else
  pass "stamped tree reused on the second run (no reinstall)"
fi
[ -f "$WS/node_modules/.nexus-provision-stamp" ] && pass "provision stamp written" || fail "provision stamp should be written after install"
rm -rf "$ROOT"

# --- Case 9: a stale stamp (lockfile changed) forces reinstall ---
echo "case: a stale stamp (lockfile changed since provisioning) forces reinstall"
make_sandbox
cat > "$WS/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": { "version": "1.0.0" }, "node_modules/new-dep": { "version": "2.0.0" } } }
JSON
run_entrypoint   # installs + stamps for this lockfile
: > "$ROOT/npm-calls.log"
# Lockfile drifts (e.g. a dependency added upstream after provisioning)
cat > "$WS/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": { "version": "1.0.0" }, "node_modules/new-dep": { "version": "2.0.0" }, "node_modules/added-later": { "version": "3.0.0" } } }
JSON
run_entrypoint
if npm_was_called; then
  pass "reinstall triggered when the lockfile no longer matches the stamp"
else
  fail "must reinstall when the workspace lockfile has drifted from the stamp"
fi
rm -rf "$ROOT"

# --- Case 10: stale cross-run residue (partial package, no stamp) is force-cleaned ---
echo "case: unstamped pre-existing node_modules (stale/partial residue) is force-cleaned before install"
make_sandbox
cat > "$WS/package-lock.json" <<'JSON'
{ "lockfileVersion": 3, "packages": { "": {}, "node_modules/baked-pkg": { "version": "1.0.0" }, "node_modules/new-dep": { "version": "2.0.0" } } }
JSON
# Simulate residue left by an earlier (older-image) run: a real node_modules
# with a corrupt/partial package and NO provision stamp.
mkdir -p "$WS/node_modules/corrupt-pkg"
echo "stale" > "$WS/node_modules/STALE_RESIDUE"
echo '{ "name": "corrupt-pkg", "main": "./index.js" }' > "$WS/node_modules/corrupt-pkg/package.json"
# (intentionally no index.js — the package directory exists but its entry is missing)
run_entrypoint
if [ -e "$WS/node_modules/STALE_RESIDUE" ]; then
  fail "stale residue must be removed by the force-clean reinstall"
else
  pass "stale residue removed (node_modules force-cleaned)"
fi
if npm_was_called; then
  pass "reinstall triggered for unstamped pre-existing node_modules"
else
  fail "must reinstall (not trust) an unstamped pre-existing node_modules"
fi
rm -rf "$ROOT"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
