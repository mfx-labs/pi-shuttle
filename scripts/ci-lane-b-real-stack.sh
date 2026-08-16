#!/usr/bin/env bash
#
# PS-6 Lane B / PS-6I Lane C real-stack evidence orchestrator (CI
# test/evidence ONLY).
#
# Runs the REAL installed product stack against SHA-pinned package fixtures
# built on the runner from the EXACT public component checkouts
# (scripts/prepare-fixtures.sh — the authoritative artifact-build/provenance
# boundary): batch installer → Gateway dependency materialization
# (PS5-LINUX-003 release-pipeline step, encoded) → COMPLETE receipt →
# project add/list/doctor/re-add/remove → pi 0.83.0 lane + pi-guard install
# + exact `pi list` verification + extension-load probe → real
# `pi-shuttle start` MCP handshake probe → volume/arch facts record.
#
# Architecture-neutral: it runs on Linux x86_64 (Lane A), darwin arm64
# (Lane B), and darwin x86_64 (Lane C); the runner architecture is
# recorded, never assumed. EVIDENCE_LABEL selects the closing label.
#
# No external fixture hosting: fixtures arrive via the committed helper from
# exact public checkouts, and the manifest's recorded source commits are
# asserted against the workflow's repository-owned pins (fail closed).
#
# Env requirements (provisioned by the workflow):
#   FIXTURE_DIR   prepared fixtures + fixture-manifest.json
#   WORK_ROOT     disposable workspace root
#   PSHUTTLE_REPO pi-shuttle repository root (install.sh + dist)
#   PI_LANE_BIN   isolated pi 0.83.0 bin dir (lane/node_modules/.bin)
#   PI_LOADER     pi 0.83.0 extension loader.js (absolute)
#   GIT_2454      absolute path to the exact git 2.45.4 binary
#   NODE_BIN      absolute path to the exact node 22.23.2 executable
#   GATEWAY_COMMIT    exact public Gateway commit (workflow pin)
#   PI_GUARD_COMMIT   exact public pi-guard commit (workflow pin)
set -euo pipefail

EVIDENCE_LABEL="${EVIDENCE_LABEL:-LANE B}"

for v in FIXTURE_DIR WORK_ROOT PSHUTTLE_REPO PI_LANE_BIN PI_LOADER GIT_2454 NODE_BIN GATEWAY_COMMIT PI_GUARD_COMMIT; do
  if [ -z "${!v:-}" ]; then echo "real-stack: $v is required" >&2; exit 2; fi
done

# C3B1 lane-aware Gateway identity. GATEWAY_LANE is OPTIONAL: absent, the
# historical identity is preserved byte-for-byte (existing frozen Lane A/B/C
# workflows). An explicit lane must be one of the three accepted lanes and
# NEVER falls back to the historical identity; the Intel lane derives its
# package/bin identity here and its artifact name/commit/sha from the B
# fixture manifest (single authoritative source — no independent table).
GATEWAY_LANE="${GATEWAY_LANE:-}"
case "$GATEWAY_LANE" in
  ''|linux-x86_64-posix-utf8-node22|darwin-arm64-posix-utf8-node22)
    GATEWAY_PACKAGE="@project-gateway/artifact-core"
    GATEWAY_BIN="project-gateway-mcp"
    GATEWAY_ARTIFACT="project-gateway-artifact-core-0.1.0.tgz"
    ;;
  darwin-x86_64-posix-utf8-node22)
    GATEWAY_PACKAGE="@project-gateway/macos-core"
    GATEWAY_BIN="project-gateway-macos-mcp"
    GATEWAY_ARTIFACT="project-gateway-macos-core-0.1.0.tgz"
    ;;
  *)
    echo "real-stack: unknown gateway lane: $GATEWAY_LANE (no historical fallback)" >&2
    exit 2
    ;;
esac

NODE_DIR="$(dirname "$NODE_BIN")"
export HOME="$WORK_ROOT/home"
export PATH="$PI_LANE_BIN:$NODE_DIR:$PATH"
export NODE_BIN

echo "real-stack: lane facts — node=$("$NODE_BIN" -p "process.platform + ' ' + process.arch") nodeVersion=$("$NODE_BIN" --version) git=$("$GIT_2454" --version) pi=$("$PI_LANE_BIN/pi" --version 2>/dev/null || echo missing)"

# 1. Fixture provenance coherence against the repository-owned pins
#    (manifest commits must equal the exact public component SHAs), then
#    digest verification against the fixture manifest (fail closed).
MANIFEST="$FIXTURE_DIR/fixture-manifest.json"
GATEWAY_MANIFEST_COMMIT="$(node -e "console.log(require('$MANIFEST').gateway.commit)")"
PI_GUARD_MANIFEST_COMMIT="$(node -e "console.log(require('$MANIFEST').piGuard.commit)")"
test "$GATEWAY_MANIFEST_COMMIT" = "$GATEWAY_COMMIT" || { echo "real-stack: manifest gateway commit $GATEWAY_MANIFEST_COMMIT != pinned $GATEWAY_COMMIT" >&2; exit 1; }
test "$PI_GUARD_MANIFEST_COMMIT" = "$PI_GUARD_COMMIT" || { echo "real-stack: manifest pi-guard commit $PI_GUARD_MANIFEST_COMMIT != pinned $PI_GUARD_COMMIT" >&2; exit 1; }
echo "real-stack: fixture manifest commits match the repository-owned pins"
GATEWAY_SHA="$(node -e "console.log(require('$MANIFEST').gateway.sha256)")"
PI_GUARD_SHA="$(node -e "console.log(require('$MANIFEST').piGuard.sha256)")"
if [ -n "$GATEWAY_LANE" ]; then
  # The B fixture manifest is the authority for the explicit lane: its lane
  # and artifact name must agree with the requested lane (fail closed).
  MANIFEST_LANE="$(node -e "console.log(require('$MANIFEST').lane)")"
  test "$MANIFEST_LANE" = "$GATEWAY_LANE" || { echo "real-stack: fixture lane mismatch: expected $GATEWAY_LANE, manifest $MANIFEST_LANE" >&2; exit 1; }
  GATEWAY_ARTIFACT="$(node -e "console.log(require('$MANIFEST').gateway.artifact)")"
fi
echo "$GATEWAY_SHA  $FIXTURE_DIR/$GATEWAY_ARTIFACT" | shasum -a 256 -c - >/dev/null
echo "$PI_GUARD_SHA  $FIXTURE_DIR/pi-guard-0.1.2.tgz" | shasum -a 256 -c - >/dev/null
echo "real-stack: fixture digests verified against fixture-manifest.json"

mkdir -p "$HOME" "$WORK_ROOT/projects"
chmod 700 "$HOME"

# 2. Project fixture (a real git repository via the exact pinned git).
PROJECT="$WORK_ROOT/projects/alpha"
mkdir -p "$PROJECT"
printf '# alpha\n' > "$PROJECT/README.md"
( cd "$PROJECT" && "$GIT_2454" init -q && "$GIT_2454" add README.md && "$GIT_2454" -c user.name=ps6 -c user.email=ps6@local commit -qm init )

# 3. Batch installer (run 1 → truthful PARTIAL: dependency materialization pending).
set +e
bash "$PSHUTTLE_REPO/install.sh" --batch --gateway yes --pi-guard yes \
  --artifact-dir "$FIXTURE_DIR" \
  --expect-gateway-sha256 "$GATEWAY_SHA" \
  --expect-pi-guard-sha256 "$PI_GUARD_SHA" > "$WORK_ROOT/install-run1.log" 2>&1
RUN1=$?
set -e
echo "real-stack: installer run 1 exit $RUN1 (PARTIAL expected pre-materialization)"
grep -q "PARTIAL" "$WORK_ROOT/install-run1.log" || { echo "real-stack: run 1 was not PARTIAL:"; cat "$WORK_ROOT/install-run1.log"; exit 1; }

# 4. Gateway dependency materialization (exact contract pins; PS5-LINUX-003).
#    The on-disk package directory name derives from the lane artifact name
#    (componentDirName layout: <name>@<version> = <artifact>.tgz minus .tgz).
GATEWAY_PKG_DIR="${GATEWAY_ARTIFACT%.tgz}"
GATEWAY_PKG="$HOME/.local/share/pi-shuttle/packages/$GATEWAY_PKG_DIR"
"$NODE_DIR/npm" install --no-save --omit=dev --prefix "$GATEWAY_PKG" \
  @modelcontextprotocol/server@2.0.0 ajv@8.20.0 zod@4.4.3 > "$WORK_ROOT/materialize.log" 2>&1
echo "real-stack: gateway dependencies materialized (exact pins; package $GATEWAY_PACKAGE)"

# 5. Installer run 2 → COMPLETE.
bash "$PSHUTTLE_REPO/install.sh" --batch --gateway yes --pi-guard yes \
  --artifact-dir "$FIXTURE_DIR" \
  --expect-gateway-sha256 "$GATEWAY_SHA" \
  --expect-pi-guard-sha256 "$PI_GUARD_SHA" > "$WORK_ROOT/install-run2.log" 2>&1
grep -q "COMPLETE" "$WORK_ROOT/install-run2.log" || { echo "real-stack: run 2 was not COMPLETE:"; cat "$WORK_ROOT/install-run2.log"; exit 1; }
echo "real-stack: installer COMPLETE (receipt: gateway + pi-guard installed-verified, digestVerified)"

PSHUTTLE="$HOME/.local/bin/pi-shuttle"
PI_GUARD_PKG="$HOME/.local/share/pi-shuttle/packages/pi-guard@0.1.2"

# 6. pi-guard exact-source verification through `pi list`.
# pi 0.83.0 prints the installed source twice — the entry relative to its
# plugin root and the resolved ABSOLUTE path on an indented sub-line;
# leading whitespace is stripped so the exact absolute source line is
# matched full-line (never substring), as in the PS-5 Linux E2E.
"$PI_LANE_BIN/pi" list | sed 's/^[[:space:]]*//' | grep -Fqx "$PI_GUARD_PKG" || {
  echo "real-stack: exact pi-guard source not confirmed in pi list"; "$PI_LANE_BIN/pi" list; exit 1; }
echo "real-stack: pi list confirms the exact pi-guard source"

# 7. pi-guard extension-load probe (pi 0.83.0's own loader).
PI_GUARD_ENTRY="$PI_GUARD_PKG/extensions/pi-guard/index.ts"
PI_LOADER="$PI_LOADER" PI_GUARD_ENTRY="$PI_GUARD_ENTRY" HOME="$HOME" "$NODE_BIN" "$PSHUTTLE_REPO/scripts/pi-extension-load-probe.mjs"

# 8. Project lifecycle on the real installed stack.
"$PSHUTTLE" project add "$PROJECT" > "$WORK_ROOT/add1.log" 2>&1
# The CLI column-aligns the state value ("state:     initialized");
# whitespace-tolerant exact-state match.
grep -qE "state:[[:space:]]+initialized" "$WORK_ROOT/add1.log" || { cat "$WORK_ROOT/add1.log"; exit 1; }
"$PSHUTTLE" project list | grep -q "pgw:w:" || exit 1
"$PSHUTTLE" project add "$PROJECT" > "$WORK_ROOT/add2.log" 2>&1
grep -q "verification-replay" "$WORK_ROOT/add2.log" || { cat "$WORK_ROOT/add2.log"; exit 1; }
"$PSHUTTLE" doctor > "$WORK_ROOT/doctor.log" 2>&1 || { echo "real-stack: doctor exit nonzero:"; cat "$WORK_ROOT/doctor.log"; exit 1; }
grep -q "platform: supported" "$WORK_ROOT/doctor.log" || { cat "$WORK_ROOT/doctor.log"; exit 1; }
WORKSPACE_ID="$(grep -o 'pgw:w:[0-9a-f]\{32\}' "$WORK_ROOT/add1.log" | head -1)"
"$PSHUTTLE" project remove "$WORKSPACE_ID" > "$WORK_ROOT/remove.log" 2>&1
grep -q "deregistered" "$WORK_ROOT/remove.log" || { cat "$WORK_ROOT/remove.log"; exit 1; }
"$PSHUTTLE" project add "$PROJECT" > "$WORK_ROOT/add3.log" 2>&1
grep -q "verification-replay" "$WORK_ROOT/add3.log" || { cat "$WORK_ROOT/add3.log"; exit 1; }
echo "real-stack: lifecycle green (add → list → exact re-add → doctor → remove → re-add)"

# 9. Real MCP handshake through `pi-shuttle start` (nine-tool surface).
#    GATEWAY_LANE is passed EXPLICITLY from the lane this script already
#    selected (the probe's sole identity selector — never ambient state);
#    EXPECTED_GATEWAY_PACKAGE asserts consistency with that selection.
HOME="$HOME" PATH="$PATH" PSHUTTLE="$PSHUTTLE" GATEWAY_LANE="$GATEWAY_LANE" EXPECTED_GATEWAY_PACKAGE="$GATEWAY_PACKAGE" "$NODE_BIN" "$PSHUTTLE_REPO/scripts/mcp-handshake-probe.mjs"

# 10. Volume/arch facts record (Lane B evidence).
echo "real-stack: volume case-sensitivity record:"
if command -v diskutil >/dev/null 2>&1; then
  diskutil info / 2>/dev/null | grep -iE "file system personality|case-sensitive" || echo "(diskutil info unavailable)"
else
  echo "(not darwin — volume facts recorded by the runner context)"
fi
echo "real-stack: $EVIDENCE_LABEL REAL-STACK EVIDENCE — GREEN"
