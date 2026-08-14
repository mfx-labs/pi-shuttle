# pi-shuttle

pi-shuttle is the local operator layer that composes **Project Gateway**
and **pi-guard** into one product, so you can let AI clients work with
your coding projects through small, deliberate, bounded interfaces —
instead of handing them a shell, a filesystem, or your Git push access.

It is built around one idea: useful project access should not require
dangerous access. pi-shuttle registers the projects you choose, installs
and verifies the components that serve them, checks that your
environment is healthy, and starts the gateway that AI clients talk to.
All of that happens on your machine, under your control.

The design deliberately does **not** expose:

- **arbitrary shell execution** — there is no generic shell/exec surface;
- **unrestricted filesystem access** — access is scoped to registered
  projects through containment rules;
- **Git mutation / push authority** — Git interaction is read-only
  inspection, never push or rewrite;
- **AI self-approval / self-issued authority** — the system has no
  approve/issue/activate surface for an AI client to grant itself power.

## Status

**Pre-release and under active development.** There is no stable
production release yet, no published one-line installer URL, and no
package-manager distribution. The installer and CLI work today from a
developer checkout with locally built, digest-verified component
artifacts.

Currently validated supported platforms: **Linux x86_64**, **macOS arm64
(Apple Silicon)**, and **macOS Intel (x86_64)**. Windows and anything else
are unsupported (the installer refuses). See [Supported
platforms](#supported-platforms) for the full matrix and requirements.

Runtime requirements: **Node >= 22.19.0**, **Git >= 2.30.0**, and
**Pi 0.83.0+** (0.83.0 is the known-good baseline; newer Pi versions are
accepted only when the committed pi-guard compatibility probe passes).

## Quick start

The current installation path is developer/pre-release: build pi-shuttle
from source, then install the composed product with locally built
component artifacts.

```bash
git clone https://github.com/mfx-labs/pi-shuttle.git
cd pi-shuttle
npm ci
npm run build
```

The installer (`./install.sh`) installs Project Gateway and pi-guard from
SHA-256-verified local artifacts. Until release artifacts are published,
build them from the exact pinned component checkouts with the committed
fixture helper:

```bash
bash scripts/prepare-fixtures.sh \
  --gateway-checkout <path-to-project-gateway-checkout> \
  --pi-guard-checkout <path-to-pi-guard-checkout> \
  --out <artifact-dir>
```

Then run the installer in batch mode (interactive mode prompts for the
same choices):

```bash
./install.sh --batch --gateway yes --pi-guard yes --artifact-dir <artifact-dir>
```

This installs the `pi-shuttle` command into `~/.local/bin`, verifies
every component, and writes an installation receipt. From there:

```bash
pi-shuttle doctor               # health check: platform, Node, Git, Pi,
                                # components, config, registered projects
pi-shuttle project add <path>   # register a coding project
pi-shuttle project list         # show registered projects
pi-shuttle start                # start the Project Gateway MCP server
```

`pi-shuttle project add <path>` registers a Git repository you choose;
re-adding the same path is a safe no-op replay. `pi-shuttle start` keeps
stdout as pure MCP protocol for the AI client. See
[`docs/installation-contract.md`](docs/installation-contract.md) and
[`docs/operator-cli-contract.md`](docs/operator-cli-contract.md) for the
full contract.

## What is pi-shuttle?

Three components work together:

- **pi-shuttle** — the end-user layer: installation, project
  registration, health checks (`doctor`), and startup (`start`);
- **Project Gateway** — the bounded MCP/project-access component: a
  read-and-inspect MCP server that serves exactly nine tools for
  registered projects (validate, inspect, verify, enumerate, draft,
  persist, change tracking) — no shell, no push, no approval surface;
- **pi-guard** — the Pi-side enforcement component that makes the same
  boundaries real inside the Pi environment.

```text
User / AI client
       |
       v
Project Gateway
       |
   registered project

pi-shuttle
  ├─ installs / verifies Gateway
  ├─ installs / verifies pi-guard
  ├─ project management
  ├─ doctor
  └─ start

Pi
 └─ pi-guard
```

Project Gateway and pi-guard are separate, independently versioned
repositories (mfx-labs/project-gateway, mfx-labs/pi-guard); pi-shuttle
pins exact versions of both and verifies their digests at install time,
so what you run is exactly what was reviewed.

## Security boundaries

- **Bounded tool surface.** The Gateway exposes exactly nine public MCP
  tools for inspection, validation, and controlled artifact
  drafting/persistence. There is no generic shell/exec tool and no
  approve/issue/grant surface — an AI client cannot invoke arbitrary
  commands and cannot issue itself authority.
- **Workspace confinement.** Access resolves against registered
  projects only; containment rules keep reads inside the workspace.
- **Read-only Git.** Git interaction is read-only inspection
  (ownership, mode, and fingerprint checks included) — never push,
  rebase, or rewrite.
- **Digest-verified installation.** Components are installed from
  artifacts verified against pinned SHA-256 digests; the installer
  refuses unknown or mismatched artifacts.
- **Per-user, operator-owned state.** Installation is per-user under
  `~/.local`, never root; stores and configuration are created with
  owner-only permissions; `doctor` never mutates state.
- **Fail-closed health.** `pi-shuttle doctor` reports unsupported
  platforms, missing components, and failed compatibility probes as
  failures (exit 2 / exit 1), never as silent success.

## Supported platforms

| Platform | Architecture | Requirement |
|---|---|---|
| Linux | x86_64 | Node >= 22.19.0, Git >= 2.30.0, Pi 0.83.0+ |
| macOS | arm64 (Apple Silicon) | same, plus native arm64 Node |
| macOS | Intel (x86_64) | same (native x64 Node) |
| Windows | — | not supported |

Runtime versions are minimums, not exact pins: the validated CI
baselines (Node 22.23.2, Git 2.45.4, Pi 0.83.0) are evidence, not
requirements. Validated macOS evidence points so far: macOS 12.7.6 on an
Intel MacBook Pro, and the macOS 15 runners used by CI — evidence
points, not a universal minimum macOS version.

## Documentation

- [`docs/product-contract.md`](docs/product-contract.md) — what the
  product is and is not, composition and authority separation
- [`docs/installation-contract.md`](docs/installation-contract.md) —
  installer behavior, version pinning, preflight refusals
- [`docs/operator-cli-contract.md`](docs/operator-cli-contract.md) —
  the exact `pi-shuttle` command surface and `doctor` status vocabulary
- [`docs/platform-support-contract.md`](docs/platform-support-contract.md) —
  the platform support matrix and its evidence
- [`docs/component-boundaries.md`](docs/component-boundaries.md) — what
  each repository owns
- [`docs/chatgpt-secure-mcp-tunnel.md`](docs/chatgpt-secure-mcp-tunnel.md) —
  ChatGPT integration: Secure MCP Tunnel onboarding (Business/
  Enterprise/Edu workspace + developer mode + custom MCP app)
- [`docs/decisions/`](docs/decisions/) — architecture decision records
- [`docs/reports/`](docs/reports/) — gate implementation and evidence
  reports

## License

UNLICENSED, pre-release, unpublished. See `package.json` for the current
package state.
