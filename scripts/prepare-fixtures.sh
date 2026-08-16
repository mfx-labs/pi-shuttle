#!/usr/bin/env bash
#
# PS-6 local evidence helper (test/CI ONLY — never part of the product).
#
# Prepares SHA-pinned component package fixtures from EXACT local clean
# component checkouts, following the PS-5 evidence discipline: clean clone
# at the pinned HEAD → npm ci (exact lockfile) → build → npm pack → SHA-256.
# Produces a fixture manifest JSON (commit + artifact SHA-256 per component,
# plus the selected lane) that CI real-stack jobs verify against.
#
# ADR-002 B: LANE-AWARE Gateway preparation. The Gateway identity is
# selected from the accepted per-lane manifest (src/compat/manifest.ts,
# fault domain A) — never guessed, never defaulted to another lane:
#
#   linux-x86_64-posix-utf8-node22   → mfx-labs/project-gateway
#                                     @ 55f764290a4567a20557f1db19d2a6fb97572a97
#                                     package @project-gateway/artifact-core
#                                     artifact project-gateway-artifact-core-0.1.0.tgz
#   darwin-arm64-posix-utf8-node22    → EXACTLY the same historical identity
#                                     (the macOS fork is NEVER selected)
#   darwin-x86_64-posix-utf8-node22   → mfx-labs/project-gateway-macos
#                                     @ a90284b06420effb1ec1eeef14e7ed82e02c64e9
#                                     package @project-gateway/macos-core
#                                     artifact project-gateway-macos-core-0.1.0.tgz
#                                     bin project-gateway-macos-mcp
#
# An unknown/unmapped lane fails closed (exit 2) — never a fallback.
# The Intel tarball is verified AFTER packing: required runtime boundary
# entries present, forbidden entries absent, package/bin identity exact.
# The artifact digest recorded here is FIXTURE evidence only: the
# authoritative manifest digest stays null until an authorized release
# artifact is materialized.
#
# Explicit arguments only — no arbitrary URL cloning, no publication, no
# global install, no sudo, no source-repo mutation.
#
# Usage:
#   scripts/prepare-fixtures.sh \
#     --gateway-checkout <path> --pi-guard-checkout <path> \
#     --out <fixture-dir> [--lane <lane>]
#
# `--lane` is optional; absent, the preserved historical default is
# linux-x86_64-posix-utf8-node22.
#
# Expected baselines (fail closed on mismatch):
#   Gateway (historical) : commit 55f764290a4567a20557f1db19d2a6fb97572a97
#             (mfx-labs/project-gateway PS-6I local baseline — the exact
#             source closure incl. the darwin-x86_64 trusted host lane
#             (ADR-043); supersedes the PS-6R public baseline
#             28f1d3a12382bc145376c8d8a2d87d89495785ec; the public
#             repository is updated by a separate human-gated push)
#   Gateway (Intel fork) : commit a90284b06420effb1ec1eeef14e7ed82e02c64e9
#             (mfx-labs/project-gateway-macos PGM-DIST-1 provenance-complete
#             local baseline — the first commit whose Git tree contains the
#             accepted tracked x64 addon; MAC-4 accepted Intel runtime)
#   pi-guard: tag v0.1.2 @ commit 7a7580cc4cbd7926797564c72269394fc29a860a
#
# Output:
#   <fixture-dir>/project-gateway-artifact-core-0.1.0.tgz   (linux + darwin-arm64)
#   <fixture-dir>/project-gateway-macos-core-0.1.0.tgz      (darwin-x86_64)
#   <fixture-dir>/pi-guard-0.1.2.tgz
#   <fixture-dir>/fixture-manifest.json
set -euo pipefail

# ─── Lane-bound Gateway identities (authoritative: src/compat/manifest.ts) ──
# The historical pin literal GATEWAY_COMMIT="55f76429..." is asserted by
# tests/unit/manifest.test.ts — it is the linux + darwin-arm64 identity.
GATEWAY_COMMIT="55f764290a4567a20557f1db19d2a6fb97572a97"
GATEWAY_COMMIT_MACOS_INTEL="a90284b06420effb1ec1eeef14e7ed82e02c64e9"
PI_GUARD_COMMIT="7a7580cc4cbd7926797564c72269394fc29a860a"
PI_GUARD_TAG="v0.1.2"

LINUX_HOST_LANE="linux-x86_64-posix-utf8-node22"
DARWIN_ARM64_HOST_LANE="darwin-arm64-posix-utf8-node22"
DARWIN_X86_64_HOST_LANE="darwin-x86_64-posix-utf8-node22"

GATEWAY_CHECKOUT=""
PI_GUARD_CHECKOUT=""
OUT=""
LANE_ARG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --gateway-checkout) GATEWAY_CHECKOUT="$2"; shift 2 ;;
    --pi-guard-checkout) PI_GUARD_CHECKOUT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --lane) LANE_ARG="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$GATEWAY_CHECKOUT" ] || [ -z "$PI_GUARD_CHECKOUT" ] || [ -z "$OUT" ]; then
  echo "usage: $0 --gateway-checkout <path> --pi-guard-checkout <path> --out <fixture-dir> [--lane <lane>]" >&2
  exit 2
fi

# ─── Fail-closed lane selection (ADR-002 B) ───────────────────────────────
# Absent --lane: preserved historical default (linux). An explicit unknown
# lane fails closed here, BEFORE any checkout verification — never falls
# back to another lane.
LANE="${LANE_ARG:-$LINUX_HOST_LANE}"
GATEWAY_REPOSITORY="mfx-labs/project-gateway"
GATEWAY_PACKAGE="@project-gateway/artifact-core"
GATEWAY_ARTIFACT="project-gateway-artifact-core-0.1.0.tgz"
GATEWAY_BIN="project-gateway-mcp"
GATEWAY_COMMIT_EFFECTIVE="$GATEWAY_COMMIT"
LANE_IS_INTEL=0
if [ "$LANE" = "$DARWIN_X86_64_HOST_LANE" ]; then
  GATEWAY_REPOSITORY="mfx-labs/project-gateway-macos"
  GATEWAY_PACKAGE="@project-gateway/macos-core"
  GATEWAY_ARTIFACT="project-gateway-macos-core-0.1.0.tgz"
  GATEWAY_BIN="project-gateway-macos-mcp"
  GATEWAY_COMMIT_EFFECTIVE="$GATEWAY_COMMIT_MACOS_INTEL"
  LANE_IS_INTEL=1
elif [ "$LANE" = "$LINUX_HOST_LANE" ] || [ "$LANE" = "$DARWIN_ARM64_HOST_LANE" ]; then
  # linux and darwin-arm64: the SAME historical identity. The macOS fork
  # is NEVER selected for arm64 (ADR-002 decision 2).
  GATEWAY_COMMIT_EFFECTIVE="$GATEWAY_COMMIT"
else
  echo "fixture: unknown gateway lane: $LANE (accepted: $LINUX_HOST_LANE, $DARWIN_ARM64_HOST_LANE, $DARWIN_X86_64_HOST_LANE)" >&2
  exit 2
fi

verify_checkout() {
  local label="$1" path="$2" expected="$3" expected_tag="${4:-}"
  if [ ! -d "$path/.git" ]; then
    echo "fixture: $label checkout is not a git repository: $path" >&2
    exit 1
  fi
  local head
  head="$(git -C "$path" rev-parse HEAD)"
  if [ "$head" != "$expected" ]; then
    echo "fixture: $label HEAD mismatch: expected $expected, got $head (fail closed)" >&2
    exit 1
  fi
  if [ -n "$expected_tag" ]; then
    local tag
    tag="$(git -C "$path" describe --tags --exact-match "$expected" 2>/dev/null || echo '')"
    if [ "$tag" != "$expected_tag" ]; then
      echo "fixture: $label tag mismatch: expected $expected_tag at $expected, got '${tag:-none}'" >&2
      exit 1
    fi
  fi
  local dirty
  dirty="$(git -C "$path" status --porcelain | grep -v '^??' || true)"
  if [ -n "$dirty" ]; then
    echo "fixture: $label checkout has tracked modifications; refusing (clean closure required)" >&2
    exit 1
  fi
  echo "fixture: $label baseline verified ($head${expected_tag:+, $expected_tag})"
}

echo "fixture: lane $LANE — gateway repository $GATEWAY_REPOSITORY @ $GATEWAY_COMMIT_EFFECTIVE (package $GATEWAY_PACKAGE, artifact $GATEWAY_ARTIFACT, bin $GATEWAY_BIN)"
verify_checkout "gateway" "$GATEWAY_CHECKOUT" "$GATEWAY_COMMIT_EFFECTIVE"
verify_checkout "pi-guard" "$PI_GUARD_CHECKOUT" "$PI_GUARD_COMMIT" "$PI_GUARD_TAG"

mkdir -p "$OUT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ps6-fixtures.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Gateway artifact: exact lockfile install + build + pack in a scratch clone.
git clone -q --no-local "$GATEWAY_CHECKOUT" "$WORK/gateway"

# PGM-DIST-1 provenance correction (a90284b): the accepted Intel addon is a
# TRACKED file in the pinned Git tree — the clean clone carries it and no
# external addon staging exists. Prove the addon is tracked in the scratch
# clone, present in its working tree, and byte-identical to the accepted
# digest. Fail closed on any violation — never copy, rebuild, regenerate,
# or substitute the addon.
if [ "$LANE_IS_INTEL" -eq 1 ]; then
  ADDON_REL="native/darwin-x64/gateway_fs.node"
  ADDON_SHA256="0667af87eaf541a92fa299cd21cd2202dc825c6af9da650fd96cebf4553f6382"
  if ! git -C "$WORK/gateway" ls-files --error-unmatch -- "$ADDON_REL" >/dev/null 2>&1; then
    echo "fixture: Intel lane requires $ADDON_REL as a TRACKED file in the pinned Git tree (missing; refusing — no external addon staging)" >&2
    exit 1
  fi
  if [ ! -f "$WORK/gateway/$ADDON_REL" ]; then
    echo "fixture: Intel tracked addon absent from the clean checkout working tree: $ADDON_REL (refusing)" >&2
    exit 1
  fi
  ADDON_ACTUAL="$(shasum -a 256 "$WORK/gateway/$ADDON_REL" | awk '{print $1}')"
  if [ "$ADDON_ACTUAL" != "$ADDON_SHA256" ]; then
    echo "fixture: Intel tracked addon digest mismatch: expected $ADDON_SHA256, got $ADDON_ACTUAL (refusing)" >&2
    exit 1
  fi
  echo "fixture: Intel addon proven tracked in the pinned clean tree (sha256 $ADDON_ACTUAL)"
fi

( cd "$WORK/gateway" && npm ci --ignore-scripts >/dev/null && npm run build >/dev/null )
GATEWAY_TGZ="$(cd "$WORK/gateway" && npm pack --silent)"
mv "$WORK/gateway/$GATEWAY_TGZ" "$OUT/$GATEWAY_ARTIFACT"

# pi-guard artifact: pack the clean checkout directly (files: src, extensions).
PI_GUARD_TGZ="$(cd "$PI_GUARD_CHECKOUT" && npm pack --silent)"
mv "$PI_GUARD_CHECKOUT/$PI_GUARD_TGZ" "$OUT/pi-guard-0.1.2.tgz"

GATEWAY_SHA="$(shasum -a 256 "$OUT/$GATEWAY_ARTIFACT" | awk '{print $1}')"
PI_GUARD_SHA="$(shasum -a 256 "$OUT/pi-guard-0.1.2.tgz" | awk '{print $1}')"

# ─── Intel artifact verification (darwin-x86_64 ONLY; PGM-DIST-1 boundary) ──
# Prove the produced tarball carries the accepted Intel runtime boundary:
# required entries present, forbidden entries absent, package/bin identity
# exact. Fail closed on ANY mismatch. Never applied to historical artifacts.
if [ "$LANE_IS_INTEL" -eq 1 ]; then
  TARBALL="$OUT/$GATEWAY_ARTIFACT"
  ENTRIES="$(tar -tzf "$TARBALL")"

  for p in "package/package.json" "package/native/index.mjs" "package/native/darwin-x64/gateway_fs.node"; do
    if ! printf '%s\n' "$ENTRIES" | grep -Fxq "$p"; then
      echo "fixture: Intel tarball missing required entry: $p" >&2
      exit 1
    fi
  done
  if ! printf '%s\n' "$ENTRIES" | grep -q '^package/dist/'; then
    echo "fixture: Intel tarball missing required entry: package/dist/" >&2
    exit 1
  fi
  for p in "package/native/darwin-arm64/gateway_fs.node" "package/native/src" "package/native/build" "package/native/test"; do
    if printf '%s\n' "$ENTRIES" | grep -qE "^${p}(/|\$)"; then
      echo "fixture: Intel tarball contains forbidden entry: $p" >&2
      exit 1
    fi
  done

  tar -xOf "$TARBALL" package/package.json | node -e '
    let s = "";
    process.stdin.on("data", (d) => { s += d; });
    process.stdin.on("end", () => {
      const p = JSON.parse(s);
      const fail = (m) => { console.error("fixture: Intel artifact identity mismatch: " + m); process.exit(1); };
      if (p.name !== "@project-gateway/macos-core") fail("name " + p.name);
      if (p.version !== "0.1.0") fail("version " + p.version);
      if (p.bin === undefined || p.bin["project-gateway-macos-mcp"] !== "./dist/runtime/mcp/cli.js") fail("bin project-gateway-macos-mcp");
    });
  ' || exit 1

  echo "fixture: Intel tarball boundary verified (required entries present; arm64 addon, native/src, native/build, native/test absent)"
  echo "fixture: Intel artifact identity verified (@project-gateway/macos-core@0.1.0, bin project-gateway-macos-mcp -> ./dist/runtime/mcp/cli.js)"

  # Six-export loader verification: the EXTRACTED package's native loader
  # must load the extracted tracked addon and expose exactly the six
  # accepted primitives (fork PGM-DIST-1 boundary; MAC-4 accepted surface).
  mkdir -p "$WORK/intel-pkg"
  tar -xzf "$TARBALL" -C "$WORK/intel-pkg"
  cat > "$WORK/intel-loader-check.mjs" <<'NODE'
import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(process.argv[2]).href);
const addon = mod.loadGatewayFs();
const keys = Object.keys(addon).sort().join(',');
const expected = 'createExclusiveFileAt,getPath,openDirectoryAt,openExistingFileAt,readDirectoryEntries,unlinkAt';
if (keys !== expected) {
  console.error(`fixture: Intel loader export mismatch: expected [${expected}], got [${keys}]`);
  process.exit(1);
}
console.log('fixture: Intel loader exposed exactly the six accepted primitives');
NODE
  node "$WORK/intel-loader-check.mjs" "$WORK/intel-pkg/package/native/index.mjs" || exit 1
fi

cat > "$OUT/fixture-manifest.json" << EOF
{
  "lane": "$LANE",
  "gateway": { "commit": "$GATEWAY_COMMIT_EFFECTIVE", "artifact": "$GATEWAY_ARTIFACT", "sha256": "$GATEWAY_SHA" },
  "piGuard": { "commit": "$PI_GUARD_COMMIT", "tag": "$PI_GUARD_TAG", "artifact": "pi-guard-0.1.2.tgz", "sha256": "$PI_GUARD_SHA" }
}
EOF

echo "fixture: lane      $LANE"
echo "fixture: gateway   $GATEWAY_ARTIFACT  $GATEWAY_SHA"
echo "fixture: pi-guard  $PI_GUARD_SHA"
echo "fixture: manifest  $OUT/fixture-manifest.json"
