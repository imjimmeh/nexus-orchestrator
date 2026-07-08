#!/bin/sh
# Heavy execution container entrypoint.
#
# The runner is project-agnostic: /app/node_modules holds only the harness
# runtime's own deps. /workspace/node_modules must derive from the MOUNTED
# repo's own package-lock.json at startup. The baked /app/node_modules is used
# only as a hardlink cache seed to speed up installs; correctness is never
# assumed from it.
#
# Provisioning decision:
#   * No workspace lockfile: expose baked deps via symlink (fast path).
#   * All lockfile-declared deps already present under /app/node_modules:
#     symlink fast path (common after a fresh image build against the same repo).
#   * The workspace node_modules was already provisioned by THIS logic for the
#     CURRENT lockfile (a matching provision stamp is present): trust it. This
#     is the common path for later steps in the same run reusing the worktree.
#   * Otherwise reconcile by force-cleaning, seeding from the baked tree and
#     running npm install. Fatal on failure — a dependency provisioning failure
#     must not silently hand off to the quality gate.
#
# Why force-clean rather than incremental: /workspace is a persistent host mount
# shared across a run's steps AND reused across runs of the same work item. A
# node_modules left by an earlier (possibly older-image) run can contain a
# partial/corrupt package whose directory exists but whose entry files are
# missing. `npm install` trusts a package that is "present" at the right version
# and will not repair intra-package file damage, so an incremental install over
# stale state silently leaves the gate to fail (e.g. vite "failed to resolve
# entry for package <pkg>"). The provision stamp lets us reuse a tree we built,
# and force-clean guarantees integrity for anything we did not.
#
# Test overrides (see heavy-entrypoint.test.sh):
#   HEAVY_ENTRYPOINT_APP_DIR   image root that holds the baked node_modules (/app)
#   HEAVY_ENTRYPOINT_NPM       npm executable (default: npm)
#   HEAVY_ENTRYPOINT_NODE      node executable for the lockfile probe (default: node)
#   HEAVY_ENTRYPOINT_EXEC      final handoff command (default: the harness runtime)
set -u

WORKSPACE_DIR="${WORKSPACE_PATH:-/workspace}"
APP_DIR="${HEAVY_ENTRYPOINT_APP_DIR:-/app}"
NPM_BIN="${HEAVY_ENTRYPOINT_NPM:-npm}"
NODE_BIN="${HEAVY_ENTRYPOINT_NODE:-node}"
DEFAULT_EXEC="node $APP_DIR/packages/harness-runtime/dist/main.js"

WORKSPACE_LOCK="$WORKSPACE_DIR/package-lock.json"
# Records the workspace lockfile checksum that the current node_modules was
# provisioned against. Lives inside node_modules (gitignored, so never staged).
STAMP_NAME=".nexus-provision-stamp"

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    cksum "$1" | cut -d' ' -f1
  fi
}

# Returns 0 iff every non-link, non-optional package declared in the workspace
# lockfile already exists under <root>/node_modules/<pkg>. Uses node (guaranteed
# present) to parse the real JSON lockfile. Returns 1 if the lockfile is absent,
# unparseable, or any required directory is missing.
deps_present_in() {
  root="$1"
  [ -f "$WORKSPACE_LOCK" ] || return 1
  "$NODE_BIN" -e '
    const fs = require("fs");
    let lock;
    try { lock = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { process.exit(1); }
    const root = process.argv[2];
    const pkgs = lock.packages || {};
    for (const key of Object.keys(pkgs)) {
      if (!key.startsWith("node_modules/")) continue;
      const entry = pkgs[key] || {};
      if (entry.link || entry.optional) continue;
      if (!fs.existsSync(root + "/" + key)) process.exit(1);
    }
    process.exit(0);
  ' "$WORKSPACE_LOCK" "$root" 2>/dev/null
}

# Returns 0 iff the workspace node_modules is a real directory (not a symlink to
# the baked tree) carrying a provision stamp that matches the current workspace
# lockfile checksum — i.e. it was installed by a previous invocation of this
# entrypoint for exactly this lockfile and can be trusted without reinstalling.
workspace_modules_current() {
  nm="$WORKSPACE_DIR/node_modules"
  [ -d "$nm" ] || return 1
  [ -L "$nm" ] && return 1
  stamp="$nm/$STAMP_NAME"
  [ -f "$stamp" ] || return 1
  [ "$(cat "$stamp" 2>/dev/null)" = "$(checksum "$WORKSPACE_LOCK" 2>/dev/null)" ]
}

link_image_modules() {
  if [ ! -e "$WORKSPACE_DIR/node_modules" ]; then
    ln -s "$APP_DIR/node_modules" "$WORKSPACE_DIR/node_modules" 2>/dev/null || true
  fi
}

install_workspace_modules() {
  # Force-clean: discard any pre-existing node_modules (stale symlink, partial
  # cross-run residue, corrupt package) so npm reconciles from a known-good seed
  # rather than trusting a tree it will not fully verify. Seed from the image's
  # node_modules (hardlink copy — fast and space-light) to keep already-correct
  # deps, then let npm reconcile the delta against the workspace lockfile.
  # --ignore-scripts keeps this bounded and avoids re-downloading Playwright
  # browsers etc.
  rm -rf "$WORKSPACE_DIR/node_modules"
  cp -al "$APP_DIR/node_modules" "$WORKSPACE_DIR/node_modules" 2>/dev/null \
    || cp -a "$APP_DIR/node_modules" "$WORKSPACE_DIR/node_modules" 2>/dev/null \
    || mkdir -p "$WORKSPACE_DIR/node_modules"
  # Snapshot and restore the workspace lockfile: npm install may rewrite it,
  # which would dirty-commit the mount and break subsequent git operations.
  lock_before="$(checksum "$WORKSPACE_LOCK" 2>/dev/null || echo none)"
  cp "$WORKSPACE_LOCK" "$WORKSPACE_DIR/.heavy-entrypoint-lock.bak" 2>/dev/null || true
  ( cd "$WORKSPACE_DIR" && "$NPM_BIN" install --no-audit --no-fund --ignore-scripts )
  install_rc=$?
  if [ "$install_rc" -eq 0 ] && [ -f "$WORKSPACE_LOCK" ]; then
    lock_after="$(checksum "$WORKSPACE_LOCK" 2>/dev/null || echo none)"
    if [ "$lock_before" != "$lock_after" ] && [ -f "$WORKSPACE_DIR/.heavy-entrypoint-lock.bak" ]; then
      cp "$WORKSPACE_DIR/.heavy-entrypoint-lock.bak" "$WORKSPACE_LOCK"
    fi
  fi
  rm -f "$WORKSPACE_DIR/.heavy-entrypoint-lock.bak" 2>/dev/null || true
  # Stamp the tree with the lockfile it satisfies so later steps in this run can
  # reuse it without reinstalling. Only stamp a successful install.
  if [ "$install_rc" -eq 0 ] && [ -d "$WORKSPACE_DIR/node_modules" ]; then
    checksum "$WORKSPACE_LOCK" > "$WORKSPACE_DIR/node_modules/$STAMP_NAME" 2>/dev/null || true
  fi
  return "$install_rc"
}

provision_node_modules() {
  [ -d "$WORKSPACE_DIR" ] || return 0
  [ -d "$APP_DIR/node_modules" ] || return 0

  if [ ! -f "$WORKSPACE_LOCK" ]; then
    link_image_modules
    return 0
  fi
  if deps_present_in "$APP_DIR"; then
    link_image_modules
    return 0
  fi
  if workspace_modules_current; then
    return 0
  fi
  install_workspace_modules
}

if ! provision_node_modules; then
  echo "heavy-entrypoint: dependency provisioning failed; aborting before handoff" >&2
  exit 1
fi

# shellcheck disable=SC2086 # intentional word-splitting of the handoff command
exec ${HEAVY_ENTRYPOINT_EXEC:-$DEFAULT_EXEC}
