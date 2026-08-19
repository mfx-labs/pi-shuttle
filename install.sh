#!/usr/bin/env bash
# pi-shuttle dual-channel installer entrypoint.
#
# With a built checkout this remains the repository-local launcher. When the
# dist tree is absent (including curl | bash), it bootstraps the latest source
# channel into a private temporary directory and invokes that snapshot's
# installer with the operator's argv unchanged.
set -euo pipefail

SOURCE_PATH="${BASH_SOURCE[0]-}"
SCRIPT_DIR=''
if [ -n "$SOURCE_PATH" ] && [ "${SOURCE_PATH##*/}" = 'install.sh' ] && [ -f "$SOURCE_PATH" ]; then
  SCRIPT_DIR="$(cd -- "$(dirname -- "$SOURCE_PATH")" && pwd)"
fi
NODE_BIN="${NODE_BIN:-node}"

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/dist/installer/main.js" ]; then
  exec "$NODE_BIN" "$SCRIPT_DIR/dist/installer/main.js" "$@"
fi

die() { printf 'pi-shuttle-installer: %s\n' "$*" >&2; exit 2; }

if [ "$#" -eq 1 ] && { [ "$1" = '--help' ] || [ "$1" = '-h' ]; }; then
  cat <<'EOF'
pi-shuttle latest installer
usage: curl -fsSL https://raw.githubusercontent.com/mfx-labs/pi-shuttle/master/install.sh | bash

The latest channel resolves master to one exact commit before building and
invoking the snapshot installer. The installer installs the signed stable
Gateway release through the manifest-native trust chain; it accepts no
selections or release options (pass --help to the installer for usage).
EOF
  exit 0
fi

printf 'pi-shuttle latest installer\n' >&2
command -v "$NODE_BIN" >/dev/null 2>&1 || die 'node not found on PATH (Node >= 22.19.0 is required)'
command -v npm >/dev/null 2>&1 || die 'npm not found on PATH'
command -v tar >/dev/null 2>&1 || die 'tar not found on PATH'

if command -v curl >/dev/null 2>&1; then
  # --url takes the URL as data; HTTPS is enforced for every redirect.
  fetch() { curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 --max-redirs 5 --url "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q --https-only --max-redirect=5 -O "$2" "$1"; }
else
  die 'curl or wget is required for latest installation'
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/pi-shuttle-latest.XXXXXX")"
cleanup_done=0
cleanup() {
  local status=$?
  if [ "$#" -gt 0 ]; then status=$1; fi
  if [ "$cleanup_done" -eq 1 ]; then return "$status"; fi
  cleanup_done=1
  rm -rf -- "$WORK" || true
  trap - EXIT
  exit "$status"
}
handle_signal() {
  case "$1" in
    INT) cleanup 130 ;;
    TERM) cleanup 143 ;;
    HUP) cleanup 129 ;;
  esac
}
trap cleanup EXIT
trap 'handle_signal INT' INT
trap 'handle_signal TERM' TERM
trap 'handle_signal HUP' HUP

API_URL='https://api.github.com/repos/mfx-labs/pi-shuttle/commits/master'
META="$WORK/master.json"
fetch "$API_URL" "$META" || die 'could not resolve latest master'
# Parse JSON as data. No part of the remote response is evaluated as shell.
SOURCE_SHA="$("$NODE_BIN" -e 'const fs = require("node:fs"); try { const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(typeof v.sha === "string" ? v.sha : ""); } catch {}' "$META")"
if ! [[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  die 'latest master resolution did not return one valid full commit SHA'
fi

LATEST_SOURCE="mfx-labs/pi-shuttle@$SOURCE_SHA"
printf 'source: %s\nchannel: latest\n' "$LATEST_SOURCE" >&2

SOURCE_TGZ="$WORK/source.tgz"
fetch "https://codeload.github.com/mfx-labs/pi-shuttle/tar.gz/$SOURCE_SHA" "$SOURCE_TGZ" || die 'could not download the exact latest source snapshot'
SOURCE_PARENT="$WORK/source"
EXPECTED_ROOT="pi-shuttle-$SOURCE_SHA"
mkdir -p -- "$SOURCE_PARENT"
tar -xzf "$SOURCE_TGZ" -C "$WORK/source"
if ! "$NODE_BIN" - "$WORK" "$SOURCE_PARENT" "$EXPECTED_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [work, parent, expected] = process.argv.slice(2);
const inside = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);
const real = (value) => fs.realpathSync(value);
const workRoot = real(work);
const parentRoot = real(parent);
if (!inside(workRoot, parentRoot)) throw new Error('source extraction parent escaped bootstrap work directory');
const entries = fs.readdirSync(parentRoot, { withFileTypes: true });
if (entries.length !== 1 || entries[0].name !== expected || !entries[0].isDirectory()) throw new Error('source archive must contain exactly one expected repository root directory');
const sourcePath = path.join(parentRoot, expected);
const sourceRoot = real(sourcePath);
if (!inside(workRoot, sourceRoot) || sourceRoot === workRoot) throw new Error('source repository root escaped bootstrap work directory');
function required(rel, kind) {
  const candidate = path.join(sourcePath, rel);
  let stat;
  try { stat = fs.lstatSync(candidate); } catch { throw new Error(`source snapshot is missing ${rel}`); }
  if (stat.isSymbolicLink()) throw new Error(`source snapshot path ${rel} must not be a symlink`);
  if ((kind === 'file' && !stat.isFile()) || (kind === 'directory' && !stat.isDirectory())) throw new Error(`source snapshot path ${rel} has the wrong type`);
  const resolved = real(candidate);
  if (!inside(sourceRoot, resolved) || !inside(workRoot, resolved)) throw new Error(`source snapshot path ${rel} escaped bootstrap work directory`);
}
required('package.json', 'file');
required('install.sh', 'file');
const optional = (rel) => {
  try { fs.lstatSync(path.join(sourcePath, rel)); return true; } catch { return false; }
};
for (const [rel, kind] of [['package-lock.json', 'file'], ['dist', 'directory'], ['dist/installer', 'directory'], ['dist/installer/main.js', 'file']]) {
  try { required(rel, kind); } catch (err) {
    if (!optional(rel)) continue;
    throw err;
  }
}
fs.writeFileSync(path.join(workRoot, 'source-root.txt'), `${sourceRoot}\n`, { mode: 0o600 });
NODE
then
  die 'exact source snapshot failed confined archive validation'
fi
SOURCE_DIR="$(<"$WORK/source-root.txt")"

(
  cd "$SOURCE_DIR"
  npm ci --ignore-scripts --no-audit --no-fund
  npm run build
  # Distribution hygiene: the packaged snapshot must not ship the
  # previous-generation installer-only modules (historical test harness /
  # old install core/selection/latest), so the public artifact presents no
  # alternate previous-generation installer surface. The manifest-native
  # entry (dist/installer/main.js) is the sole installer entry.
  rm -f dist/installer/legacy-entry.js dist/installer/legacy-entry.d.ts dist/installer/install.js dist/installer/install.d.ts dist/installer/selection.js dist/installer/selection.d.ts dist/installer/release/latest.js dist/installer/release/latest.d.ts
  npm pack --ignore-scripts --no-audit --no-fund --pack-destination "$WORK" >/dev/null
)

LATEST_VERSION="$("$NODE_BIN" -e 'const fs = require("node:fs"); const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(typeof p.version === "string" ? p.version : "");' "$SOURCE_DIR/package.json")"
[[ "$LATEST_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die 'latest source package version is invalid'
PACKAGE_TGZ="$WORK/pi-shuttle-$LATEST_VERSION.tgz"
if ! "$NODE_BIN" - "$WORK" "$SOURCE_DIR" "$SOURCE_DIR/dist/installer/main.js" "$PACKAGE_TGZ" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [work, source, installer, packagePath] = process.argv.slice(2);
const inside = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);
const real = (value) => fs.realpathSync(value);
const workRoot = real(work);
const sourceRoot = real(source);
if (!inside(workRoot, sourceRoot) || sourceRoot === workRoot) throw new Error('built source root escaped bootstrap work directory');
function requiredFile(candidate, label, root) {
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  const resolved = real(candidate);
  if (!inside(root, resolved) || !inside(workRoot, resolved)) throw new Error(`${label} escaped bootstrap work directory`);
}
requiredFile(path.join(sourceRoot, 'package.json'), 'package.json', sourceRoot);
requiredFile(path.join(sourceRoot, 'install.sh'), 'install.sh', sourceRoot);
requiredFile(installer, 'built installer', sourceRoot);
requiredFile(packagePath, 'built package', workRoot);
NODE
then
  die 'built snapshot paths failed confined validation'
fi
printf 'version: %s\n' "$LATEST_VERSION" >&2

ARTIFACT_DIR="$WORK/artifacts"
export PI_SHUTTLE_LATEST_SOURCE="$LATEST_SOURCE"
export PI_SHUTTLE_LATEST_PACKAGE_TGZ="$PACKAGE_TGZ"
export PI_SHUTTLE_LATEST_ARTIFACT_DIR="$ARTIFACT_DIR"

# Invoke only the verified built installer from the exact source snapshot.
# The archived install.sh is intentionally never executed recursively.
set +e
if { exec 3</dev/tty; } 2>/dev/null; then
  "$NODE_BIN" "$SOURCE_DIR/dist/installer/main.js" "$@" <&3
  status=$?
  exec 3<&-
else
  # fd 0 may still contain this shell program (curl | bash). Never expose
  # those bytes to Node prompts; complete batch invocations need no input.
  "$NODE_BIN" "$SOURCE_DIR/dist/installer/main.js" "$@" </dev/null
  status=$?
fi
set -e
exit "$status"
