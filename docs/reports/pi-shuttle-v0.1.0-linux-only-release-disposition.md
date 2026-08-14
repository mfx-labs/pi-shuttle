# pi-shuttle v0.1.0 — Linux-Only Release Support Disposition

**Date:** 2026-08-14
**Gate:** `V0.1.0 — LINUX-ONLY RELEASE SUPPORT DISPOSITION`
**Starting baseline:** `bc41338b4158d2499195581d43e5c45c8c298e4a`
**Normative defect evidence:**
`docs/reports/pi-shuttle-ps-8b-final-release-readiness.md` (PS8B-DEFECT-001);
Gateway escalation: `darwin-controlled-write-correction-implementation.md`
(Gateway repo, uncommitted).
**Final classification:** `V0.1.0 LINUX-ONLY SUPPORT — LOCALLY BASELINED`
(one local commit created; no push/tag/release/upload/publication).

---

## 1. Human support decision and reason

pi-shuttle v0.1.0 supports **Linux x86_64 only**. macOS support is
deferred beyond v0.1.0 because the v0.1.0 Gateway candidate's controlled
write boundary is Linux-only (`/proc/self/fd` descriptor anchoring —
PS8B-DEFECT-001): macOS persistence fails, Node cannot express the
existing descriptor contract through its public filesystem surface, and a
contract-preserving native primitive is a material distribution decision
that remains open (Gateway escalation report). Shipping macOS as
"supported" while `persist-artifact` cannot complete would be a false
support claim.

## 2. PS8B-DEFECT-001 disposition

Not fixed; not softened; classified:

`DEFERRED OUTSIDE THE V0.1.0 SUPPORTED PLATFORM SET`

- current Gateway persist-artifact is Linux-only — preserved fact;
- macOS persistence fails — preserved fact;
- Node cannot implement the existing descriptor contract through its
  public filesystem surface — preserved fact;
- native Darwin support is deferred — preserved fact;
- the Gateway escalation report is untouched.

## 3. Exact supported platform set (v0.1.0)

**Supported:** Linux x86_64 (lane `linux-x86_64-posix-utf8-node22`).
**Refused/unsupported:** macOS arm64, macOS x86_64 (with an explicit
"macOS is not supported in v0.1.0" refusal), Windows, all others.

## 4. Exact component pins (unchanged)

- Gateway: `55f764290a4567a20557f1db19d2a6fb97572a97` (no correction
  required for the Linux-only candidate);
- pi-guard: `7a7580cc4cbd7926797564c72269394fc29a860a` @ `v0.1.2`.
- No Gateway source change; no pi-guard source change; no authority or
  tool-surface change; no security-invariant weakening.

## 5. Changed paths

Product code:
- `src/compat/manifest.ts` — `supportedLanes` = Linux only; darwin
  lanes moved to `gatedLanes` (constants retained); decision comment.
- `src/installer/preflight.ts` — darwin-specific refusal message
  ("macOS … is not supported in v0.1.0 …").
- `src/command/doctor.ts` — truthful header + retained-deferred comments
  (platform verdict is manifest-bound and now reports darwin
  unsupported, exit 2).

Tests:
- `tests/helpers/platform-linux.cjs` — NEW test-only preload (redefines
  process.platform/arch for child-process fixtures; never referenced by
  product code).
- `tests/helpers/installer-fixtures.ts` + `lifecycle-fixtures.ts` — child
  spawns carry the test-only preload.
- `tests/unit/installer-preflight.test.ts` — linux accepted; darwin
  arm64/x64 refused (message asserted); win32 refused; manifest
  Linux-only + gated darwin lanes.
- `tests/unit/manifest.test.ts` — lane-claim test updated.
- `tests/unit/doctor.test.ts` — darwin platform verdicts flipped to
  unsupported/fail-closed; retained darwin node-arch checks annotated as
  deferred-lane behavior.
- `tests/unit/installer-flow.test.ts` — interactive child spawns carry
  the preload.
- `tests/unit/release-core-install.test.ts` — fixtures use the linux
  lane.
- `tests/unit/release-envelope.test.ts` — lane-set equality test now
  asserts the Linux-only manifest (darwin additions refused).

Documentation:
- `README.md` — "v0.1.0 currently supports Linux x86_64 only. macOS
  support is deferred while the controlled-write boundary is being made
  portable without weakening its security guarantees."
- `docs/platform-support-contract.md` — §0 disposition + §1 matrix
  (macOS rows deferred); §3 macOS risks marked historical.
- `docs/installation-contract.md` — preflight/refusal boundaries and
  runtime requirements updated.
- `docs/product-contract.md` — §9 first-class target = Linux only.
- `docs/operator-cli-contract.md` — doctor platform row updated.
- `docs/test-and-release-plan.md` — Lanes B/C/D marked deferred;
  PS-6 gate historical; PS-8 prerequisite = Lane A (Linux) only.
- `docs/work-packages.md` — PS-6 deferred; PS-8 objective/acceptance
  Linux-only.

Historical evidence (PS-8B report, PS-6/PS-6I reports, ADR-042/043,
Gateway escalation report) is preserved unmodified.

## 6. Focused tests (this gate)

- installer-preflight, manifest, doctor, installer-flow,
  installer-quarantine, installer-archive: 94 pass / 0 fail.
- release-envelope, release-acquire, release-bootstrap,
  release-shell-input, release-builder-identity, release-core-install,
  static-guard, lifecycle, ci-workflow-security: 108 pass / 0 fail /
  1 conditional skip.
- `git diff --check` clean.
- Direct darwin checks: local lane and release-shaped install both
  refuse with the exact v0.1.0 macOS message before any component
  activation (exit 2, "no installation changes were finalized").

## 7. Regenerated release asset inventory (final, recomputed)

Rebuilt from exact clean checkouts; two independent builder runs
produced **byte-identical** results (determinism preserved). Gateway and
pi-guard artifacts are byte-identical to the prior candidate (unchanged
components); pi-shuttle package, envelope, and install.sh changed with
the corrected product bytes.

| Asset | Size | SHA-256 |
|---|---|---|
| install.sh | 6980 | `28f78f8f699af475dbc68d70bdb3f1a5581d9c349f8abd00f3fe3a3483b53390` |
| pi-shuttle-0.1.0.json | 1221 | `84eb726befb144b3fa830d84bae3851769159ee5776361232a5f40b16b0006f7` |
| pi-shuttle-0.1.0.tgz | 92616 | `e091dfe54d311283b086f2b1ba652349bb74bf1e3e486ca3fa7b820d22d4bbce` |
| project-gateway-artifact-core-0.1.0.tgz | 3551096 | `ab765e043ce2892788fb0d9282e57e143ae99c12ab50328363add8459baacde9` |
| pi-guard-0.1.2.tgz | 24785 | `057f1b636328e8c77857a4b590d051fcc52c0c9b015ca5dd1a773c21d7d24d01` |

SHA256SUMS verified equal to actual bytes; embedded install.sh digests
match the envelope and package rows; the envelope's `supportedLanes` is
exactly `["linux-x86_64-posix-utf8-node22"]`; no secrets, no `.git`, no
debris.

## 8. Confirmations

- No Gateway security invariant weakened (no Gateway change at all).
- No Gateway pin movement; no pi-guard change.
- No MCP tool or authority-semantics change.
- Darwin installs fail closed before component activation; doctor never
  reports macOS supported/healthy in v0.1.0.
- Linux support behavior unchanged (Linux lane tests green).
- Future Darwin work explicitly deferred: Gateway controlled-write
  primitive (escalation report) → darwin lanes re-promotion → Lane B/C/D
  evidence.
- `private: true` and `UNLICENSED` unchanged; license decision remains a
  separate human gate.

## 9. Remaining release blockers (unchanged, external/human)

- `V0.1.0 LICENSE DECISION REQUIRED`;
- Lane A (Linux physical) zero-state evidence for the final candidate;
- public push/tag/release/upload authorization;
- live ChatGPT E2E (`EXTERNAL QUALIFIED ACCEPTANCE EVIDENCE`, applicable
  to the supported Linux product).

v0.1.0 is NOT released.
