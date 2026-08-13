# PS-6 — macOS arm64 + CI — FOCUSED REREVIEW

**Gate type:** focused correction + focused rereview + coordinated local
baselines, executed only after HUMAN approval of the PS-6 POUV2
lane-specific oracle decision.
**Scope:** SIR-PS6-001 … SIR-PS6-008 and the regressions directly
affected. No broadening of PS-6.
**Status of remote evidence:** `REMOTE CI EXECUTION — NOT PERFORMED /
HUMAN-GATED`. No push/tag/publication/deployment/remote CI execution.
pi-guard untouched; no real-Pi mutation.

## 1. Senior-review artifact preservation

The senior review was saved verbatim to
`docs/reports/pi-shuttle-ps-6-macos-ci-senior-review.md` BEFORE any
correction; its verdict line `PS-6 SENIOR REVIEW — CORRECTIONS REQUIRED`
is preserved unmodified (historical record — the review is not rewritten
after correction).

## 2. Correction summary

### SIR-PS6-001 — authoritative POUV2 lane-specific oracles (MAJOR)

- Exactly the 9 oracle fixtures (POUV2-003/004/009/011/012/018/022/024/031)
  now carry the lane-keyed expected static identity
  (`expect.staticIdentityByLane`, keyed ONLY by the validated
  `TrustedHostLane`, both accepted lanes mandatory) plus the darwin
  configuration-identity literal (`oracle.darwinConfigurationIdentity`).
- Every existing Linux fixture/oracle digest is byte-preserved (verified
  per-file: the committed `static_identity` line is untouched; the Linux
  map entry equals it exactly). No Linux vector was recomputed.
- The runner selects the expected static identity solely from the lane
  operand; a malformed or incomplete lane map fails closed
  (`static-identity-oracle-malformed` / `static-identity-oracle-incomplete`).
- The 639/648 + 9 expected failures test was DELETED; the replacement
  asserts the darwin lane passes the full authoritative corpus
  **648/648 with zero mismatches**, and the Linux lane remains 648/648.
- The independent-derivation test (MODERATE-2) now also derives each
  darwin expected value from the literal shared oracle projection with
  the darwin configuration identity substituted (committed JCS primitive,
  exact domain prefix) and cross-checks it against the production value.
- The committed corpus bundle was regenerated deterministically
  (`npm run generate`); the byte-reproducibility test passes.
- Protocol documentation: new
  `docs/decisions/ADR-016-addendum-lane-specific-identity-oracles.md`
  (reviewed protocol evolution) and an ADR-042 addendum section
  referencing it.
- Unchanged by construction: identity algorithm, configurationIdentity
  projection, fixture inputs, eligibility, findings, rules, artifact
  canonicalization.

Darwin expected values were produced by the production pipeline and
independently re-derived from literal projections before being embedded
(both computations agree for all 9 fixtures).

### SIR-PS6-002 — fixture_source injection (MODERATE)

- No GitHub-expression interpolation remains in executable shell text:
  the dispatch input crosses into the workflow as the `FIXTURE_SOURCE`
  environment variable (data), including in the fixture-gate-report job.
- New `scripts/ci-validate-fixture-source.sh`: https-only, closed
  character set enforced over the WHOLE value via POSIX `tr` (a
  line-based `grep -E` would let a second injected line through — the
  adversarial self-test caught exactly this and the check was hardened),
  rejecting quotes, `$()`, backticks, semicolons, newlines, whitespace,
  query/fragment syntax, and non-https schemes. Invalid input exits 2
  BEFORE any curl.
- Fetch uses the argv-safe boundary `curl -fsSL -- "$FIXTURE_SOURCE"`.
- Adversarial checks are committed twice: the script's `--selftest` mode
  and `tests/unit/ci-fixture-source.test.ts` (16 adversarial shapes +
  valid URL + empty value).

### SIR-PS6-003 — Git 2.45.4 provenance (MODERATE)

- New `scripts/ci-provision-git-2454.sh`: ONE exact source artifact —
  kernel.org `git-2.45.4.tar.gz` with the reviewed SHA-256
  `896c6640ee56adc7f83a78b122d129231ca8ce7fd582f606d282a7114eb0b4ab`
  (computed in this gate and cross-checked against the www.kernel.org
  mirror) — digest verified (`shasum -a 256 -c`) BEFORE extraction/build,
  user-scope `make prefix=…` build (no sudo, no system Git replacement),
  exact built-version assertion (`test "$BUILT_VERSION" = "git version
  2.45.4"`), origin/digest/path/version recorded to the step summary.
- Both Lane B provisioning steps use the script; the floating
  `github.com/git/git/archive/refs/tags/…` URL is gone.
- The product requirement stays exact and unchanged (Gateway
  `wrong-version` fail-closed runtime check untouched).
- Committed static checks: `tests/unit/ci-git-provisioning.test.ts`
  pins the digest, the ordering (verify before extract), the version
  assertion, no sudo, and no floating tag URL in any workflow.

### SIR-PS6-004 — mandatory APFS evidence must not disappear as a skip (MODERATE)

- New `scripts/ci-apfs-evidence-strict.mjs`: a DEDICATED Lane B evidence
  invocation that runs the committed `apfs-path-evidence` suite with the
  TAP reporter and enforces zero skips on darwin. Exit 0 = PASS, 1 =
  FAILED, 3 = NOT EXECUTED (any skip, or a non-darwin host) — any skip
  makes the Lane B evidence job RED; it can never be a silent green.
- The generic unit suite keeps its truthful platform skips (2 on Linux,
  recorded as such).
- No production case-folding or Unicode normalization was added (none
  exists; none introduced).

### SIR-PS6-005 — quarantine contract (MODERATE)

- New `src/installer/quarantine.ts`: darwin-only
  `com.apple.quarantine` handling, positioned in the component flow
  AFTER `verifyArtifactFile` (SHA-256) and BEFORE `extractArtifact`
  (exactly contract §3.7 ordering). argv-safe `xattr` through the shared
  process boundary (no shell), fixed attribute constant. Attribute
  absence is a truthful `no-quarantine` no-op; missing utility, list
  failure, and strip failure fail closed with the installer error model
  (`ERR-PS3-QUARANTINE`). Linux never resolves or invokes xattr.
- Wiring: `ComponentInstallContext` gains `platform`/`pathEnv`;
  `installGatewayComponent` and `installPiGuardComponent` both enforce
  the ordering; `runInstall` supplies the host facts.
- `src/process/runner.ts` `resolveExecutable` now falls back to the
  process environment internally (the process boundary remains the only
  environment reader; the static guard still passes).
- Tests (`tests/unit/installer-quarantine.test.ts`): darwin with
  attribute (list-then-strip order asserted), darwin without attribute
  (no strip), Linux (xattr never resolved, even absent from PATH),
  missing utility, list failure, strip failure, digest mismatch → no
  quarantine mutation (xattr never invoked), and a full darwin component
  install with the strip recorded.

### SIR-PS6-006 — reverse replay (MINOR)

- Mirrored direct test added to `tests/unit/bootstrap-action.test.ts`:
  darwin-arm64-created store → linux-lane replay → fail closed
  (`ERR-STO-INTEGRITY`, the same existing metadata binding), metadata
  bytes unchanged, own-lane (darwin) replay afterwards still
  `INITIALIZED` with the identical identity.

### SIR-PS6-007 — Node assertion (MINOR)

- Lane B now asserts `test "$(node -p process.arch)" = "arm64"` in both
  Node provisioning steps (build-test and real-stack) and records the
  fact; a non-arm64 architecture fails the job.

### SIR-PS6-008 — stale wording (MINOR)

- `src/compat/manifest.ts`: gatedLanes doc comment corrected (empty set,
  no stale "PS-6 evidence required").
- `src/command/doctor.ts`: the dead gated-lane branch was removed; the
  platform detail is now the lane string only. No semantic contract edits.

## 3. Focused verification (independently executed this gate)

### Gateway (baseline `7f3b4afd…`; corrections uncommitted at run time, now committed)

| Command | Result |
|---|---|
| `npm run build` (regenerates corpus bundle + tsc) | clean |
| `npm run typecheck` | clean |
| `node --test dist-test/tests/integration/conformance.test.js` | **17/17 pass** — incl. Linux authoritative 648/648, **darwin authoritative 648/648 (0 mismatches, no expected-failure allowance)**, lane-keyed independent derivation, byte-reproducible corpus |
| `node --test dist-test/tests/unit/bootstrap-action.test.js` | **18/18 pass** (incl. mirrored cross-lane replay) |
| `node --test "dist-test/tests/trusted/*.test.js"` | **576/576 pass** (incl. containment-host-lane) |
| `node --test "dist-test/tests/runtime/*.test.js"` | **53/53 pass** (bootstrap/runtime lane consistency) |
| `git diff --check` | clean |

### pi-shuttle (baseline `42c1e5b3…`)

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | **212 tests: 210 pass / 0 fail / 2 skipped** (the 2 skips are the darwin-only APFS case/Unicode tests skipping truthfully on Linux) |
| `npm ci --dry-run` | clean (lockfile deterministic) |
| `git diff --check` | clean |
| `bash -n` all `.sh`; `node --check` all `.mjs` | clean |
| `bash scripts/ci-validate-fixture-source.sh --selftest` | all adversarial cases behave as required (incl. the multiline-injection case) |
| `node scripts/ci-apfs-evidence-strict.mjs` (linux) | exit 3 `NOT EXECUTED` — the evidence gate mechanics verified |
| pyyaml parse of all three workflows | OK |
| `bash scripts/prepare-fixtures.sh --gateway-checkout … --pi-guard-checkout …` | baselines verified (Gateway `1a454b61…`, pi-guard `v0.1.2`), fixtures + SHA-pinned manifest produced |
| Workflow static security tests (committed) | pass (full-SHA pins, read-only permissions, no input interpolation in shell, scripts exist) |
| Git provisioning static tests (committed) | pass (reviewed digest, ordering, version assertion) |
| Fixture-source adversarial unit tests (committed) | pass |
| Quarantine unit tests (committed) | pass |

Broad unrelated Gateway storage suites were not rerun: no correction
touches storage code (cross-lane replay behavior is pinned by the
existing binding and the bootstrap-action tests).

## 4. Coordinated local baselines

### L1 — Gateway baseline

- Parent verified exactly `7f3b4afdb43704e7dac82da7b086d8367347c641`.
- Staged ONLY authorized PS-6 Gateway changes (11 modified sources,
  generated corpus, 4 test files, 9 fixtures, ADR-042, ADR-016 addendum,
  runbook, implementation report). WP-13D debris (report,
  `src/retrospective/`, 2 test files) excluded and still untracked.
- Cached diff inspected (29 files, +805/−103).
- Committed locally with subject exactly `feat: add darwin arm64 Gateway host lane`.
- **New Gateway SHA: `1a454b61241ca23a638c3083e2e7d28e28f86b18`.** No push/tag/remote.

### L2 — pi-shuttle Gateway provenance pin

- `GATEWAY_PS1_BASELINE_COMMIT` updated to
  `1a454b61241ca23a638c3083e2e7d28e28f86b18` (the product composition now
  points at the committed PS-6 Gateway implementation; Gateway package
  version unchanged — contract does not require a bump).
- Asserting tests updated (manifest pins, installer-flow receipt commit).
- Fixture-prep baseline pin (`scripts/prepare-fixtures.sh`) updated to
  the committed Gateway SHA — verified end-to-end against both repos.
- Inert fixture DATA (synthetic receipt documents in
  installer-receipt/start/lifecycle tests) intentionally untouched —
  historical fixture content, no assertion ties it to the binding.
- Directly affected tests + full suite + `git diff --check`: green
  (see §3).

### L3 — pi-shuttle baseline

- Parent verified exactly `42c1e5b3bd53c5b922b9635c86ecdceb123c9847`.
- Staged ONLY authorized PS-6 pi-shuttle changes: platform implementation
  (manifest, preflight, doctor), the SIR-PS6-005 quarantine module +
  wiring, the SIR-PS6-008 wording fixes, all PS-6 tests (incl. new
  quarantine/CI static/APFS evidence tests), the three lane workflows,
  all helper scripts (fixture prep, real-stack, probes, fixture-source
  validation, git provisioning, strict APFS evidence), README status row,
  the four gate reports (readiness, implementation, senior review,
  focused rereview), and the final Gateway provenance-pin update.
- Committed locally with subject exactly `feat: add macOS arm64 product lane`.
- No push/tag/remote/publication.

## 5. Mandatory conclusions

1. Existing Linux POUV2 vectors unchanged? **YES** (byte-preserved; per-file diff shows only additive fields).
2. Darwin lane now passes the authoritative POUV2 suite rather than blessing failures? **YES** (648/648, 0 mismatches; the 639/648-blessing test is deleted).
3. Lane-specific oracle selection limited to identity fields whose value actually depends on `TrustedHostLane`? **YES** (only `expect.staticIdentityByLane` + `oracle.darwinConfigurationIdentity`; selection keyed by the validated lane; incomplete maps fail closed).
4. No identity/authority algorithm changed? **YES** (identity algorithm, projection, eligibility, findings, rules, canonicalization untouched).
5. fixture_source cannot become shell syntax? **YES** (env plumbing only; strict whole-value validation before any curl; argv-safe `curl --`; adversarial tests).
6. Git source is digest-pinned and built version asserted? **YES** (kernel.org digest `896c6640…`, mirror cross-checked, verify-before-build, exact version assertion).
7. Mandatory Lane B APFS evidence cannot silently skip green? **YES** (dedicated strict invocation; any skip → NOT EXECUTED → job red).
8. Quarantine removal occurs only on darwin and only after digest verification? **YES** (component flow: verifyArtifactFile → strip → extract; Linux no-op; digest-mismatch never reaches the strip — tested).
9. Reverse cross-lane replay directly tested? **YES** (mirrored test; 18/18).
10. Lane B Node arch is asserted arm64? **YES** (both provisioning steps fail the job otherwise).
11. Linux PS-5 behavior remains intact? **YES** (full pi-shuttle suite incl. PS-5 executable/static guards green; Gateway Linux lane unchanged).
12. Pi policy remains exactly 0.83.0? **YES** (pins and refusal policy untouched).
13. Intel remains unsupported? **YES** (Lane C compat-only; darwin-x64 refusal tests green).
14. pi-guard remains unchanged? **YES** (HEAD `7a7580cc…` = v0.1.2, zero modifications).
15. Remote CI still recorded as NOT PERFORMED? **YES**.

## 6. Verdict

All eight findings are corrected exactly as specified, with committed
adversarial/static/unit coverage, and no PS-6 broadening. The supported
product composition is bound to the committed Gateway PS-6 baseline, and
both authoritative conformance lanes are green. Remote Lane B CI
execution and physical Lane D evidence remain separate human-gated
evidence and are not claimed here.

`PS-6 FOCUSED REREVIEW — ACCEPTED`
