# Component Boundaries

## 1. Repositories and pinned states (inspected read-only, this gate)

| Repository | Path | Pinned state | Notes |
|---|---|---|---|
| Project Gateway MCP (dev) | `/home/chef/Documents/Project_Gateway_MCP` | HEAD `0720476b240f74372c7f1d0d1a78290b19537801` (closure); parent `e2131dcb55be97442158687fceed250d8ff54180` (regression candidate); diff = WP-15 closure report only | No remote (local-only). Untracked WP-13D debris present; **not touched** |
| Project Gateway MCP (clean reference) | `/home/chef/Documents/Project_Gateway_MCP_v0.1.0_clean` | same HEAD `0720476b...` | Untracked pilot artifact `project-gateway-artifact-core-0.1.0.tgz` (package pilot evidence) |
| pi-guard (mfx-labs) | `/home/chef/Documents/plan_spec_guard` | HEAD `7a7580cc4cbd7926797564c72269394fc29a860a` = tag `v0.1.2` | origin `https://github.com/mfx-labs/pi-guard.git`; package `pi-guard` v0.1.2, private, MIT; extension entry `extensions/pi-guard/index.ts`; untracked review/release docs present |
| pi-shuttle (new) | `/home/chef/Documents/pi-shuttle` | this gate only (docs; local git init, **no commit**) | product/distribution layer |

## 2. Ownership split

### pi-shuttle owns
- end-user installer (`install.sh` + pinned artifacts);
- operator CLI (`pi-shuttle`: doctor/project/start; config/state layout;
  runtime-config persistence; subprocess composition of the Gateway CLI);
- compatibility manifest and its verification;
- onboarding docs (ChatGPT Secure MCP Tunnel getting-started);
- CI/release orchestration (workflow files designed locally; nothing pushed);
- project registry (registered projects → derived runtime config documents).

### Project Gateway MCP owns (unchanged semantics)
- the nine-tool stdio MCP runtime, the trusted storage engine,
  `initializeTrustedStore()`, the WP-6 validator, identity derivation,
  capability/provenance brands, static guards, host-lane contract;
- its own package version (`0.1.0`, `private: true`, UNLICENSED — unchanged
  by this gate);
- **two minimum changes** (see §4) required for pi-shuttle v0.1.0.

### pi-guard owns (unchanged)
- modes, profiles, `git_inspect`, trusted projection API, compatibility
  fingerprint, its own versioning. **No source change required.**

## 3. Confirmed existing surfaces (evidence, closure tree)

- **Gateway CLI:** `project-gateway-mcp --config <file>` only; `--help`;
  stdio MCP; stdout protocol-only; bounded stderr diagnostics; nonzero exit
  on startup failure (`src/runtime/mcp/cli.ts`).
- **Nine-tool surface** (pinned in `tests/runtime/server.test.ts`,
  `tests/runtime/static-guard.test.ts`, `tests/runtime/stdio.test.ts`):
  `validate-artifact`, `inspect-stored-record`, `inspect-registry`,
  `inspect-audit-history`, `verify-record`, `enumerate-class`,
  `draft-artifact`, `persist-artifact`, `inspect-changes`. No
  approve/issue/activate/execute/receipt tool exists.
- **Startup config** (`src/runtime/mcp/config.ts`): closed JSON document,
  `surfaces[]` with `surfaceId/locator/serviceUid/forbiddenRoots/
  configurationIdentity/configurationVersion/limitProfile/workspaces/
  gitPath/gitHome/gitTmpdir`; 1 MiB ceiling; duplicate-key rejection;
  closed-field rejection; `configurationIdentity` REQUIRED today
  (`sha-256:<64-hex>`).
- **Composition root** (`src/runtime/mcp/compose.ts`): already imports the
  genuine provenance/input creators; builds `TrustedStorageBootstrapInput`
  per surface; `verifyStoreInstance` + generation seeding (disposed
  capability); NEVER calls `initializeTrustedStore`; `DEFAULT_GIT_PATH =
  '/usr/bin/git'` (operator-overridable via `gitPath`).
- **Storage init orchestrator** (`src/storage/initialization/initialize.ts`):
  complete, capability-gated at every mutation boundary, idempotent replay
  (state `INITIALIZED` → verification-only), fails closed on
  PARTIAL/UNSUPPORTED_VERSION/INTEGRITY/FOREIGN; requires genuine branded
  provenance; test-only producers in tests today.
- **Static guard** (`tests/unit/storage/static-guard.test.ts`):
  `createStorageBootstrapActionProvenance` consumer = exactly
  `src/runtime/mcp/compose.ts`; declared future consumer
  `src/control-plane/storage-bootstrap-action.ts` (does not exist);
  per-module fs allowlists; brand-module restrictions.
- **Identity derivation:** `computeTrustedConfigurationIdentity` (WP-6,
  `src/trusted/identity.ts`) — canonical projection + RFC 8785 JCS +
  SHA-256, domain prefix `PGAP-TRUSTED-CONFIG-v1\0`; used by the Phase-1
  validator (`src/trusted/validate.ts:744`) and correlated by the persist
  lane (`src/adapters/mcp/persist.ts:381` expects the store metadata
  configuration identity to equal the **validated** configuration's
  identity) → the bootstrap identity MUST be the validator-derived one, not
  an arbitrary operator string.
- **Lanes** (`src/runtime/mcp/lanes.ts`): WP-6 Phase-1 validation with real
  resolvers (canonical root via `realpathSync`, artifact-location resolver),
  controlled Git lane requiring EMPTY operator-owned `gitHome`/`gitTmpdir`
  outside every workspace root.
- **Provisioning** (`src/storage/initialization/provision.ts`):
  initialization creates ONLY `metadata/` + `tmp/` per namespace;
  `records/`, `audit/`, `locks/` are lazily phase-3-provisioned; `index/`,
  `quarantine/` are contract-reserved, presence fails closed. Directly
  relevant to PILOT-WP15-001 (runbook §4 overstates the layout: "Each
  namespace contains metadata/, records/, index/, audit/, tmp/, locks/,
  quarantine/").
- **Host lane:** `TRUSTED_HOST_LANE = 'linux-x86_64-posix-utf8-node22'`
  plus `DARWIN_ARM64_HOST_LANE = 'darwin-arm64-posix-utf8-node22'`
  (PS-6, ADR-042) and `DARWIN_X86_64_HOST_LANE =
  'darwin-x86_64-posix-utf8-node22'` (PS-6I, ADR-043)
  (`src/trusted/host-lane.ts`) — a closed accepted-lane set enforced by the
  validator and containment checks; everything else (Windows,
  case-insensitive filesystems are addressed by ADR-042/043) fails closed.
  **First-class macOS arm64 and Intel support are Gateway host-lane
  changes (PS-6/PS-6I), not just CI.**
- **Pi lane:** `SUPPORTED_PI_LANE = 'pi-0.83.0-extension-api-v1'`
  (`src/adapters/pi/types.ts`). Pi 0.84.1 on the current host is NOT
  release evidence (runbook §1/§8; P3A-WP15-006 open).
- **pi-guard v0.1.2** (`plan_spec_guard`): modes OFF/INSPECT/EDIT/WRITE +
  `PROJECTED` (trusted-API-only); `/guard` command surface; `.pi/
  pi-plan-spec-guard.json` trusted-project config; `git_inspect` read-only;
  Bash blocked in active modes; trusted projection API
  `applyTrustedProjection`/`inspectActiveProjection`/`restoreTrustedProjection`
  (ADR-037); compatibility predicate items 1–17 in the Gateway design doc
  `docs/design/pi-guard-compatibility-and-authority-projection.md`.
- **Tunnel/ChatGPT:** WP-14B onboarding doc defines the external-tunnel
  launch (`--mcp.command "project-gateway-mcp --config ..."`), ChatGPT
  connector registration, nine-tool discovery, credential placement (never
  in Gateway config), no tunnel/auth code in Gateway.

## 4. Minimum Gateway changes required (both deferred to implementation gates)

### 4.1 PS-1 — operator-only `bootstrap` verb (release-blocking)
New operator-only CLI verb in the Gateway package:

```
project-gateway-mcp bootstrap --config <file> [--output <resolved-config.json>]
```

- Same closed `--config` document and loader (`loadRuntimeConfig`); per
  surface `configurationIdentity` becomes optional at load; `bootstrap`
  requires it absent-or-exact-match, `start` requires it present (clear
  fail-closed error otherwise).
- For each surface: validate the trusted configuration through the committed
  WP-6 Phase-1 validator with real resolvers (same pattern as
  `buildWorkspaceLanes`); derive `configurationIdentity` via
  `computeTrustedConfigurationIdentity`; mint the genuine
  `StorageBootstrapActionProvenance`; call `initializeTrustedStore()`
  (capability-gated, replay-safe); emit the resolved surface
  (`surfaceId`, `locator`, `configurationIdentity`, `configurationVersion`,
  canonical workspaces, namespace identities, metadata digests, state) to
  the `--output` file (0600) and bounded diagnostics to stderr; stdout stays
  protocol-free; exit 0 only on `INITIALIZED` (provisioned or replayed),
  nonzero fail-closed on PARTIAL/UNSUPPORTED_VERSION/FOREIGN/mismatch.
- Implementation sits in `src/control-plane/storage-bootstrap-action.ts`
  (the pre-declared consumer) with a thin CLI branch; static-guard edges
  updated (creator edge for `createStorageBootstrapActionProvenance` +
  initialization import edge); no MCP surface change; no authority
  semantics change.
- Gateway-side documentation: new Gateway ADR-041 (bootstrap surface),
  runbook §2/§4 updates including the **PILOT-WP15-001** correction
  (initialization creates only `metadata/` + `tmp/`; `records/`, `audit/`,
  `locks/` lazy; `index/`, `quarantine/` reserved-not-created).

**Rejected alternatives:** (a) `initializeIfAbsent` auto-init at `start` —
rejected: makes the read-mostly runtime mutate storage, weakening the
explicit control-plane action posture (SRX-012 / runbook §2.5 "the runtime
reads stores initialized elsewhere"); (b) pi-shuttle-side reimplementation —
forbidden (duplication + unreachable private brands + package exports
exclude it); (c) MCP tool — forbidden; (d) instructing users to import
private modules — forbidden.

### 4.2 PS-6/PS-6I — host-lane parameterization (macOS first-class support)
`TRUSTED_HOST_LANE` is the closed accepted-lane set
(`linux-x86_64-posix-utf8-node22` + `darwin-arm64-posix-utf8-node22`
[ADR-042] + `darwin-x86_64-posix-utf8-node22` [ADR-043]), with the lane
selected as an explicit trusted operand, plus macOS evidence gates (see
platform-support-contract). Host lane participates in configuration
identity → stores are lane-bound; cross-lane replay (including between
darwin-arm64 and darwin-Intel) fails closed; stores are machine-local and
never migrated. These are Gateway-component lane mechanics (historical
PS-6/PS-6I evidence), not pi-shuttle distribution claims: a future
pi-shuttle Intel distribution is contracted (ADR-002) to consume the
accepted macOS Gateway fork (`mfx-labs/project-gateway-macos`) — NOT
implemented, not a support claim; darwin-arm64 selection is unchanged.

## 5. pi-guard: no source change required

pi-guard v0.1.2 is the verified lane (ADR-037 predicate items 12–17;
tag == HEAD). pi-shuttle detects/installs/verifies it against the
compatibility predicate; no pi-guard source modification, no pi-guard
publication. If a future pi-guard version is needed, it requires a reviewed
compatibility record first — not an automatic adoption.

## 6. Explicit non-owned surfaces

pi-shuttle does not own: tunnel/auth credentials (external tunnel only),
OpenAI/ChatGPT server-side state, Pi's package store mechanics (read-only
discovery), the Gateway's private composition internals (reachable only
through the `bootstrap` verb and the installed `--config` contract), pi-guard
internals.
