# ADR-003 — Unified macOS User Journey: One Installation and Runtime Path, Architecture-Specific Runtime Targets

**Status:** DECIDED (contract gate `PI-SHUTTLE D0 — UNIFIED MACOS
USER-JOURNEY CONTRACT CORRECTION`; supersedes the two earlier
uncommitted D0 drafts — the lane-scoped acceptance decision and the
target-scoped `--acceptance-target` decision — in full).
**Implementation at decision time:** NOT STARTED (this contract gate made
no implementation change). **Current implementation:** D0B binds both
Darwin targets to the shared dual-architecture Gateway candidate; D0C
made runtime eligibility descriptor-driven; D0D made release
materialization descriptor-driven; D recorded physical Intel acceptance;
E1 support-promotes only macOS x86_64.
**Applies to:** the macOS product path of pi-shuttle.
**Base analysis:** `PI-SHUTTLE D0 — INTEL PLATFORM-GATE ENABLEMENT
ANALYSIS` (pi-shuttle @ `888ed90e113423b02a5a0e881289f10817550b37`).
**Related:** ADR-002 (per-target Gateway distribution; both Darwin
targets bind `mfx-labs/project-gateway-macos` @
`a18bd287c9ccada7fd31932dbe9937062d0b6bc1`); platform-support-contract
§0/§1; PGM-DIST-2 (dual-architecture package candidate);
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

**macOS/x86_64:** the Project Gateway macOS/x64 runtime candidate and
pi-shuttle unified clean-install/end-to-end journey have accepted physical
Intel evidence. The separately human-authorized E1 gate promotes this
target to supported.

**macOS/arm64:** a provenance-complete distributable candidate exists in
the shared dual-architecture package; physical validation evidence is
pending because real Apple Silicon hardware has not yet been available;
compatibility is not known-bad; the target is technically eligible and
NOT support-promoted.

### 5. Distribution prerequisite (arm64; evidence is never an execution gate)

Normal Apple Silicon installation may be blocked ONLY by a concrete
technical prerequisite — such as the absence of a provenance-complete
distributable arm64 runtime artifact. It MUST NOT be blocked merely
because physical acceptance evidence is absent.

Current state (Git publication ≠ artifact release): PGM-DIST-2 produced
the provenance-complete dual-architecture candidate at pinned Git commit
`a18bd287c9ccada7fd31932dbe9937062d0b6bc1`
(`mfx-labs/project-gateway-macos`), and D0B binds both Darwin targets to
it. No npm/GitHub release artifact or pi-shuttle product release follows
from that distribution binding.

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

**Current routing:** the code retains the historical `lane` terminology
for the host target IDs and maps:

```text
darwin-x86_64-posix-utf8-node22 → macOS Gateway fork
                                  (mfx-labs/project-gateway-macos)
darwin-arm64-posix-utf8-node22  → SAME macOS Gateway fork
                                  (mfx-labs/project-gateway-macos)
```

Both targets share one distribution descriptor and user journey while
remaining architecture-specific targets with independent evidence and
support state. Broad terminology renaming is not required.

### 10. Completed migration gate sequence

The D0A read-only analysis classified the existing surfaces into:

1. terminology-only migration (lane → target naming);
2. semantic target-model migration (single macOS lane, two targets);
3. actual behavior change required (e.g. arm64 routing, unified UX);
4. arm64 distribution prerequisite (provenance-complete distributable
   arm64 runtime candidate).

It changed no code. PGM-DIST-2 and D0B/D0C/D0D then implemented the
minimum upstream distribution, target routing, runtime eligibility, and
release-materialization changes.

### 11. Support promotion (separate, human-approved, never automatic)

A target becomes `supported` ONLY after its complete physical acceptance
journey passes on real hardware, evidence is recorded, and a separate
human-approved support-promotion gate changes the manifest, release
policy, and support documentation. Promotion is never automatic; missing
physical evidence is never represented as a failed runtime result. E1 is
that separate human-authorized gate for macOS x86_64 only; arm64 remains
unpromoted.

### 12. Preserved (unchanged by this decision)

- one macOS product lane;
- architecture-specific native variants (x64 and arm64 runtimes;
  Gateway/artifact/native-addon selection stays target-specific — one
  lane does NOT mean one architecture-neutral binary);
- install receipt authority and schema unchanged;
- `artifactSha256` semantics unchanged (B digest stays run evidence
  only);
- the historical D0 decision itself made no support change; E1 later
  promotes only macOS x86_64;
- MAC-5 remains blocked only as a FORMAL PHYSICAL-EVIDENCE gate;
- MAC-6 status unchanged;
- no Apple Silicon physical acceptance claim;
- no Apple Silicon support promotion occurs.

## Consequences

- The macOS product path is defined as one journey with internal
  architecture selection; users never carry experiment/acceptance
  syntax.
- Execution gating is reduced to concrete technical prerequisites
  (provenance-complete distributable runtime), while evidence state and
  support claims remain separate, honest, target-scoped layers.
- This decision defined the macOS path; subsequent D0B/D0C/D0D gates
  implemented it without public architecture or acceptance flags.
- Subsequent D physical evidence and E1 support promotion remain
  target-scoped: x86_64 support implies nothing about arm64 physical
  acceptance or support.
