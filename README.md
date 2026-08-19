# pi-shuttle

pi-shuttle is the trusted bootstrap, installation, integrity, and lifecycle manager for **Project Gateway**. Gateway releases are selected through signed manifest-native metadata and can advance independently of pi-shuttle releases.

Giving an AI coding agent access to a project often means giving it far more authority than the task needs. pi-shuttle installs and launches a verified Project Gateway — a bounded MCP runtime that gives agents useful, operator-registered project access without a general-purpose shell, unrestricted filesystem access, or Git push authority — and it does so without ever letting a caller choose which Gateway code to trust.

## What it does

- **Trusted bootstrap** — a pinned `install.sh` for the exact release downloads the versioned pi-shuttle package, verifies its SHA-256 digest, and runs the manifest-native installer.
- **Signed Gateway release selection** — the installer selects the Gateway from production-signed metadata (compiled trust policy → signed keyring → signed stable channel → signed Gateway release manifest). No caller-selected Gateway version, releaseId, URL, or digest is involved.
- **Acquisition and integrity** — the Gateway artifact is acquired from the trusted release origin and verified against its signed artifact SHA-256; the installed package tree is verified against its signed package-tree SHA-256.
- **Content-addressed installation** — the verified Gateway is materialized into a content-addressed package root in the operator's per-user layout.
- **Receipt / lifecycle resolution** — the **Manifest-Native Installation Receipt Schema 1** is published last and is the single installed-truth authority for subsequent operations.
- **doctor / start** — `pi-shuttle doctor` probes installation and environment health; `pi-shuttle start` launches the exact verified installed Gateway bin as a foreground stdio MCP server. Both operate from the installed authority, never from caller-supplied identities.

## Product boundary

| Layer | Owns | Governed by |
|---|---|---|
| **pi-shuttle** | trusted bootstrap, release selection, acquisition, installation, integrity verification, installed-lifecycle resolution, doctor/start integration | its own release authority (`v0.1.4`) |
| **Project Gateway** | MCP runtime, MCP tools, workspace/business logic, artifact/domain functionality | production-signed Gateway release manifests (e.g. `gateway-macos-release-002`) |
| **pi-guard** | Pi-side enforcement inside the coding-agent environment | independently managed |

pi-shuttle installs **Project Gateway**. **pi-guard** is independently managed: it is not bundled with Gateway, is not part of the manifest-native receipt, is not installed as part of the Gateway transaction, and is not governed by Gateway release authority.

## Trust model

Every Gateway release is selected through the signed production chain:

```text
compiled pi-shuttle production root (pgw-root-2026-08)
        ↓
signed keyring
        ↓
signed stable channel
        ↓
signed Gateway release manifest
        ↓
Gateway artifact SHA-256
        ↓
package-tree SHA-256
        ↓
content-addressed installed Gateway
```

Production metadata is published as flat GitHub Release assets (`gateway-meta-keyring.json`, `gateway-meta-stable-channel.json`, and `gateway-meta-release-<releaseId>-<manifest-sha>.json`).

No caller-selected Gateway version, releaseId, URL, digest, executable, or filesystem path can establish release authority, and no semver "latest" is an authorization mechanism.

## Installation

The current stable installation path (pinned to the public v0.1.4 release):

```bash
curl -fsSL https://github.com/mfx-labs/pi-shuttle/releases/download/v0.1.4/install.sh | bash
```

The installer accepts no selections, installation paths, or release options; Gateway release identity comes entirely from the signed metadata chain at install time. Installation is per-user and refuses to run as root.

After a successful install:

```bash
pi-shuttle project add /path/to/project   # register a project
pi-shuttle doctor                         # check installation and environment health
pi-shuttle project list                   # list registered projects
pi-shuttle start                          # launch the Gateway stdio MCP server (foreground)
```

Project registration is a separate operator action; the installer does not register a project automatically.

If an installation is interrupted, rerun the same installer. The manifest-native installer fails closed on malformed state rather than attempting repair or migration.

## Requirements

**pi-shuttle bootstrap / installer**

- Node.js **>= 22.19.0** — the running Node interpreter drives the installer. Node 20 and below fail closed.
- `npm`, `tar`, and a downloader (`curl` or `wget`) on PATH; `shasum` is used for package verification.
- A normal (non-root) user account — pi-shuttle installs per-user.

**Selected Gateway lane**

- The current published Gateway release targets the `darwin-x86_64-posix-utf8-node22` lane (macOS on Intel x86_64, Node 22). Node 22.23.1 is verified against the public-origin installation; a Node 20 runtime fails closed.
- Git **>= 2.30.0** is required for project registration and is probed by `pi-shuttle doctor`.

Do not assume Node 20 is supported.

## How Gateway releases work

The stable channel selects exactly one signed Gateway release:

```text
stable channel
        ↓
exact signed release manifest
        ↓
artifact / package-tree verification
```

Ordinary Gateway patch releases can advance **independently of pi-shuttle**: Gateway version, releaseId, source commit, artifact SHA, and package-tree SHA arrive in production-signed Gateway metadata, not in a pi-shuttle source release. pi-shuttle changes only when a stable cross-component contract changes — for example trust policy/root, signing protocol/schema, supported host-lane policy, package/bin contract, transport policy, archive/layout policy, trusted release origins, or installer/lifecycle protocol.

**Current production (status):** Gateway release `gateway-macos-release-002` (package `0.1.0`, source commit `f6f1bd71…`) is published on the pi-shuttle `v0.1.4` release origin. This is the currently published production release — not a permanent compiled dependency of pi-shuttle.

## Installed lifecycle

- The installed Gateway is a **content-addressed package** in the operator's per-user layout.
- Installation authority is recorded in the **Manifest-Native Installation Receipt Schema 1**, published only after the package, cache, and selection chain are fully verified.
- **Offline installed-state verification**: doctor and start reconcile the receipt against the cached signed selection chain and the installed package-tree digest; they fail closed on malformed or missing state without attempting repair or fallback.
- **doctor / start** operate from the installed authority — no discovery, no bootstrap, no caller-selected identities.

## Security properties

- Production release metadata is **signed** (Ed25519 hierarchy under root `pgw-root-2026-08`).
- Gateway artifact and package-tree **digests are verified** before and at point of use.
- **Release authority is not caller-selected** — no version, releaseId, URL, digest, executable, or path is accepted from the caller.
- **Private signing keys are never distributed**; the installer contains only public trust material.
- Installation **fails closed** on invalid authority, integrity failures, or incompatible runtime conditions.

## Releases

- **Current:** pi-shuttle **v0.1.4** (manifest-native).
- v0.1.3 is the previous published manifest-native release.
- v0.1.2 is an **abandoned/unpublished** tag — no GitHub Release exists for it and it is not a released product version.
- v0.1.0 / v0.1.1 were the previous installation generation (envelope-based distribution) and are superseded by the manifest-native v0.1.4 release.

## Development / architecture docs

- [`docs/decisions/ADR-004-production-trust-root.md`](docs/decisions/ADR-004-production-trust-root.md) — manifest-native production trust root and release signing
- [`docs/decisions/`](docs/decisions/) — architecture decision records
- [`docs/chatgpt-secure-mcp-tunnel.md`](docs/chatgpt-secure-mcp-tunnel.md) — ChatGPT / Secure MCP Tunnel onboarding
- [`docs/reports/`](docs/reports/) — implementation and acceptance evidence (historical)

The previous-generation contract documents (`docs/product-contract.md`, `docs/installation-contract.md`, `docs/operator-cli-contract.md`, `docs/platform-support-contract.md`, `docs/component-boundaries.md`) describe the pre-manifest-native product and are retained as historical records.

## Component repositories

- [mfx-labs/project-gateway-macos](https://github.com/mfx-labs/project-gateway-macos) — the macOS Gateway; the currently published Gateway (`gateway-macos-release-002`) is built from this repository
- [mfx-labs/project-gateway](https://github.com/mfx-labs/project-gateway) — the Linux Gateway distribution repository
- [mfx-labs/pi-guard](https://github.com/mfx-labs/pi-guard) — Pi-side guard, independently managed

## License

The pi-shuttle repository and the v0.1.4 source distribution are licensed under the **MIT License**. See [LICENSE](LICENSE) for the full text. This license covers the pi-shuttle repository only; referenced components (Project Gateway, pi-guard, and third-party dependencies) retain their own licenses.
