#!/usr/bin/env bash
#
# PS-6 Lane B Git 2.45.4 provisioning (test/CI evidence only; SIR-PS6-003
# correction). The product requirement stays exact: Gateway runtime
# hard-requires `git --version` containing 2.45.4 (`wrong-version` fails
# closed). This script provisions ONE exact source artifact:
#
#   kernel.org git-2.45.4.tar.gz (authoritative upstream source release)
#   SHA-256 pinned (reviewed digest, verified BEFORE extraction/build)
#
# with a user/workspace-scope source build (no sudo, no system Git
# replacement), an exact built-version assertion (fail closed on
# mismatch), and recorded origin/digest/path/version evidence.
#
# Usage:
#   scripts/ci-provision-git-2454.sh <work-dir> <prefix-dir>
#     <work-dir>    scratch space for the downloaded tarball + source tree
#     <prefix-dir>  user-scope install prefix (e.g. "$RUNNER_TEMP/git-2.45.4")
#   Prints the installed git binary path on stdout (last line).
set -euo pipefail

WORK_DIR="${1:?usage: ci-provision-git-2454.sh <work-dir> <prefix-dir>}"
PREFIX_DIR="${2:?usage: ci-provision-git-2454.sh <work-dir> <prefix-dir>}"

GIT_VERSION="2.45.4"
GIT_TGZ="git-2.45.4.tar.gz"
GIT_TGZ_URL="https://mirrors.edge.kernel.org/pub/software/scm/git/git-2.45.4.tar.gz"
# Reviewed digest of the exact kernel.org v2.45.4 source tarball
# (cross-checked against the www.kernel.org mirror at correction time).
GIT_TGZ_SHA256="896c6640ee56adc7f83a78b122d129231ca8ce7fd582f606d282a7114eb0b4ab"

mkdir -p "$WORK_DIR" "$PREFIX_DIR"

# 1. Exact source artifact, digest verified BEFORE any extraction/build.
curl -fsSL "$GIT_TGZ_URL" -o "$WORK_DIR/$GIT_TGZ"
echo "$GIT_TGZ_SHA256  $WORK_DIR/$GIT_TGZ" | shasum -a 256 -c - >/dev/null

# 2. User-scope source build (no sudo, no system Git replacement).
tar -xzf "$WORK_DIR/$GIT_TGZ" -C "$WORK_DIR"
SRC_DIR="$WORK_DIR/git-$GIT_VERSION"
test -d "$SRC_DIR" # fail closed if the archive shape is unexpected
make -C "$SRC_DIR" prefix="$PREFIX_DIR" -j2 all >/dev/null
make -C "$SRC_DIR" prefix="$PREFIX_DIR" install >/dev/null

# 3. Exact built-version assertion (fail closed on any drift).
BUILT_VERSION="$("$PREFIX_DIR/bin/git" --version)"
test "$BUILT_VERSION" = "git version $GIT_VERSION"

# 4. Record evidence (origin, digest, path, version).
{
  echo "git-origin=$GIT_TGZ_URL"
  echo "git-tarball-sha256=$GIT_TGZ_SHA256"
  echo "git-path=$PREFIX_DIR/bin/git"
  echo "git-version=$BUILT_VERSION"
} >> "$GITHUB_STEP_SUMMARY" 2>/dev/null || true

echo "provisioned $BUILT_VERSION at $PREFIX_DIR/bin/git (digest-verified)"
echo "$PREFIX_DIR/bin/git"
