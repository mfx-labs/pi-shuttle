# ADR-001 — Operator-Only Bootstrap Authority and Product Boundary

**Status:** Proposed (gate PS-0). **Applies to:** pi-shuttle v0.1.0.
**Related:** Gateway ADR-028 (bootstrap locator), ADR-037 (pi-guard trusted
projection), ADR-040 (zero-transfer product boundary); Gateway runbook §2.5
(SRX-012: store initialization is an explicit control-plane-authorized
action); WP-8-C (`initializeTrustedStore`).

## Context

The fresh-install blocker: Gateway storage initialization is complete,
tested, and replay-safe, but production-unreachable — the genuine
`StorageBootstrapActionProvenance` has no production consumer, and the
runtime composition root deliberately re-verifies stores without ever
initializing them. pi-shuttle must give end users a working install without
exposing initialization authority to any non-operator path.

## Decision

1. **Initialization reachability = exactly one operator-only CLI verb**
   (`project-gateway-mcp bootstrap`) in the Gateway package, implemented by
   the pre-declared `src/control-plane/storage-bootstrap-action.ts`
   consumer, reusing `initializeTrustedStore()` unchanged. pi-shuttle
   invokes it as a pinned subprocess from `pi-shuttle project add`; it is
   never an MCP tool, never model-callable, never ChatGPT-accessible, never
   a generic lifecycle write authority.
2. **pi-shuttle contains no storage engine and no identity computation**:
   configuration identity is derived by the Gateway's WP-6 canonical
   computation inside the bootstrap verb; pi-shuttle derives only
   workspaceId/storeId (path-derived opaque identifiers) and persists what
   the verb resolves.
3. **`start` never initializes.** Initialization happens only under an
   explicit operator invocation; the runtime keeps reading stores
   initialized elsewhere (SRX-012 posture preserved).
4. **Component separation is preserved**: Gateway and pi-guard remain
   separately versioned repositories; pi-shuttle composes pinned artifacts.
   No history merge; no source duplication; no second engine.

## Consequences

- The minimum Gateway change is a closed operator surface plus static-guard
  edges plus documentation; no MCP surface change, no authority-semantics
  change, no package version change.
- pi-guard requires no source change (v0.1.2 verified lane).
- Store replay semantics give idempotence for free: re-runs and re-adds
  after remove verification-replay instead of rewriting.
- Fail-closed behavior is preserved everywhere: partial/foreign/
  unsupported-version stores are never repaired by bootstrap, `start`, or
  pi-shuttle; only the replay-verified INITIALIZED path succeeds.

## Alternatives considered

- **Start-time `initializeIfAbsent` flag** — rejected: makes the read-mostly
  runtime mutate storage on start, weakening the explicit-action posture and
  risking initialization at a misconfigured locator.
- **pi-shuttle-side initialization** — rejected: duplicates Gateway storage
  logic and cannot reach the private provenance brands (package exports
  exclude them; importing private internals is forbidden).
- **Exposing through MCP** — forbidden (approval/issuance/activation
  authority must never reach ChatGPT/model).
