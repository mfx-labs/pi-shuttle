# Test and Release Plan

## 1. Validation lanes

### Lane A — Linux x86_64 (physical/local, `chef@Lab`)
Full release evidence on the exact supported lane: Linux x86_64, Node
22.23.2, Git 2.45.4, **Pi 0.83.0** (the host currently runs Pi 0.84.1 —
Lane A must provision/verify the 0.83.0 lane; the 0.84.1 host state is NOT
evidence, Gateway P3A-WP15-006), pi-guard 0.1.2, UTF-8.

Scope: full installer (interactive + batch) → `project add` → Pi + pi-guard
composition → `start` → MCP handshake → nine-tool surface → controlled
artifact persistence → workspace confinement → read-only Git inspection →
absence of trusted authority tools → persistence/restart → safe
malformed-input handling → **zero-state pilot** (fresh HOME, one command).

### Lane B — macOS arm64 (GitHub Actions)
CI lane: installer (batch mode), CLI, package integrity, filesystem/
confinement (store owner/mode, no-follow, canonical paths, /tmp
canonicalization), focused E2E (handshake + nine tools + persist/replay),
storage crash suite on APFS, record volume case-sensitivity and exact node
arch. Requires the PS-6 Gateway host-lane change to be meaningful.

### Lane C — macOS Intel (GitHub Actions)
First-class darwin Intel/x64 evidence (PS-6I): exact Node 22.23.2
(darwin-x64, architecture ASSERTED x64), build + typecheck + full test
suite, mandatory APFS evidence invocation, exact Git 2.45.4 provision,
and the real-stack subsection (exact public Gateway/pi-guard checkouts →
fixture construction → installer COMPLETE → doctor healthy → Gateway
start → MCP 9/9 → Pi 0.83.0 known-good). The Lane C runner is
`macos-15-intel`; it does not depend on the physical Lane D machine.

### Lane D — macOS arm64 (physical)
Final manual user journey, exactly as the end user: install → add project →
Pi + pi-guard → start Gateway → Secure MCP Tunnel → ChatGPT → inspect /
draft / persist. Recorded as the authoritative macOS evidence with the
Lane B evidence.

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
3. **PS-6 gate (macOS)**: Gateway host-lane change + ADR reviewed; Lane B
   green; Lane D journey recorded; case-sensitivity evidence recorded.
4. **PS-8 gate (release readiness)**: zero-state pilot green on Lane A
   and Lane D; manifest finalized with real artifact SHAs; docs complete;
   `doctor` honesty audit (no false `supported` claims); P3A-WP15-006
   closed or explicitly qualified in the release evidence; PS-7
   documentation/transport readiness accepted (PS-7R). Live ChatGPT
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
   - publication/distribution of the private `@project-gateway/artifact-core`
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
