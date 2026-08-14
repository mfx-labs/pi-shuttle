# pi-shuttle Product Contract

**Status:** pre-release contract (gate PS-0). **Applies to:** pi-shuttle v0.1.0.
**Normative inputs:** Project Gateway MCP closure `0720476b240f74372c7f1d0d1a78290b19537801`
(WP-15 release-ready; runbook `docs/operations/project-gateway-operator-runbook.md`,
WP-14B onboarding `docs/design/wp-14b-operator-onboarding.md`,
ADR-026/ADR-037, `docs/design/pi-guard-compatibility-and-authority-projection.md`),
and the pi-guard v0.1.2 repository (mfx-labs, commit `7a7580cc4cbd7926797564c72269394fc29a860a`, tag `v0.1.2`).

## 1. What pi-shuttle is

pi-shuttle is the **end-user product and distribution layer**. A complete
intended installation composes two separately versioned components behind
one user surface:

- **Project Gateway MCP** — ChatGPT ↔ project controlled gateway (nine-tool
  stdio MCP runtime, trusted local lifecycle/authority control plane);
- **pi-guard** — Pi-side authority enforcement (modes OFF/INSPECT/EDIT/WRITE
  + trusted-API-only `PROJECTED`; v0.1.2 verified lane).

plus pi-shuttle's own components: end-user installer, operator CLI
(`pi-shuttle`), onboarding/configuration, ChatGPT Secure MCP Tunnel
documentation, compatibility manifest, and release/test orchestration.

A user may explicitly opt out of a component during interactive
installation. The installer **must clearly report that the result is a
PARTIAL installation** and `pi-shuttle doctor` must repeat that verdict
until the omitted component is installed.

## 2. What pi-shuttle is NOT

- Not a fork, copy, or merge of Gateway or pi-guard source histories
  (they stay separate; no history merge for packaging convenience).
- Not a second storage engine: the trusted store is initialized ONLY by the
  Gateway's committed `initializeTrustedStore()` orchestrator.
- Not a tunnel: no HTTP server, OAuth server, tunnel implementation, or
  embedded transport in the product. The Secure MCP Tunnel is external and
  operator-owned (WP-14B §1/§3).
- Not a system service: no daemonization, no service manager, no auto-update,
  no GUI.
- Not a generic package manager: no abstraction layer, no "latest" installs,
  no arbitrary Node/Git/Pi version installation. Everything is pinned by the
  compatibility manifest.

## 3. Fixed product decisions (human-approved)

1. One-command primary install: conceptually `curl -fsSL <installer-url> | bash`.
   The public URL is **not finalized in this gate** (human authorization gate).
2. Installer interactively asks at minimum: (1) install Gateway?; (2) install
   Pi integration / pi-guard?; (3) installation directory; (4) command/bin
   directory if necessary; (5) configure a project immediately?
3. Installer pins compatible component versions; never silently installs
   arbitrary latest versions.
4. CLI is `pi-shuttle` with exactly `doctor`, `project add <path>`,
   `project list`, `project remove <path-or-workspace-id>`, `start`
   (plus `--help` / `--version` hygiene). No unrelated administration commands.
5. `pi-shuttle project add <path>` hides all internal Gateway bootstrap
   complexity from the end user (see §5).
6. Initialization authority is **operator-only**. It must never become an MCP
   tool, a model-callable authority, a ChatGPT-accessible trusted lifecycle
   authority, or a generic lifecycle write authority.
7. The Gateway remains stdio MCP internally. No embedded HTTP/OAuth/tunnel.
8. Pi 0.83.0 remains the declared compatibility baseline. Pi 0.84.1 present
   on the current Linux host is **not** evidence and must not be claimed.
9. Linux x86_64 is the v0.1.0 first-class target (human-approved
   Linux-only disposition); macOS arm64/Intel are deferred beyond v0.1.0
   (PS8B-DEFECT-001) and are refused by the v0.1.0 installer.
10. Default directory layout (both platforms, see platform-support-contract):
    `~/.local/share/pi-shuttle`, `~/.local/state/pi-shuttle`,
    `~/.config/pi-shuttle`, `~/.local/bin/pi-shuttle`.

## 4. Known onboarding blocker (release-blocking for v0.1.0)

Confirmed in the Gateway closure tree:

- `initializeTrustedStore()` (WP-8-C, `src/storage/initialization/initialize.ts`)
  is complete and tested, and replays idempotently (INITIALIZED = verification-only).
- Its production entry is intentionally unreachable: it requires a genuine
  branded `StorageBootstrapActionProvenance`, whose only declared future
  production consumer (`src/control-plane/storage-bootstrap-action.ts`) does
  not exist. The runtime composition root (`src/runtime/mcp/compose.ts`)
  mints the genuine provenance but only **re-verifies existing stores**
  (`verifyStoreInstance` + generation seeding) — it never initializes.
- Tests exercise initialization only through test-only provenance producers.

**Consequence:** a fresh end-user install cannot complete trusted-store
provisioning through any supported production/operator workflow. pi-shuttle
v0.1.0 cannot ship on top of the Gateway unchanged.

Resolution is the **smallest correct production composition surface**:
an operator-only `bootstrap` CLI verb in the Gateway package that reuses the
existing provenance pipeline, the WP-6 validator identity derivation, and
`initializeTrustedStore()` (component-boundaries §4, ADR-001, work package
PS-1). Users are never told to import private/internal source modules.

## 5. Trusted-store / operator bootstrap composition (contract-level)

`pi-shuttle project add <path>` is the supported HUMAN/OPERATOR-controlled
bootstrap path. It:

1. verifies the project root (exists, directory, canonicalized, is a Git
   repository);
2. verifies required Git/runtime conditions (doctor preflight; pinned lanes);
3. derives workspace/configuration identity deterministically from the
   canonical root (workspaceId `pgw:w:<32-hex>`, store locator
   `~/.local/share/pi-shuttle/stores/<32-hex>`, configuration identity
   derived by the Gateway's own WP-6 canonical computation — never
   hand-computed or invented by pi-shuttle);
4. initializes or verification-replays the trusted store — by invoking the
   Gateway `bootstrap` verb (PS-1), which internally mints the genuine
   provenance and calls `initializeTrustedStore()`; a second invocation is
   the verification replay (committed replay semantics);
5. creates operator-owned Git isolation state (`gitHome`/`gitTmpdir` empty
   dirs outside every workspace root) and the version-2 `artifactLocation`
   directory inside the project root;
6. registers the workspace (derived `workspaceId`, canonical root, store
   locator) in the operator runtime configuration;
7. persists the runtime configuration safely (atomic write, 0600);
8. verifies the resulting configuration (replay + resolved-config checks).

The end user never sees or constructs: `initializeTrustedStore`, action
provenance, configuration identity, configuration version, `store-v1`,
`config-v1`, workspace identity, or Git isolation directories.

The initialization authority stays operator-only: it is a CLI verb executed
by a human, absent from the MCP tool surface, absent from pi-guard, absent
from ChatGPT reach (no approval/issuance/activation/receipt tool exists).

## 6. Compatibility manifest (design)

Version identity and compatibility are explicit and pinned. Example
(shape only; the real file ships in PS-2/PS-3):

```json
{
  "piShuttle": "0.1.0",
  "gateway": "0.1.0",
  "gatewayCommit": "0720476b240f74372c7f1d0d1a78290b19537801",
  "gatewayArtifactSha256": "<computed-at-release>",
  "piGuard": "0.1.2",
  "piGuardCommit": "7a7580cc4cbd7926797564c72269394fc29a860a",
  "piGuardArtifactSha256": "<computed-at-release>",
  "piCompatibilityBaseline": "0.83.0",
  "node": "22.23.2",
  "git": "2.45.4",
  "gatewayDependencies": { "@modelcontextprotocol/server": "2.0.0", "ajv": "8.20.0", "zod": "4.4.3" },
  "configurationVersion": "2",
  "configFormatVersion": 1
}
```

Rules: exact versions only; no ranges, no `latest`; every artifact carries a
SHA-256 pin; the manifest ships with the installer and is embedded in the
CLI; the CLI refuses to operate (fail closed) when the installed manifest
does not match its own version. The manifest documents what is *claimed*;
anything not in the manifest is unverified by definition. `gatewayCommit`
pins the exact source closure for the packaged artifact; the packaged
tarball is the pilot-proven `npm pack` artifact
(`project-gateway-artifact-core-0.1.0.tgz` produced from the clean closure
checkout).

## 7. Hard prohibitions (binding)

No exposure of initialization authority through MCP; no
approval/issuance/activation authority surface; no generic admin MCP; no
shell-execution MCP; no generic filesystem-write MCP; no merging of Gateway
and pi-guard histories; no duplication of Gateway storage logic; no
duplication of pi-guard authority logic; no auto-update; no GUI; no
daemon/service management; no generic package-manager abstraction; no
automatic installation of arbitrary Node/Git/Pi versions; no unsupported
platform claims; no weakening of fail-closed behavior; no modification of
existing Gateway authority semantics; no touching of the WP-13D debris in
the Gateway development repository; no push / remote repository / tag /
publish / deploy without separate human authorization.
