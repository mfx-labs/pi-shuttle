# ADR-002 — Per-Lane Gateway Distribution: macOS Intel via the Accepted macOS Fork

**Status:** DECIDED (contract gate `PI-SHUTTLE macOS INTEL DISTRIBUTION
CONTRACT DECISION`). **Implementation:** NOT STARTED (decomposition A/B/C/D
not begun; no installer, manifest, CI, or test code changed by this gate).
**Applies to:** pi-shuttle distribution model (post-v0.1.0 Intel lane).
**Base analysis:** `PI-SHUTTLE macOS INTEL GATEWAY DISTRIBUTION — INTEGRATION
ANALYSIS` (pi-shuttle @ `b178169…` authoritative remote master).
**Related:** ADR-001 (bootstrap authority); Gateway ADR-042 (darwin-arm64
lane), ADR-043 (darwin-x86_64 lane); macOS fork `mfx-labs/project-gateway-macos`
product contract (MAC-0) and work packages MAC-0…MAC-7; PGM-DIST-1
(`docs/decisions/PGM-DIST-1-intel-npm-artifact-packaging-boundary.md`);
PS8B-DEFECT-001 (historical Gateway Darwin controlled-write limitation).

## Context

pi-shuttle currently pins ONE global Gateway artifact identity
(`src/compat/manifest.ts`: package `@project-gateway/artifact-core`,
commit `55f764290a4567a20557f1db19d2a6fb97572a97`,
`mfx-labs/project-gateway`, bin `project-gateway-mcp`). The accepted macOS
Gateway fork (`mfx-labs/project-gateway-macos`, Intel baseline
`def4cef9a33ac5ced655d18c7a56ba2d8031a311`) is a separate product line:
package `@project-gateway/macos-core`, bin `project-gateway-macos-mcp`,
darwin-only current-host acceptance (Linux fails closed, exit 2), and a
Darwin native six-export controlled-write seam. Intel macOS end-user
installation through pi-shuttle must consume the fork instead of the
historical Gateway coupling, while Linux and darwin-arm64 keep the
historical coupling. A single global identity cannot express that.

## Decision

### 1. Per-lane Gateway descriptor (fail-closed)

The single global Gateway artifact identity in `CompatibilityManifest` is
REPLACED by a fail-closed per-host-lane Gateway descriptor map. Finalized
descriptor shape (exact field names):

```json
{
  "repository": "mfx-labs/project-gateway",
  "commit": "55f764290a4567a20557f1db19d2a6fb97572a97",
  "version": "0.1.0",
  "packageName": "@project-gateway/artifact-core",
  "artifactFileName": "project-gateway-artifact-core-0.1.0.tgz",
  "artifactSha256": null,
  "binName": "project-gateway-mcp",
  "dependencies": {
    "@modelcontextprotocol/server": "2.0.0",
    "ajv": "8.20.0",
    "zod": "4.4.3"
  }
}
```

Every lane descriptor MUST carry all eight fields: `repository`, `commit`,
`version`, `packageName`, `artifactFileName`, `artifactSha256`, `binName`,
`dependencies`. `artifactSha256` is `null` until computed at release
(existing truthful-deferral discipline, product-contract §6).

**Fail-closed semantics:** a host lane absent from the descriptor map, or
a descriptor with any missing field, is refused — the installer never
invents an identity and never falls back to another lane's descriptor.
At artifact time, a digest/identity/bin-name mismatch against the selected
lane descriptor refuses the artifact (existing ERR-PS3 vocabulary).

### 2. Preserved mappings (unchanged by this decision)

- `linux-x86_64-posix-utf8-node22` → historical `mfx-labs/project-gateway`
  (commit `55f764290a4567a20557f1db19d2a6fb97572a97`, package
  `@project-gateway/artifact-core`, bin `project-gateway-mcp`). Linux
  behavior, evidence, and CI (Lane A) are NOT changed.
- `darwin-arm64-posix-utf8-node22` → historical `mfx-labs/project-gateway`
  (same descriptor values). darwin-arm64 artifact selection is NOT
  changed; the macOS fork is NOT selected for arm64.

### 3. Intel binding (contracted)

- `darwin-x86_64-posix-utf8-node22` →
  - repository `mfx-labs/project-gateway-macos`
  - commit `def4cef9a33ac5ced655d18c7a56ba2d8031a311` (accepted Intel
    baseline; MAC-4 physically accepted, human-signed off)
  - version `0.1.0`
  - package `@project-gateway/macos-core`
  - artifact filename `project-gateway-macos-core-0.1.0.tgz`
  - bin `project-gateway-macos-mcp`
  - dependencies: the same three exact pins as the historical descriptor.

### 4. Descriptor completeness

Missing or mismatched lane identity (repository, commit, version, package
name, artifact filename, SHA-256, bin name, dependency pins) fails closed
— at selection time, at artifact verification time, and at doctor
reconciliation time. No silent substitution between lanes, in either
direction: Linux/arm64 never receive the fork artifact; Intel never
receives the historical artifact (each direction is fail-closed by the
artifact's own lane semantics as well).

### 5. Public CLI grammar unchanged

The closed `pi-shuttle` CLI grammar (doctor / project add|list|remove /
start / --help / --version) and the installer argument grammar
(`--gateway`, `--artifact-dir`, `--expect-gateway-sha256`, …) remain
unchanged. Installer selection, doctor identity checks, help/version
reporting, fixture preparation, CI pins, and the MCP handshake probe
consume the SELECTED LANE DESCRIPTOR instead of the historical Gateway
globals. No new flags, no new verbs.

### 6. Fork-side prerequisite (separate record)

`PGM-DIST-1 — Intel npm artifact packaging boundary` is recorded as a
separate fork-side prerequisite
(`docs/decisions/PGM-DIST-1-intel-npm-artifact-packaging-boundary.md`).
Distribution-only; independent of MAC-5/MAC-6/MAC-7; may package ONLY the
already accepted Intel runtime boundary.

### 7. macOS fork gates unchanged

- MAC-5 (Apple Silicon) remains `BLOCKED ON REAL APPLE SILICON HARDWARE`.
- MAC-6 remains blocked on MAC-5.
- This decision does NOT reopen, weaken, or reorder either gate, and
  claims NO Apple Silicon acceptance. The fork's
  `native/darwin-arm64/gateway_fs.node` cross-build candidate remains
  preparation-only, never production evidence.

### 8. Documentation requalification

Documentation that presents macOS Intel as a complete distribution is
requalified until the fork artifact passes clean-install acceptance:
current support claims stay Linux-only (v0.1.0 disposition unchanged);
the Intel lane is contracted-for-fork-distribution only, NOT a support
claim, and implementation remains not started.

## Consequences

- Contract docs updated in this gate: `product-contract.md` §6.1,
  `platform-support-contract.md` §0/§1, `installation-contract.md` §4,
  `operator-cli-contract.md` §2 check 6, `component-boundaries.md` §4.2,
  `README.md` platforms section.
- Implementation work (analysis decomposition A: manifest/component
  identity, B: artifact preparation + verification, C:
  installer/doctor/start wiring, D: physical clean-install acceptance)
  is NOT started here. Each begins only under its own authorized gate.
- Linux and darwin-arm64 artifact selection, pins, and evidence are
  byte-preserved by this decision.
- The fork packaging boundary (PGM-DIST-1) is a prerequisite for any
  Intel artifact consumption; without it no runnable Intel artifact
  exists (the current fork `files` field excludes the native seam).
