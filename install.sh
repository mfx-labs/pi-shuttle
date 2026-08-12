#!/usr/bin/env bash
#
# pi-shuttle installer entrypoint (PS-3, local lane).
#
# This is the ONLY shell surface in the product and it is a fixed exec
# shim: it locates the pi-shuttle package and hands off to the Node
# installer core with argv passed through verbatim (never concatenated
# into a shell command). The future public one-liner may fetch this file
# once a release URL exists; in this gate the installer runs from the
# repository build.
#
#   install.sh [--help]
#   install.sh --batch --gateway yes|no --pi-guard yes|no [options]
#
# No privileged operation is performed; no system paths are assumed
# beyond PATH; all layout is home-derived (see the approved layout
# contract).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${NODE_BIN:-node}"

if [ ! -f "$SCRIPT_DIR/dist/installer/main.js" ]; then
  echo "pi-shuttle-installer: dist/installer/main.js not found — run 'npm run build' first" >&2
  exit 2
fi

exec "$NODE_BIN" "$SCRIPT_DIR/dist/installer/main.js" "$@"
