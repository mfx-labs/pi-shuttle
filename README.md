# pi-shuttle

**A local, bounded way to connect AI coding agents to your projects.**

pi-shuttle packages **Project Gateway** and **pi-guard** into one operator-facing product. It installs and verifies the reviewed components, registers only the projects you choose, checks that the environment is healthy, and starts a constrained MCP gateway — without giving an AI agent a general-purpose shell, unrestricted filesystem access, or Git push authority.

> **v0.1.0 is available now.**
>
> Product-supported: **Linux x86_64** and **macOS Intel x86_64**.
> Apple Silicon follows the same macOS installation path, but is not yet product-supported.

## Install

Requirements:

- **Node.js >= 22.19.0**
- **Git >= 2.30.0**
- **Pi >= 0.83.0**

Install the version-pinned release:

```bash
curl -fsSL https://github.com/mfx-labs/pi-shuttle/releases/download/v0.1.0/install.sh | bash
```

Then verify the installation:

```bash
pi-shuttle doctor
```

Register a project:

```bash
pi-shuttle project add /path/to/project
```

At this point, choose how your MCP client will connect.

### Direct/local MCP client

For a local MCP client that can launch or attach to a stdio MCP server, use:

```bash
pi-shuttle start
```

`pi-shuttle start` launches Project Gateway as a **foreground stdio MCP server**. Its stdin/stdout are reserved for the MCP protocol, so running it directly in a terminal can look idle while it waits for an MCP client. That is expected behavior, not a hang.

```text
install
   ↓
doctor
   ↓
project add
   ↓
pi-shuttle start
   ↓
local MCP client ↔ Project Gateway ↔ registered project
```

### ChatGPT through Secure MCP Tunnel

For ChatGPT, **do not keep a separate `pi-shuttle start` process running yourself**. Configure OpenAI Secure MCP Tunnel and set the local stdio MCP command to:

```text
pi-shuttle start
```

`tunnel-client` then spawns pi-shuttle when needed and carries the MCP protocol over the private outbound tunnel.

```text
install
   ↓
doctor
   ↓
project add
   ↓
configure Secure MCP Tunnel
   ↓
tunnel-client run
   └── spawns: pi-shuttle start
                  ↓
             Project Gateway
                  ↓
           registered project
```

See [`docs/chatgpt-secure-mcp-tunnel.md`](docs/chatgpt-secure-mcp-tunnel.md) for the complete ChatGPT onboarding flow.

The installer detects the host internally, selects the appropriate release envelope, downloads the pinned components, and verifies their SHA-256 digests before installation. End users do not need to clone Project Gateway or pi-guard, run `prepare-fixtures.sh`, or provide `--artifact-dir`.

## What pi-shuttle does

Three components work together:

- **pi-shuttle** — the operator layer for installation, project registration, health checks, and startup.
- **Project Gateway** — the bounded MCP/project-access component. It exposes exactly nine public MCP tools for validation, inspection, verification, controlled artifact drafting/persistence, and change inspection.
- **pi-guard** — the Pi-side enforcement component that keeps the same boundaries meaningful inside the coding-agent environment.

pi-shuttle pins the component identities used by a release and verifies downloaded artifacts before activation.

## Why it exists

Giving an AI coding agent access to a project often means giving it much more authority than the task actually needs.

pi-shuttle takes the opposite approach:

```text
useful project access
        ≠
unrestricted machine access
```

| Boundary | pi-shuttle model |
|---|---|
| Arbitrary shell execution | No generic shell or exec MCP tool |
| Filesystem access | Confined to registered project boundaries |
| Git mutation | Inspection only; no push/rebase/rewrite authority |
| Self-issued authority | AI clients cannot approve or grant themselves authority |
| Component identity | Version- and digest-verified |
| Installation state | Per-user, operator-owned |
| Unsupported environments | Fail closed instead of silently falling back |

## Supported platforms

| Platform | Architecture | v0.1.0 |
|---|---|---|
| Linux | x86_64 | **Supported** |
| macOS | Intel x86_64 | **Supported** |
| macOS | Apple Silicon arm64 | **Not product-supported yet** |
| Windows | — | Unsupported |

### Apple Silicon

Apple Silicon uses the **same normal macOS installation journey** as Intel Macs. There is no public architecture, lane, target, experimental, or acceptance selector.

The v0.1.0 macOS Gateway package contains both x86_64 and arm64 native candidates, and the installer can structurally route an arm64 Mac to the shared macOS release. Physical Apple Silicon runtime acceptance has not yet been completed.

Therefore:

- arm64 is **not product-supported in v0.1.0**;
- arm64 is **not known incompatible**;
- no Apple Silicon physical/runtime acceptance is claimed.

## One installer, platform-specific verified components

A single `install.sh` detects the host internally:

```text
                     install.sh
                         │
              ┌──────────┴──────────┐
              │                     │
        Linux x86_64              macOS
              │                     │
      Linux release envelope   macOS release envelope
              │                     │
      Project Gateway          shared macOS Gateway
                                   │
                          ┌────────┴────────┐
                          │                 │
                        x86_64            arm64
                       supported      candidate path
```

The installer selects the correct release envelope, verifies its digest, verifies the component artifacts it references, and refuses target or identity mismatches. Bootstrap validation then derives the actual host target again before activation.

## Common commands

```bash
# Inspect installation and environment health
pi-shuttle doctor

# Register a Git project
pi-shuttle project add /path/to/project

# List registered projects
pi-shuttle project list

# Remove a registered project
pi-shuttle project remove /path/to/project

# Start the foreground stdio MCP server for a direct/local MCP client
pi-shuttle start
```

`project add` registers an operator-selected Git repository. Re-adding the same canonical project is safe.

`start` launches the Gateway using the verified installed component recorded in the pi-shuttle receipt. It remains in the foreground and waits for MCP traffic over stdin/stdout. For ChatGPT through Secure MCP Tunnel, `tunnel-client` should spawn `pi-shuttle start`; you do not run a second standalone copy yourself.

## Security model

### Bounded MCP surface

Project Gateway exposes exactly nine public tools rather than a generic command runner:

- `validate-artifact`
- `inspect-stored-record`
- `inspect-registry`
- `inspect-audit-history`
- `verify-record`
- `enumerate-class`
- `draft-artifact`
- `persist-artifact`
- `inspect-changes`

There is no general shell tool, Git push tool, or AI-facing approval/grant surface.

### Workspace confinement

Project access is tied to projects explicitly registered by the operator. Path resolution and containment checks prevent arbitrary filesystem locations from being treated as part of the workspace.

### Read-only Git inspection

Git is used for inspection and project identity, not mutation. The Gateway does not provide AI clients with push, rebase, history-rewrite, or equivalent repository authority.

### Verified installation

Release artifacts are bound to release envelopes and SHA-256 digests. The installer refuses mismatched artifacts rather than silently accepting another package or platform variant.

### Per-user state

Installation and trusted state are operator-owned and per-user. `pi-shuttle doctor` inspects state but does not silently repair or mutate it.

### Fail closed

Unknown platforms, target/envelope mismatches, component drift, invalid receipts, integrity failures, and incompatible runtime conditions are surfaced as failures instead of falling back to another target.

## macOS distribution note

v0.1.0 is **not code-signed or Apple-notarized** and must not be described as signed or notarized distribution.

On macOS, quarantine handling occurs after artifact digest verification and before activation.

## Release

Current release: **[pi-shuttle v0.1.0](https://github.com/mfx-labs/pi-shuttle/releases/tag/v0.1.0)**

The public release contains one combined multi-platform inventory:

```text
install.sh
pi-shuttle-0.1.0-linux-x86_64.json
pi-shuttle-0.1.0-macos.json
pi-shuttle-0.1.0.tgz
project-gateway-artifact-core-0.1.0.tgz
project-gateway-macos-core-0.1.0.tgz
pi-guard-0.1.2.tgz
SHA256SUMS
```

Use `SHA256SUMS` to independently verify downloaded release assets.

## Development from source

The public release is the recommended installation path. For development:

```bash
git clone https://github.com/mfx-labs/pi-shuttle.git
cd pi-shuttle
npm ci
npm run build
npm test
```

The repository also contains release-engineering tooling for building from exact, provenance-bound Project Gateway and pi-guard checkouts. Normal users do not need to clone those component repositories themselves.

## Documentation

- [`docs/product-contract.md`](docs/product-contract.md) — product boundaries and composition
- [`docs/platform-support-contract.md`](docs/platform-support-contract.md) — platform support and evidence policy
- [`docs/installation-contract.md`](docs/installation-contract.md) — installer and verification behavior
- [`docs/operator-cli-contract.md`](docs/operator-cli-contract.md) — operator command surface
- [`docs/component-boundaries.md`](docs/component-boundaries.md) — repository ownership boundaries
- [`docs/chatgpt-secure-mcp-tunnel.md`](docs/chatgpt-secure-mcp-tunnel.md) — ChatGPT / Secure MCP Tunnel integration
- [`docs/decisions/`](docs/decisions/) — architecture decision records
- [`docs/reports/`](docs/reports/) — implementation and acceptance evidence

## Component repositories

- [mfx-labs/project-gateway](https://github.com/mfx-labs/project-gateway) — Linux Gateway
- [mfx-labs/project-gateway-macos](https://github.com/mfx-labs/project-gateway-macos) — shared macOS Gateway
- [mfx-labs/pi-guard](https://github.com/mfx-labs/pi-guard) — Pi-side guard

## License

`pi-shuttle` v0.1.0 is currently **UNLICENSED**. See [`package.json`](package.json) for the authoritative package metadata.
