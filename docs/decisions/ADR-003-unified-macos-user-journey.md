# ADR-003 — Unified macOS User Journey: One Installation and Runtime Path, Architecture-Specific Runtime Targets

**Status:** DECIDED (contract gate `PI-SHUTTLE D0 — UNIFIED MACOS
USER-JOURNEY CONTRACT CORRECTION`; supersedes the two earlier
uncommitted D0 drafts — the lane-scoped acceptance decision and the
target-scoped `--acceptance-target` decision — in full).
**Implementation:** NOT STARTED (no `src/`, `tests/`, `scripts/`,
workflow, or package-file change by this gate). **Implementation
migration:** NOT STARTED (see §9).
**Applies to:** the macOS product path of pi-shuttle (post-v0.1.0).
**Base analysis:** `PI-SHUTTLE D0 — INTEL PLATFORM-GATE ENABLEMENT
ANALYSIS` (pi-shuttle @ `888ed90e113423b02a5a0e881289f10817550b37`).
**Related:** ADR-002 (per-lane Gateway distribution; the x86_64 target
binds `mfx-labs/project-gateway-macos` @
`a90284b06420effb1ec1eeef14e7ed82e02c64e9`); platform-support-contract
§0/§1 (v0.1.0 Linux-only disposition — unchanged by this decision);
PGM-DIST-1 (Intel npm artifact packaging boundary — x64-only);
MAC-5/MAC-6 (Apple Silicon formal physical-evidence gate chain —
unchanged).

## Context

Two uncommitted D0 drafts modeled macOS execution as gated behind
public acceptance flags (`--acceptance-lane`, then
`--acceptance-target`). Both are wrong for the product: a user must
never need experiment/acceptance syntax to install or run macOS builds,
and missing physical evidence must never masquerade as an execution
prohibition. This decision records the correct model: ONE macOS
user-facing installation and runtime journey, architecture-specific
runtime targets selected internally, and a strict separation between
execution gating (concrete technical prerequisites only), physical
evidence state (formal demonstration only), and product support claims
(normative only).

## Decision

### 1. One macOS user journey, one public UX

macOS has ONE user-facing installation and runtime journey. Intel
x86_64 and Apple Silicon arm64 are architecture-specific runtime
targets of the same macOS product path.

For BOTH architectures the intended user journey is identical:

```text
install.sh              — the same one-line installer journey
                          (macOS x86_64 and arm64)
pi-shuttle doctor       — post-install CLI
pi-shuttle start        — post-install CLI
pi-shuttle project ...  — existing post-install CLI commands
```

No public user flags such as `--experimental`, `--experimental-target`,
`--acceptance-lane`, or `--acceptance-target` are part of the intended
macOS installation/use UX. (The earlier uncommitted D0 acceptance-flag
drafts are explicitly superseded.)

### 2. Host selection is internal

Pi Shuttle detects the real host architecture internally:

```text
macOS/x86_64 → selects the x64 runtime variant
macOS/arm64  → selects the arm64 runtime variant
```

The user does not select architecture identity manually.

### 3. Evidence vs. execution (independent concerns)

Physical acceptance evidence MUST NOT, by itself, gate download,
installation, doctor, or start.

Absence of physical evidence means ONLY:

> physical behavior has not yet been formally demonstrated on real
> hardware

It MUST NOT mean: incompatible; failed; prohibited from installation;
prohibited from execution.

### 4. Current evidence states (target-scoped)

**macOS/x86_64:** the Project Gateway macOS/x64 runtime candidate
exists and has accepted physical Intel evidence (fork-side MAC-4
Intel runtime acceptance). pi-shuttle unified macOS
clean-install/end-to-end D acceptance is NOT STARTED; therefore no
pi-shuttle Intel support promotion has occurred.

**macOS/arm64:** implementation/cross-build candidate exists; physical
validation evidence is pending because real Apple Silicon hardware has
not yet been available; compatibility is not known-bad; normal
installation/use is an intended product behavior once the distributable
arm64 runtime candidate is available.

### 5. Distribution prerequisite (arm64; evidence is never an execution gate)

Normal Apple Silicon installation may be blocked ONLY by a concrete
technical prerequisite — such as the absence of a provenance-complete
distributable arm64 runtime artifact. It MUST NOT be blocked merely
because physical acceptance evidence is absent.

Current state (Git publication ≠ artifact release): the pinned Git
commit `a90284b06420effb1ec1eeef14e7ed82e02c64e9`
(`mfx-labs/project-gateway-macos`) IS published on the public Git
remote, and the current provenance-complete macOS Gateway packaging
candidate at that pinned Git commit is **x64-only** (PGM-DIST-1). No
npm package/release artifact was published, and no macOS product
release/support claim follows from Git publication. A separate
distribution gate must make the arm64 candidate provenance-complete and
distributable before unified macOS installation can be implemented.

### 6. Support claims (three distinct concerns)

Evidence may constrain normative support claims, so distinguish:

1. **runtime/distribution availability** — a concrete, provenance-complete
   distributable runtime exists for the target;
2. **physical evidence state** — what has been formally demonstrated on
   real hardware;
3. **product support claim** — the normative claim in the manifest.

Successful installation or experimental real-world use does not
automatically promote support status. Likewise, missing formal evidence
does not automatically prohibit use.

### 7. Known-defect rule

If future real Apple Silicon evidence demonstrates a concrete defect,
that defect is handled explicitly. Only a demonstrated technical
incompatibility or safety/correctness issue may justify an
architecture-specific execution block. Such a block is never created
preemptively from missing evidence alone.

### 8. Acceptance infrastructure is internal

Formal acceptance remains an internal engineering/evidence workflow.
It must not require a different public installation UX. A future Apple
Silicon host can be used to run the same product journey and collect
formal evidence without introducing another macOS product lane.

### 9. Current implementation state and terminology

**Implementation baseline (A/B/C — locally baselined, committed at
`888ed90e113423b02a5a0e881289f10817550b37`):** the codebase already
provides host-target-aware Gateway identity (the per-lane descriptor
map), artifact preparation (`prepare-fixtures.sh --lane`), installer,
doctor/help, release-envelope, handshake (`GATEWAY_LANE`), and CI
wiring — all locally baselined through the A/B/C gates.

**Current routing (implementation state, not a final architecture
decision):** the current code still uses the historical `lane`
terminology for the host target IDs and maps:

```text
darwin-x86_64-posix-utf8-node22 → macOS Gateway fork
                                  (mfx-labs/project-gateway-macos)
darwin-arm64-posix-utf8-node22  → historical Gateway
                                  (mfx-labs/project-gateway)
```

This temporary arm64 routing is CURRENT IMPLEMENTATION STATE, not a
permanent architecture decision, and it is not the desired final macOS
product model. This contract supersedes that terminology semantically
and defines the intended unified macOS UX, but it does NOT claim the
implementation has already migrated.

**Semantic migration:** NOT STARTED. A separate READ-ONLY migration
impact analysis is required before implementation (see Next gate).

### 10. Next engineering gate (read-only, required before implementation)

The next engineering gate is a READ-ONLY migration impact analysis. It
must classify the existing A/B/C surfaces into:

1. terminology-only migration (lane → target naming);
2. semantic target-model migration (single macOS lane, two targets);
3. actual behavior change required (e.g. arm64 routing, unified UX);
4. arm64 distribution prerequisite (provenance-complete distributable
   arm64 runtime candidate).

It changes no code.

### 11. Support promotion (separate, human-approved, never automatic)

A target becomes `supported` ONLY after its complete physical acceptance
journey passes on real hardware, evidence is recorded, and a separate
human-approved support-promotion gate changes the manifest, release
policy, and support documentation. Promotion is never automatic; missing
physical evidence is never represented as a failed runtime result.

### 12. Preserved (unchanged by this decision)

- one macOS product lane;
- architecture-specific native variants (x64 and arm64 runtimes;
  Gateway/artifact/native-addon selection stays target-specific — one
  lane does NOT mean one architecture-neutral binary);
- install receipt authority and schema unchanged;
- `artifactSha256` semantics unchanged (B digest stays run evidence
  only);
- v0.1.0 historical Linux-only disposition unchanged;
- MAC-5 remains blocked only as a FORMAL PHYSICAL-EVIDENCE gate;
- MAC-6 status unchanged;
- no Apple Silicon physical acceptance claim;
- no support promotion occurs in this decision.

## Consequences

- The macOS product path is defined as one journey with internal
  architecture selection; users never carry experiment/acceptance
  syntax.
- Execution gating is reduced to concrete technical prerequisites
  (provenance-complete distributable runtime), while evidence state and
  support claims remain separate, honest, target-scoped layers.
- The v0.1.0 Linux-only support disposition is unchanged; this decision
  defines the macOS path design and changes no v0.1.0 refusal behavior.
- Implementation surface (NOT started): the migration impact analysis
  (§10), then internal architecture selection, removal of any
  evidence-driven execution gate, unified install/doctor/start UX, and
  the arm64 distribution gate (separate gate, not this decision).
