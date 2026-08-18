# pi-shuttle Product Contract

**Status:** current product contract.  
**Applies to:** pi-shuttle v0.1.1 Stable and the reviewed Latest source channel derived from `master`.

pi-shuttle is the end-user distribution and operator layer that composes Project Gateway MCP and pi-guard behind one bounded installation and CLI surface.

## 1. Product composition

A complete intended installation contains:

- **pi-shuttle** — installer, operator CLI, project registration, health checks, startup, and product-level diagnostics;
- **Project Gateway MCP** — bounded project access over stdio MCP;
- **pi-guard** — Pi-side authority enforcement.

The currently pinned component versions for v0.1.1 are:

- Project Gateway: `0.1.0` (target-specific Linux/macOS package identity);
- pi-guard: `0.1.2`;
- Pi compatibility baseline: `0.83.0` with compatibility probing for newer candidates.

The user may explicitly opt out of Gateway or pi-guard during installation. Such an installation is reported as partial rather than silently described as complete.

## 2. Product boundaries

pi-shuttle is NOT:

- a fork or source-history merge of Gateway or pi-guard;
- a generic shell or filesystem automation MCP;
- a Git mutation/push/rebase authority;
- a second trusted-storage implementation;
- a tunnel implementation;
- a daemon or operating-system service;
- a generic package manager;
- an auto-updater;
- a GUI;
- an AI-facing approval, issuance, activation, or self-grant surface.

The Secure MCP Tunnel used for ChatGPT connectivity is external and operator-owned. pi-shuttle remains stdio MCP internally through Project Gateway.

## 3. Installation channels

pi-shuttle has two intentionally distinct installation channels.

### Stable

Stable is distributed as an immutable versioned GitHub Release.

For v0.1.1:

```bash
curl -fsSL https://github.com/mfx-labs/pi-shuttle/releases/download/v0.1.1/install.sh | bash
```

Stable identity is release/version based. Published Stable assets are immutable and verified against their release metadata and SHA-256 pins.

### Latest

Latest follows reviewed `master`:

```bash
curl -fsSL https://raw.githubusercontent.com/mfx-labs/pi-shuttle/master/install.sh | bash
```

Each Latest invocation resolves `master` once to one exact full commit SHA before building or running it. Latest keeps semantic version identity separate from source identity.

A Latest install therefore uses a source-qualified pi-shuttle package identity equivalent to:

```text
pi-shuttle@0.1.1+latest.<exact-source-sha>
```

A newer Latest source commit may replace an older Latest source commit even when both report semantic version `0.1.1`. Post-v0.1.1 changes on `master` do not retroactively modify the immutable Stable v0.1.1 release.

`pi-shuttle --version` may describe a Latest build as pre-release/unpublished. This is expected because Latest is source-identified rather than represented by a new GitHub Release version.

## 4. Primary installation UX

The public installer asks only for installation choices it can actually perform:

1. install Project Gateway MCP?;
2. install Pi integration / pi-guard?;
3. installation directory;
4. command/bin directory.

Project registration is NOT performed inside the installer.

After a usable `COMPLETE` or `ALREADY INSTALLED` result, the installer prints the operator's next steps:

```text
pi-shuttle project add <path>
pi-shuttle doctor
pi-shuttle project list
pi-shuttle --help
```

Failure, refusal, busy, declined cleanup, or otherwise unusable outcomes do not print normal success onboarding guidance.

## 5. Persistent installation state

The installer uses exactly three persistent state classes:

- **CLEAN** — no valid final receipt and no recognized pi-shuttle leftovers;
- **INSTALLED** — a valid final receipt selects a supported installation whose command, package, and selected components verify at point of use;
- **INCOMPLETE** — recognizable pi-shuttle-owned leftovers from an interrupted or failed prior installation exist without a trustworthy final managed installation.

INCOMPLETE recovery is intentionally simple:

1. explain the recognized incomplete state;
2. require explicit operator consent;
3. remove only recognized pi-shuttle installer blockers;
4. reinstall as a fresh managed installation;
5. write one FINAL receipt only after successful activation.

Projects, runtime configuration, trusted stores, Gateway, pi-guard, and unrelated files are not forensic recovery material and are not deleted merely because an earlier installer attempt was incomplete. Reusable verified components may be retained.

Foreign, malformed, or ambiguous state is refused rather than guessed at.

## 6. Installer coordination

The installer has one ordinary per-user `install.lock` containing the installer PID.

- absent lock → acquire;
- live PID → report BUSY;
- OS-confirmed dead PID → treat as stale interrupted-install residue, remove, and retry;
- malformed, unreadable, symlink, directory, FIFO, or other special lock object → refuse safely.

The product threat model is a trusted personal machine. The lock prevents ordinary concurrent installer invocations and handles stale interrupted attempts; it is not intended as a malicious same-UID adversarial race defense.

FINAL receipt publication occurs atomically while the installer lock is held. There is no second persistent receipt lock.

## 7. Active-target safety

The installer must not destroy the currently usable pi-shuttle command merely because an exact Latest destination is present without a trustworthy final receipt.

If the current command already targets the exact requested source-qualified Latest package, the installer verifies a fresh candidate and may reconcile the active package only when package/path/bin/source identity and tree match exactly. A mismatch is refused without deleting or overwriting the active command target.

Rollback removes only state positively created by the current attempt and preserves a prior usable installation when available.

## 8. Project onboarding

Project registration is an explicit operator action:

```bash
pi-shuttle project add <path>
```

It:

1. verifies and canonicalizes the selected Git project root;
2. derives the workspace/store identity using the Gateway's committed identity rules;
3. initializes or verification-replays the trusted store through the supported Gateway operator bootstrap path;
4. creates operator-owned Git isolation state outside workspace roots;
5. registers the project in pi-shuttle runtime configuration;
6. verifies the resulting configuration.

The end user does not construct Gateway storage provenance, configuration identity, workspace identity, or trusted-store internals manually.

Initialization authority remains operator-only and is not exposed as an MCP tool.

## 9. Operator CLI

The intended CLI surface is:

```text
pi-shuttle doctor
pi-shuttle project add <path>
pi-shuttle project list
pi-shuttle project remove <path-or-workspace-id>
pi-shuttle start
pi-shuttle --help
pi-shuttle --version
```

`pi-shuttle start` launches the verified Gateway component as a foreground stdio MCP server.

For ChatGPT through Secure MCP Tunnel, the tunnel client should spawn `pi-shuttle start`; the operator does not run a second standalone copy in parallel.

## 10. Component verification

Component identities are pinned and verified before activation.

For the current v0.1.1 product:

- Linux x86_64 Gateway uses `mfx-labs/project-gateway`, version `0.1.0`;
- macOS x86_64 and arm64 targets use the shared `mfx-labs/project-gateway-macos`, version `0.1.0`;
- pi-guard is `0.1.2`;
- artifacts are SHA-256 pinned;
- Gateway/pi-guard source and runtime identities are verified by the installer/doctor according to their supported checks.

Stable binds the installed pi-shuttle package to immutable release assets. Latest additionally binds pi-shuttle to the exact resolved source SHA and verified source-qualified package tree.

## 11. Runtime prerequisites

Runtime dependencies are probed, never installed automatically by pi-shuttle:

- Node.js minimum: `22.19.0`;
- Git minimum: `2.30.0`;
- Pi minimum candidate: `0.83.0` when pi-guard is selected.

Pi `0.83.0` is the known-good compatibility baseline. Newer candidates require the committed pi-guard compatibility probe to pass.

The installer refuses sudo/root user-content installation and uses a per-user layout.

## 12. Platform support

Product-supported for v0.1.1:

- Linux x86_64;
- macOS Intel x86_64.

macOS Apple Silicon arm64 follows the same normal macOS installation journey and has a distribution-bound native candidate, but remains not product-supported until physical acceptance is completed. It is not claimed incompatible merely because support promotion is pending.

Windows is unsupported.

No public architecture selector, experimental target flag, or acceptance flag is part of the normal macOS UX.

## 13. Workspace and Git boundaries

Project access is confined to projects explicitly registered by the operator.

Project Gateway provides a bounded MCP tool surface rather than a general command runner. Git access is inspection-oriented; the product does not provide AI clients with push, rebase, history rewrite, or equivalent mutation authority.

## 14. Per-user layout

Default layout:

```text
~/.local/share/pi-shuttle/
  packages/
  stores/
  git-home/
  git-tmp/
  manifests/

~/.local/state/pi-shuttle/
  install.json
  install.lock          # temporary while installer runs
  staging/
  logs/

~/.config/pi-shuttle/
  runtime.json

~/.local/bin/pi-shuttle
```

`runtime.json` is operator/CLI-owned state. The installer does not register projects or write project runtime configuration as part of normal installation.

## 15. Fail-closed behavior

The product refuses rather than silently guesses or falls back when it encounters conditions such as:

- unsupported/unknown host target;
- target/envelope mismatch;
- foreign or ambiguous installation state;
- malformed or invalid final receipt;
- component identity or digest mismatch;
- incompatible runtime prerequisites;
- unsafe special-file installer lock state.

Recognized interrupted pi-shuttle state is the deliberate exception to a blanket refusal: it is surfaced as **INCOMPLETE** and may be cleaned/reinstalled only with explicit operator consent.

## 16. Hard prohibitions

No AI-facing initialization authority; no approval/issuance/activation authority surface; no generic admin MCP; no generic shell-execution MCP; no unrestricted filesystem-write MCP; no Git push/rebase/history-rewrite authority; no automatic installation of arbitrary Node/Git/Pi versions; no daemon/service management; no GUI; no generic package-manager abstraction; no auto-update; no unsupported platform claims; no weakening of project/workspace confinement or component identity verification.

Stable release assets remain immutable. Changes made on `master` belong to Latest until a separately authorized future Stable release is created.
