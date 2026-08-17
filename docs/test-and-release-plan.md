# Test and Release Plan

## 1. Validation lanes

### Lane A — Linux x86_64 (physical/local, `chef@Lab`)
Full release evidence on the original supported target: Linux x86_64, Node
22.23.2, Git 2.45.4, **Pi 0.83.0** (the host currently runs Pi 0.84.1 —
Lane A must provision/verify the 0.83.0 lane; the 0.84.1 host state is NOT
evidence, Gateway P3A-WP15-006), pi-guard 0.1.2, UTF-8.

Scope: full installer (interactive + batch) → `project add` → Pi + pi-guard
composition → `start` → MCP handshake → nine-tool surface → controlled
artifact persistence → workspace confinement → read-only Git inspection →
absence of trusted authority tools → persistence/restart → safe
malformed-input handling → **zero-state pilot** (fresh HOME, one command).

### Lane B — macOS arm64 (GitHub Actions) — TARGET EVIDENCE, NOT SUPPORT
CI lane for the technically eligible but not support-promoted
darwin-arm64 target: installer (batch
mode), CLI, package integrity, filesystem/confinement (store owner/mode,
no-follow, canonical paths, /tmp canonicalization), focused E2E
(handshake + nine tools + persist/replay), storage crash suite on APFS,
record volume case-sensitivity and exact node arch. This CI evidence is
not physical Apple Silicon acceptance and creates no support claim.

### Lane C — macOS Intel (GitHub Actions) — SUPPORTED TARGET EVIDENCE
First-class darwin Intel/x64 evidence plan (PS-6I): exact
Node 22.23.2 (darwin-x64, architecture ASSERTED x64), build + typecheck
+ full test suite, mandatory APFS evidence invocation, exact Git 2.45.4
provision, and the real-stack subsection. It remains supporting automated
evidence for the x86_64 target promoted by E1.

### Lane D — macOS Intel x86_64 (physical) — ACCEPTED
The normal descriptor-bound journey ran on a physical MacBookPro13,3:
clean install → doctor → project add / trusted-store bootstrap and replay
→ start → exact nine-tool MCP handshake. The committed D report is the
authoritative physical evidence for the E1 x86_64 support promotion.
Apple Silicon execution and MAC-5 remain separate future physical
evidence work and are not implied by Lane D.

### Gateway regression lanes (reused, not duplicated)
The Gateway's own Phase 3C lanes 0–6 remain the component-level gate
(clean clone, `npm ci`, build, default regression, storage suite, crash
suite, loading suite, Pi 0.83.0 lane, clean tree). pi-shuttle release does
not re-run the full Gateway suite; it consumes the Gateway closure evidence
and runs its own black-box E2E on the installed artifact. The closure
commit `0720476b...` is pinned in the manifest; the regression candidate
`e2131dc...` (diff = closure report only) is the fallback verification
target if the closure commit is re-verified.

## 2. Focused test surfaces per component

- **pi-shuttle CLI (PS-2/PS-4)**: unit tests for config document
  read/write (closed fields, atomic write, modes), identity derivation
  determinism (same root → same workspaceId/storeId), doctor verdict
  taxonomy (each status reachable), project add/remove lifecycle
  (idempotence, replay, remove-preserves-store), start composition
  (argv/exit-code passthrough).
- **Installer (PS-3)**: batch-mode install/uninstall/rerun on throwaway
  HOMEs; SHA pin verification failure paths; partial-install receipt
  flags; rollback restore; refusal verdicts on unsupported platform/node/
  pi versions.
- **Gateway PS-1 bootstrap verb (Gateway repo)**: verb unit + integration
  tests: fresh init → INITIALIZED; re-run → replay (zero writes);
  PARTIAL/FOREIGN/UNSUPPORTED_VERSION → fail closed; identity mismatch →
  fail closed; `--output` contract; static-guard edges; runbook correction
  (PILOT-WP15-001).
- **pi-guard (unchanged)**: its own suites are the component evidence;
  pi-shuttle only adds a detection/verification test against the
  compatibility predicate (items 1–17) on the 0.83.0 lane.

## 3. Release gates (dependency-ordered)

1. **PS-1 gate**: Gateway `bootstrap` verb merged + Gateway tests green on
   the closure tree; runbook corrected (incl. PILOT-WP15-001); Gateway
   ADR-041 recorded. *Human:* review of the verb's authority surface
   (operator-only confirmation).
2. **PS-5 gate (Linux)**: Lane A green on the installed product.
3. **PS-6 / D / E1 gates (macOS):** Darwin routing and execution
   eligibility are implemented; Lane D physical Intel acceptance is
   recorded; E1 promotes only Darwin x86_64. arm64 remains technically
   eligible but not support-promoted pending physical evidence.
4. **PS-8 gate (release readiness)**: the historical Linux zero-state
   pilot remains valid. Any release after E1 must freshly materialize a
   manifest/envelope whose supported target set is Linux x86_64 plus
   Darwin x86_64; pre-promotion Linux-only envelopes are incompatible.
   Release artifacts require
   real artifact SHAs; docs complete;
   `doctor` honesty audit (no false `supported` claims); P3A-WP15-006
   closed or explicitly qualified in the release evidence; PS-7
   documentation/transport readiness accepted (PS-7R) and applicable to
   the supported product targets. Live ChatGPT
   custom-app E2E, when not yet exercised, must be blocked solely by
   external workspace eligibility and explicitly qualified as
   `EXTERNAL QUALIFIED ACCEPTANCE EVIDENCE` — never claimed as passed.
   PS-8 stops if the current OpenAI tunnel cannot bridge the stdio
   Gateway, a live eligible-workspace test reveals a
   Gateway/tool-surface defect, or official OpenAI behavior contradicts
   the documented integration.
5. **External human authorization gates** (separate, never implied):
   - public installer URL + artifact hosting decision;
   - GitHub repository creation for pi-shuttle (if any);
   - push/tag/publish/deploy of pi-shuttle v0.1.0;
   - publication/distribution of the target-selected private Gateway
     artifact (license question — currently `UNLICENSED`/private);
   - OpenAI/Secure MCP Tunnel documentation verification (official
     sources) — satisfied at PS-7/PS-7R (verified 2026-08-14; see
     `docs/reports/pi-shuttle-ps-7-chatgpt-secure-mcp-tunnel-report.md`);
     live ChatGPT custom-app E2E remains `EXTERNAL QUALIFIED ACCEPTANCE
     EVIDENCE` until exercised on an eligible workspace (never claimed
     as passed).

## 4. Evidence bundle

Per release: pinned SHAs (pi-shuttle, gateway closure, gateway tarball,
pi-guard artifact), environment versions (OS/arch incl. macOS volume
case-sensitivity and node arch, node, git origin+version, Pi, pi-guard),
lane reports (A–D), exact commands, pass/fail/skip per suite, zero-state
pilot transcript, clean-tree proof, `doctor` output from a fresh install
(partial and complete), human gate sign-offs.

## 5. Rollback of a release (product level)

Source-and-artifact level: previous manifest + receipt restore (see
installation-contract §6); never mutates stores; a reverted pi-shuttle
version must remain compatible with the stores created by the reverted-to
version (store metadata format `1` / layout `v1`; verifyStoreInstance fails
closed otherwise — no migration engine in v0.1.0).

## 6. Upgrade implications (no update support in v0.1.0)

- Upgrades are human-initiated installer reruns with a new manifest; the
  old receipt is preserved for rollback.
- Component upgrades must preserve: config format compatibility (manifest
  `configFormatVersion`), store metadata/layout format compatibility
  (fail closed via UNSUPPORTED_VERSION rather than migration), pi-guard
  compatibility predicate (new pi-guard versions need a reviewed
  compatibility record), Pi lane (0.83.0 baseline; new Pi = new evidence).
- The runtime config and stores are never auto-migrated. If a future
  Gateway version changes metadata format, pi-shuttle v0.1.0 fails closed
  with a clear message instead of migrating.
- CI workflows: designed in this repository, executed only after external
  authorization (no remote Actions in this gate).
