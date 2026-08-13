# Installation Contract

## 1. Primary experience

One command downloaded from GitHub:

```text
curl -fsSL <pi-shuttle-release-installer-url> | bash
```

The public URL is NOT finalized in this gate (separate human authorization).
The installer entrypoint (`install.sh`) is authored in the pi-shuttle
repository and is the only thing the one-liner fetches; everything else is
downloaded through it (manifest + pinned artifacts), never inline.

## 2. Interactive prompts (minimum, in order)

1. Install Project Gateway MCP? (default yes)
2. Install Pi integration / pi-guard? (default yes)
3. Installation directory (default `~/.local/share/pi-shuttle`)
4. Command/bin directory if necessary (default `~/.local/bin`)
5. Configure a project immediately? (default no → prints
   `pi-shuttle project add <path>` hint)

Any "no" answer for 1 or 2 produces a **PARTIAL INSTALLATION** report: a
clear banner at install end, a record in the install receipt, and a
persistent warning from `pi-shuttle doctor` until the missing component is
installed. The installer never silently downgrades to partial; the user
must explicitly opt out.

Non-interactive mode for CI/release lanes: `install.sh --batch` (or
equivalent env-pinned answers) — same semantics, prompts become explicit
required flags; no silent defaults in batch mode for components 1–2.

## 3. Version pinning (mandatory)

- The installer downloads the release manifest
  (`pi-shuttle-<version>.json`, see product-contract §6) and ONLY artifacts
  listed there.
- Every artifact is verified against its SHA-256 pin before use.
- Installed component versions are exact: gateway `0.1.0` (package +
  closure commit), pi-guard `0.1.2`, gateway dependencies
  `@modelcontextprotocol/server@2.0.0`, `ajv@8.20.0`, `zod@4.4.3`.
- Runtime environment requirements (probed from the environment, never
  installed by the installer): Node minimum `>=22.19.0` with `22.23.2` as
  the validated deterministic CI baseline (reported, never an equality
  gate; native arm64 remains mandatory on darwin-arm64); Git minimum
  `>=2.30.0` with `2.45.4` as the validated deterministic CI baseline
  (the Gateway additionally enforces its own minimum plus binary
  fingerprint/ownership checks, fail-closed, unchanged); Pi minimum
  candidate `>=0.83.0` with `0.83.0` as the known-good baseline — a
  non-baseline candidate requires the committed pi-guard compatibility
  probe to PASS.
- No `latest`, no floating versions, no "if newer is available" behavior.
  The installer never installs arbitrary Node/Git/Pi versions; a runtime
  version is accepted only through the minimum/probe policy of §4, never
  silently.

## 4. Preflight and refusal boundaries

- Platform/architecture: Linux x86_64 → supported; macOS arm64 →
  supported (PS-6); macOS Intel/x86_64 → supported (PS-6I); anything
  else → **refuse with a clear message** (do not claim support).
- Node: minimum runtime `22.19.0`; versions at/above the minimum are
  version-compatible. `22.23.2` is the validated CI baseline (reported,
  never an equality gate). Malformed/unreadable versions fail closed.
  (engines `>=22.0.0` is a package floor, not a support claim.)
- Git: minimum runtime `2.30.0` verified by version probe (discovered via
  PATH, never hardcoded `/usr/bin/git`); `2.45.4` is the validated CI
  baseline. The Gateway additionally enforces its own minimum plus binary
  fingerprint/ownership checks (fail-closed, unchanged).
- Pi: required when pi-guard is selected. Pi `0.83.0` = known-good baseline.
  Candidates `>= 0.83.0` require the committed pi-guard compatibility
  probe to PASS before acceptance (install and doctor); a failed probe,
  an unlocatable probe surface, or a version below `0.83.0` → **refuse
  with explanation**, not silent acceptance.
- Network/disk: enough space for two packages + node_modules; failure
  boundaries below.
- The installer refuses to run with `sudo`/root for user-content
  installation (per-user layout, no privileged operations).

## 5. Install sequence and failure boundaries

1. **Fetch + verify manifest** (SHA-pinned). Failure → abort, nothing written.
2. **Preflight** (§4). Failure → abort, nothing written.
3. **Staging**: download artifacts into a staging directory
   (`~/.local/state/pi-shuttle/staging/<install-id>/`), verify every SHA,
   unpack. Any failure → remove staging, restore prior state (nothing
   activated yet) → abort with typed message. This is the primary failure
   boundary: nothing is ever activated partially.
4. **Gateway component install**: pinned `npm install` of the gateway
   tarball + exact dependency pins into
   `~/.local/share/pi-shuttle/packages/project-gateway-artifact-core@0.1.0/`
   (npm registry access for the three pinned deps; gateway itself from the
   pinned artifact, never from the public registry — package is private).
   Verify the installed `bin/project-gateway-mcp` runs and the package
   exports match the manifest's expected surface.
5. **pi-guard component install**: discover the Pi package store
   (read-only discovery; supported package-store install path only, never
   auto-allowed registrations); install the pinned pi-guard `0.1.2`
   artifact; verify extension entry `extensions/pi-guard/index.ts`, package
   version, and the ADR-037 compatibility predicate (items 1–17).
6. **Activation**: atomically point the install to the new version
   (versioned directories + receipt flip; `~/.local/state/pi-shuttle/
   install.json` written last, atomically). Failure between 4 and 6 → prior
   receipt still authoritative; rerun heals (idempotence §7).
7. **Post-install verification**: run the doctor subset (platform, node,
   git, pi, gateway bin, pi-guard manifest, permissions). Failure → report
   with rollback guidance; the receipt marks the failed component `partial`.
8. **Install receipt**: `~/.local/state/pi-shuttle/install.json` (0600):
   manifest id, installed component versions + SHAs, install dir, bin dir,
   opt-outs (partial flags), timestamps. This is the single source of truth
   for doctor and for rollback.

## 6. Rollback semantics

- **Pre-activation failures**: remove staging; prior installation (if any)
  untouched and still active. Nothing to restore.
- **Post-activation failure** (verification step 7): restore the previous
  receipt + previous package version pointers from the retained
  pre-install snapshot; report both the failure and the successful
  restoration.
- **Full uninstall/rollback of a component**: re-run installer with the
  component explicitly opted out → receipt updated; the removed component's
  package directory is retained under
  `~/.local/share/pi-shuttle/packages/` (quarantined, documented) rather
  than force-deleted, so a failed rollback never destroys the only known
  good artifact. Operator may remove it manually.
- **Rollback never touches trusted stores.** Store data (both namespaces)
  is never deleted, moved, or rewritten by installer or rollback (immutable
  evidence; runbook §4/§6).
- **Rerun/idempotence**: a rerun of the installer always (a) re-verifies
  the current receipt against the manifest, (b) stages fresh, (c) activates
  only after full verification; installing the same version over itself is
  a no-op verification pass. Partial-install recovery = rerun with the
  missing component selected.

## 7. Partial installation recovery

- Receipt flags `partial` with the missing components.
- `pi-shuttle doctor` reports `partial installation` prominently and names
  the missing components and the exact rerun command.
- Re-running the installer with the missing component selected upgrades the
  receipt to `complete`. A "complete" installation requires BOTH Gateway
  and pi-guard per the product decision; the installer says so.
- A Gateway-only installation (pi-guard opted out) is a valid PARTIAL state
  (Gateway works locally; Pi-side enforcement absent); a pi-guard-only
  installation is a valid PARTIAL state (enforcement present; no Gateway
  tools); doctor reports both honestly.

## 8. Layout created (both platforms)

```
~/.local/share/pi-shuttle/            durable data
  packages/                           component installs (versioned)
  stores/<store-id>/                  trusted store parents (locators)
  git-home/<store-id>/  git-tmp/<store-id>/   operator Git isolation dirs (empty, 0700)
  manifests/pi-shuttle-<v>.json       installed manifest copy
~/.local/state/pi-shuttle/            disposable state
  install.json                        install receipt (0600)
  staging/                            install staging (removed on success)
  logs/                               bounded install logs
~/.config/pi-shuttle/                 operator configuration
  runtime.json                        Gateway startup document (0600) — owned by CLI, not installer
~/.local/bin/pi-shuttle               CLI entry (symlink to packages/...)
```

All paths derive from `$HOME` at runtime; nothing is hardcoded. The
installer does not write `~/.config/pi-shuttle/runtime.json` (that is the
CLI's operator-owned state; the installer only invokes `pi-shuttle project
add` when the user chooses "configure a project immediately").

## 9. Explicitly NOT in the installer

No auto-update; no daemon/service installation; no systemd units; no sudo
escalation; no PATH mutation beyond the chosen bin dir (with a clear printed
instruction when the bin dir is not on PATH); no tunnel or credentials;
no package-manager abstraction; no store access beyond verification.
