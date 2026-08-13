#!/usr/bin/env bash
#
# PS-6 local evidence helper (test/CI ONLY — never part of the product).
#
# Prepares SHA-pinned component package fixtures from EXACT local clean
# component checkouts, following the PS-5 evidence discipline: clean clone
# at the pinned HEAD → npm ci (exact lockfile) → build → npm pack → SHA-256.
# Produces a fixture manifest JSON (commit + artifact SHA-256 per component)
# that CI real-stack jobs verify against.
#
# Explicit arguments only — no arbitrary URL cloning, no publication, no
# global install, no sudo, no source-repo mutation.
#
# Usage:
#   scripts/prepare-fixtures.sh \
#     --gateway-checkout <path> --pi-guard-checkout <path> \
#     --out <fixture-dir>
#
# Expected baselines (fail closed on mismatch):
#   Gateway : commit 55f764290a4567a20557f1db19d2a6fb97572a97
#             (mfx-labs/project-gateway PS-6I local baseline — the exact
#             source closure incl. the darwin-x86_64 trusted host lane
#             (ADR-043); supersedes the PS-6R public baseline
#             28f1d3a12382bc145376c8d8a2d87d89495785ec; the public
#             repository is updated by a separate human-gated push)
#   pi-guard: tag v0.1.2 @ commit 7a7580cc4cbd7926797564c72269394fc29a860a
#
# Output:
#   <fixture-dir>/project-gateway-artifact-core-0.1.0.tgz
#   <fixture-dir>/pi-guard-0.1.2.tgz
#   <fixture-dir>/fixture-manifest.json
set -euo pipefail

GATEWAY_COMMIT="55f764290a4567a20557f1db19d2a6fb97572a97"
PI_GUARD_COMMIT="7a7580cc4cbd7926797564c72269394fc29a860a"
PI_GUARD_TAG="v0.1.2"

GATEWAY_CHECKOUT=""
PI_GUARD_CHECKOUT=""
OUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --gateway-checkout) GATEWAY_CHECKOUT="$2"; shift 2 ;;
    --pi-guard-checkout) PI_GUARD_CHECKOUT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$GATEWAY_CHECKOUT" ] || [ -z "$PI_GUARD_CHECKOUT" ] || [ -z "$OUT" ]; then
  echo "usage: $0 --gateway-checkout <path> --pi-guard-checkout <path> --out <fixture-dir>" >&2
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

verify_checkout "gateway" "$GATEWAY_CHECKOUT" "$GATEWAY_COMMIT"
verify_checkout "pi-guard" "$PI_GUARD_CHECKOUT" "$PI_GUARD_COMMIT" "$PI_GUARD_TAG"

mkdir -p "$OUT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ps6-fixtures.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Gateway artifact: exact lockfile install + build + pack in a scratch clone.
git clone -q --no-local "$GATEWAY_CHECKOUT" "$WORK/gateway"
( cd "$WORK/gateway" && npm ci --ignore-scripts >/dev/null && npm run build >/dev/null )
GATEWAY_TGZ="$(cd "$WORK/gateway" && npm pack --silent)"
mv "$WORK/gateway/$GATEWAY_TGZ" "$OUT/project-gateway-artifact-core-0.1.0.tgz"

# pi-guard artifact: pack the clean checkout directly (files: src, extensions).
PI_GUARD_TGZ="$(cd "$PI_GUARD_CHECKOUT" && npm pack --silent)"
mv "$PI_GUARD_CHECKOUT/$PI_GUARD_TGZ" "$OUT/pi-guard-0.1.2.tgz"

GATEWAY_SHA="$(shasum -a 256 "$OUT/project-gateway-artifact-core-0.1.0.tgz" | awk '{print $1}')"
PI_GUARD_SHA="$(shasum -a 256 "$OUT/pi-guard-0.1.2.tgz" | awk '{print $1}')"

cat > "$OUT/fixture-manifest.json" << EOF
{
  "gateway": { "commit": "$GATEWAY_COMMIT", "artifact": "project-gateway-artifact-core-0.1.0.tgz", "sha256": "$GATEWAY_SHA" },
  "piGuard": { "commit": "$PI_GUARD_COMMIT", "tag": "$PI_GUARD_TAG", "artifact": "pi-guard-0.1.2.tgz", "sha256": "$PI_GUARD_SHA" }
}
EOF

echo "fixture: gateway   $GATEWAY_SHA"
echo "fixture: pi-guard  $PI_GUARD_SHA"
echo "fixture: manifest  $OUT/fixture-manifest.json"
