# PS-6 — macOS arm64 + CI — SENIOR REVIEW REPORT

**Review gate:** read-only. No production code, test, or contract modified; nothing staged/committed/pushed. No remote CI execution.
**Reviewer limitations (recorded honestly):** this review ran in a read-only inspection mode without bash; therefore no commands were executed. All "independent verification" below is static source/tests/contracts inspection plus re-derivation of reported evidence from the code. Implementation-run totals are recorded separately as implementation evidence.

## 1. Reviewed baselines

| Repo | Expected | Observed | Verdict |
|---|---|---|---|
| pi-shuttle (master) | `42c1e5b3bd53c5b922b9635c86ecdceb123c9847` | identical (`.git` verified via git inspect) | ✓ |
| Project Gateway MCP (main) | `7f3b4afdb43704e7dac82da7b086d8367347c641` | identical (`.git/refs/heads/main` verified) | ✓ |
| pi-guard (main) | `7a7580cc4cbd7926797564c72269394fc29a860a` (`v0.1.2`) | identical (`.git/refs/heads/main` verified; `package.json` version `0.1.2`) | ✓ |

Neither pi-shuttle nor Gateway has a configured remote (`.git/config` verified) — consistent with "no push/remote changes."

**Pre-existing untracked debris:** Gateway — WP-13D files (`src/retrospective/` ×4, `tests/unit/wp13d-*.test.ts` ×2, report) — untouched, no PS-6 content. pi-guard — pre-existing v0.1.1/WP review docs under `docs/reviews/` — untouched. pi-shuttle — the PS-6 readiness-analysis report (previous gate artifact).

## 2. Complete diff inventory

### Gateway (verified by content review of every changed file; git execution unavailable for that repo in this mode)
| Path | Class |
|---|---|
| `src/trusted/host-lane.ts` | Gateway host-lane implementation |
| `src/trusted/types.ts` | Gateway host-lane implementation |
| `src/trusted/validate.ts` | Gateway host-lane implementation |
| `src/trusted/containment-validate.ts` | Gateway host-lane implementation |
| `src/trusted/index.ts` | Gateway host-lane implementation |
| `src/runtime/mcp/cli.ts` | Gateway host-lane implementation (boundary) |
| `src/bootstrap/run.ts` | Gateway host-lane implementation |
| `src/control-plane/storage-bootstrap-action.ts` | Gateway host-lane implementation |
| `src/runtime/mcp/lanes.ts` | Gateway host-lane implementation |
| `src/runtime/mcp/compose.ts` | Gateway host-lane implementation |
| `src/conformance/runner.ts` | Gateway host-lane implementation |
| `tests/trusted/host-lane.test.ts` | Gateway test/evidence |
| `tests/unit/bootstrap-action.test.ts` | Gateway test/evidence |
| `tests/integration/conformance.test.ts` | Gateway test/evidence |
| `tests/trusted/containment-host-lane.test.ts` (new) | Gateway test/evidence |
| `docs/decisions/ADR-042-…md` (new) | Gateway ADR |
| `docs/operations/project-gateway-operator-runbook.md` | Gateway runbook |
| `docs/reports/pi-shuttle-ps-6-gateway-host-lane-implementation-report.md` (new) | documentation/report |

### pi-shuttle (complete mechanical diff via git)
| Path | Class |
|---|---|
| `src/compat/manifest.ts` | pi-shuttle platform implementation |
| `src/installer/preflight.ts` | pi-shuttle platform implementation |
| `src/command/doctor.ts` | pi-shuttle platform implementation |
| `README.md` | documentation (status row only) |
| `tests/unit/{manifest,installer-preflight,doctor,lifecycle,start}.test.ts` | pi-shuttle tests |
| `tests/unit/apfs-path-evidence.test.ts` (new) | pi-shuttle tests / APFS evidence |
| `.github/workflows/lane-{a,b,c}-*.yml` (new ×3) | CI/workflow |
| `scripts/prepare-fixtures.sh`, `scripts/ci-lane-b-real-stack.sh`, `scripts/mcp-handshake-probe.mjs`, `scripts/pi-extension-load-probe.mjs` (new ×4) | evidence/helper scripts |
| `docs/reports/pi-shuttle-ps-6-macos-ci-{readiness-analysis,implementation-report}.md` | documentation/report (readiness = prior gate) |

**Out-of-scope paths:** none found. No normative contract document in pi-shuttle was modified (§18 ✓). pi-guard: zero changes (§16 ✓).

## 3. Gateway accepted-lane contract (§2)

`src/trusted/host-lane.ts`: `ACCEPTED_HOST_LANES` is exactly `[linux-x86_64-posix-utf8-node22, darwin-arm64-posix-utf8-node22]` (frozen). `isSupportedHostLane` is strict string equality against the two literals — **no alias/prefix/regex matching**. `TrustedHostLane` is the two-literal union; post-validation a configuration can only carry one of the two values (validator TCF-027/028 gate precedes all input handling, tested with hostile cyclic input). Rejected and tested: `macos-arm64-posix-utf8-node22`, `darwin-x86_64-posix-utf8-node22`, Windows, wrong node/non-POSIX, case-variants, trailing-space, future strings; missing/non-string lane → TCF-027. **Contract satisfied.**

## 4. Host observation boundary (§3)

- Gateway: `process.platform`/`process.arch` appear **only** in `src/runtime/mcp/cli.ts` (single CLI-boundary derivation via the pure `trustedHostLaneForPlatformArch`). No other production module probes the host.
- Flow: observation → one boundary mapping → trusted lane operand → `runBootstrapCommand(argv, hostLane)` and `composeTrustedRegistry(config, {}, hostLane)`. Trusted validation (`validate.ts`), containment (`containment-validate.ts` — closed predicate), storage bootstrap action (`input.hostLane`, required), identity stamping (operand retained at validate.ts:730) contain **no ambient probe**.
- Remaining `TRUSTED_HOST_LANE` occurrences are only: the constant definition, the two-lane predicate, `compose.ts` default parameter (documented: existing direct callers/tests; production CLI always passes the derived lane), and the conformance runner default (evidence tool, darwin runs pass an explicit operand). None participates in bootstrap/start/containment/storage-bootstrap/identity-stamping production paths.
- pi-shuttle: `process.platform`/`process.arch` only in the host seam `src/host/environment.ts`; doctor's `-p process.arch` is a subprocess probe of the actual node binary, not an ambient read.

**Answer: NO — bootstrap and runtime on the same machine cannot derive different host-lane operands through current composition.** Both consume the same once-derived operand in one process (`cli.ts` `main()`), and across processes the same node executable reports identical platform/arch. No Linux-only hardcoding participates in bootstrap, start, containment, conformance, storage bootstrap, or identity stamping.

## 5. Trusted operand retention (§4)

- validate.ts: operand gated by `isSupportedHostLane` (TCF-027/028), then `hostLane` (the validated operand) is placed in the validated configuration (line 730) — **the Linux constant is no longer stamped**.
- Operator injection impossible: a `hostLane` field inside the config input is an unknown field (TCF-025, tested); the operator runtime-config schema has no lane field (unchanged).
- Identity projection **not redesigned**: `identity.ts` untouched; `hostLane` was already a first-class projection member. Identical inputs under the two lanes differ in digest solely via `hostLane` (tested at validator and bootstrap layers; `host-lane.test.ts` pins projection membership and digest inequality).
- **Satisfied.**

## 6. Cross-lane replay (§5)

`tests/unit/bootstrap-action.test.ts` PS-6 tests: Linux-lane store → darwin-lane replay → `ERR-STO-INTEGRITY` (FOREIGN aggregate via the existing metadata `configurationIdentity` binding in `initializeTrustedStore`/`verifyStoreInstance`); metadata bytes byte-identical before/after; own-lane replay afterwards still `INITIALIZED` with identical identity. No repair/migration/rewrite/destructive-cleanup code exists anywhere on that path. Failure originates from the **existing** binding — no second authority mechanism was introduced. One direction (Linux→darwin) is directly tested; the reverse direction is covered by the same symmetric binding mechanism but is not directly tested → recorded as SIR-PS6-006 (MINOR).

## 7. POUV2 conformance divergence — MANDATORY ANALYSIS (§6)

**Mechanism (verified end-to-end in code):** `ConformanceRunner.buildPouV2Configuration` validates the fixture config with the lane operand; the POUV2 static-input projection (`identity-v2.ts`/`routing.ts:166`) embeds `configurationIdentity` = `configuration.identity`, which is hostLane-bound by the identity projection. The committed oracle projections (`fixtures/pointofuse-v2/POUV2-*.json` `oracle.static_projection`) embed linux-lane configuration-identity digests.

**The affected set is exactly 9:** POUV2-003, 004, 009, 011, 012, 018, 022, 024, 031 — precisely the 9 fixtures carrying `oracle.static_projection` + `expect.static_identity` (verified by grep; no other fixture asserts a static identity).

**Per-fixture classification:**

| Fixture | Differing field | Identity-derived? | Non-lane semantics | Oracle byte-fixed? |
|---|---|---|---|---|
| POUV2-003 | `expect.static_identity` (`2a2a40fb…`) | Yes — via `configurationIdentity` | Identical (eligible/findings/rules pass) | Yes (ADR-016 corpus) |
| POUV2-004 | `expect.static_identity` (`6a592b90…`) | Yes | Identical | Yes |
| POUV2-009 | `expect.static_identity` (`68159d2f…`) | Yes | Identical | Yes |
| POUV2-011 | `expect.static_identity` (`bfa69334…`) | Yes | Identical | Yes |
| POUV2-012 | `expect.static_identity` (`cdda6b7d…`) | Yes | Identical | Yes |
| POUV2-018 | `expect.static_identity` (`a70aa93c…`) | Yes | Identical | Yes |
| POUV2-022 | `expect.static_identity` (`7204e33c…`) | Yes | Identical | Yes |
| POUV2-024 | `expect.static_identity` (`2a2a40fb…`, same config as 003) | Yes | Identical | Yes |
| POUV2-031 | `expect.static_identity` (`40b29e14…`) | Yes | Identical | Yes |

**Classification per fixture: A (expected lane-bound output with a single-lane oracle) — but that does not make the darwin suite GREEN.** ADR-016 makes the corpus an *executable oracle* whose digest values "are protocol contract, not implementation-specific tests", and "fixture changes that alter … digest values … require reviewed protocol evolution." The committed oracles are byte-fixed and linux-lane-bound. Under the darwin lane the authoritative suite **cannot pass**: 639/648, 9 failures. The new conformance test asserts 639-pass/9-fail as the *desired* darwin outcome — this is reinterpreting a failing authoritative suite as the expected result, which this review gate explicitly forbids.

**Fixture disposition:** per-lane parameterization is the right shape (a darwin expected-identity set for exactly these 9 fixtures, or lane-aware oracle selection in the runner), not full duplication and not dropping the assertions. Under such a correction the darwin run must assert **648/648** against lane-appropriate oracles.

**Mandatory review conclusion (§6):** the supported darwin conformance lane currently **cannot pass its authoritative suite without changing fixtures/oracles**. → **Correction-required finding SIR-PS6-001** (MAJOR, TEST/EVIDENCE; ADR-level contract escalation required — ADR-016 "reviewed protocol evolution" + ADR-042 addendum, not a product-contract escalation).

## 8. Gateway ADR-042 (§7)

Records exactly the approved decision list: two-lane closed set ✓; Intel unsupported ✓; default case-insensitive APFS supported ✓; no path case-folding ✓; realpath-based canonicalization preserved ✓; fixed-lowercase layout ✓; dev/ino namespace facts ✓; host-lane identity binding ✓; cross-lane replay fail-closed ✓; `caseSensitive:false` valid probe evidence ✓; fsync/O_NOFOLLOW/O_EXCL probe facts ✓; artifact Unicode/JCS unchanged ✓. **No new normative architecture introduced.** The Consequences paragraph correctly records the POUV2 oracle divergence but does not decide its disposition — that omission is exactly what SIR-PS6-001 must close.

## 9. pi-shuttle manifest promotion (§8)

`manifest.ts`: `supportedLanes = [LINUX_HOST_LANE, DARWIN_ARM64_HOST_LANE]`, `gatedLanes = []` — darwin arm64 removed from gated, **not** both gated and supported ✓. Unsupported: darwin-x64 (hostLane → `darwin-x64`, refused by installer/doctor exit 2), Windows, unknown ✓. Linux PS-5 claim untouched ✓. README row updated as a status note only ✓. `platform-support-contract.md` untouched; its matrix row "macOS arm64 — supported (first-class, gated)" refers to the PS-6 evidence gates (Lane B CI + Lane D), which remains accurate and pending — the manifest is the operative claim source, as the contract itself says ("The exact lane is declared in the manifest"). No stale "gated" claim remains in production code/tests.

## 10. darwin Node architecture probe (§9)

Doctor-only, runs only when `platform=darwin && arch=arm64`, executes the **actual product Node** (`nodeExecutable ?? process.execPath` — the running interpreter, same rule as the installer) with argv `['-p','process.arch']` through the pre-existing spawn-based runner: **argv-safe, no shell, no PATH injection, bounded/timeout, Linux behavior untouched (tested: no arch probe on linux), closed vocabulary only** (`supported` / `unsupported` / `installed but unverified`). Cases: native arm64 → `supported` (arch fact in detail); x64 → `unsupported` exit 2 (names Rosetta); unobservable → `installed but unverified` (truthful non-supported). In production the Rosetta/runtime case is additionally caught by the platform lane (a Rosetta-run pi-shuttle has `arch=x64` → darwin-x64 → platform `unsupported`, exit 2), so installer/doctor stay mutually truthful: an installer accepted under a native node that is later run via a Rosetta node is reported by doctor as unsupported against the actual runtime facts — consistent with platform-support-contract §3.9 ("arch mismatch fails closed in doctor"). **Satisfied.**

## 11. APFS identity evidence (§10)

**No production case-folding or Unicode normalization was introduced** — production delta is manifest + preflight wording + the doctor branch only; identity remains `realpath` → canonical root → existing sha256 identity formula (untouched modules). `apfs-path-evidence.test.ts` proves: symlink alias → one canonical path/identity/registration (host-independent, runs everywhere); `Project`/`project` case variant → same realpath, same dev+ino, one identity, exact-replay dedupe (darwin-only); NFC/NFD → one object/identity via realpath (darwin-only). Skip semantics are truthful (skip only when the volume cannot exercise the alias: non-darwin, or case-sensitive volume). **Gap:** the Lane B workflow does not surface a skip if the darwin runner were ever case-sensitive — `npm test` exits 0 with skips and the APFS evidence step still reads green → **SIR-PS6-004** (MODERATE, TEST/EVIDENCE): Lane B must fail/report explicitly when the darwin APFS evidence tests skip.

## 12. Workflow Lane A (§11)

`lane-a-linux-regression.yml`: `ubuntu-24.04` ✓; exact Node 22.23.2 linux-x64 tarball with SHA-256 pin `d60acfe0…` — **verified against official nodejs.org SHASUMS256.txt** ✓; runner node never trusted for the evidence lane ✓; `npm ci` (lockfile) ✓; build ✓; typecheck ✓; full self-contained suite ✓; npm-pack executable regression (PS5-LINUX-001 release-shaped direct exec) ✓; `git diff --check` ✓; no release behavior, no PS-5 E2E duplication ✓. PS5-LINUX-001 remains protected.

## 13. Workflow Lane B (§12)

`macos-15` (arm64 GA image) with explicit `uname -m`=arm64 assertion ✓; exact Node 22.23.2 darwin-arm64, SHA `61130f39…` verified against official SHASUMS256.txt ✓; `npm ci`/build/typecheck/full suite ✓; npm-pack + direct exec ✓; Git 2.45.4 user-scope source build (no sudo, no system replacement, PATH prepend, origin/version/path recorded) ✓; volume case-sensitivity record ✓; Pi 0.83.0 isolated lane inside the fixture-gated real-stack job ✓; real Gateway lifecycle/MCP job fixture-gated via `workflow_dispatch` input with truthful `fixture-source not configured` report job (`if: always()`) ✓. **`REMOTE CI EXECUTION — NOT PERFORMED / HUMAN-GATED`** — stated in workflow headers, both reports, and README; no evidence claim implies the hosted runner already passed. Findings: SIR-PS6-002/003/004/007 apply to this file.

## 14. Workflow Lane C (§13)

`macos-15-intel` (explicit Intel label) ✓; exact Node 22.23.2 darwin-x64 (SHA `58e99022…` verified ✓); build/typecheck/selected unit tests/static npm-pack ✓; installer refusal honesty (platform check runs **first** in `runInstall`, so darwin-x64 → `UNSUPPORTED`, exit 2, no receipt — grepable in log) ✓; doctor refusal honesty (`platform: unsupported`, exit 2) ✓. **No healthy-product acceptance path for darwin x64; no support claim is created.**

## 15. Workflow security (§14)

All three: `permissions: contents: read` ✓; every `uses:` pinned to full SHA `11bd71901bbe5b1630ceea73d27597364c9af683` = actions/checkout **v4.2.2** (independently verified against the upstream tag) with comments naming the tag ✓; no `@main`/floating tags/branches ✓; `persist-credentials: false` ✓; no token writes, no secrets, no npm publish, no Release, no deployment, no sudo ✓. All referenced helper scripts exist (`scripts/prepare-fixtures.sh`, `ci-lane-b-real-stack.sh`, both probes) ✓. **Exception — SIR-PS6-002:** `curl -fsSL "${{ inputs.fixture_source }}"` interpolates a dispatch-controlled string into shell; quoted interpolation permits command injection (`"`, `$( )`, backticks) for users with write/dispatch permission. Correction: strict character-set validation before use.

## 16. Fixture-source honesty (§15)

`prepare-fixtures.sh`: explicit args only; exact baselines (Gateway `7f3b4af…`, pi-guard tag `v0.1.2`@`7a7580cc…`) checked with fail-closed exit on HEAD/tag mismatch; refuses dirty checkouts; scratch-clone build+pack (no source-repo mutation); no arbitrary URL clone, no global install, no sudo, no publication; manifest carries commit+tag+sha256 per component ✓. Lane B verifies digests against the manifest before use ✓. Absence → explicit `fixture-source not configured — … skipped` (never PASS) ✓. Production installer gained **no** CI remote acquisition (install.sh unchanged, no network) ✓.

## 17. Git 2.45.4 (§16)

Gateway runtime requirement unchanged and exact (`git --version` must contain 2.45.4, `wrong-version` fail-closed, binary fingerprint). Lane B builds `git/git` v2.45.4 from source user-scope, no sudo, recorded path/version; product discovery stays PATH-based; stock Apple git never sufficient ✓. **Flagged — SIR-PS6-003:** the provisioning download is a tag-ref tarball URL with **no checksum**, and the workflow prints but does not assert the built git version. Pin a SHA-256 and assert `git --version` contains 2.45.4 in the workflow.

## 18. Pi 0.83.0 / pi-guard (§17)

Policy unchanged: Pi 0.83.0 accepted, 0.84.x refused (`PI_NON_BASELINE_POLICY = 'refuse-non-baseline'` untouched) ✓. pi-guard v0.1.2 byte-level unchanged (HEAD == tag SHA; no PS-6/lane content in src or extensions; version 0.1.2) ✓. Lane B Pi integration is isolated (`RUNNER_TEMP` lane, isolated HOME, read-only extension-load via Pi's own loader, no provider auth, no real user Pi state) ✓.

## 19. Contracts and documentation (§18)

No normative contract document modified in any repo. Only ADR-042 (separately authorized), the Gateway runbook host-lane rows, pi-shuttle README status row, and new reports. Identity/APFS/Pi/Intel/authority/remove-semantics/configurationVersion all unchanged. **Exception — SIR-PS6-005:** `platform-support-contract.md` §3.7 mandates quarantine-attribute stripping after SHA verification; the promoted darwin installer still has no quarantine handling and the implementation report is silent on it (the readiness analysis deferred it "only if Lane B evidence shows a quarantine-bearing path"). Smallest correction: strip `com.apple.quarantine` on darwin after digest verification (contract already mandates it), or record an explicit approved deferral with a Lane D evidence gate.

## 20. Focused independent verification (§19)

**Not executed in this review mode** (no bash): test suites, typechecks, `git diff --check`. **Independently established by static verification:** all items in §2–§18 above; plus cross-checks — Node tarball SHA-256 pins against official `nodejs.org/dist/v22.23.2/SHASUMS256.txt` (all 3 match); actions/checkout v4.2.2 commit SHA against upstream GitHub API (matches); the exact 9-fixture POUV2 oracle set by grep (oracle ∧ static_identity fixtures = mismatch set, no others); the POUV2 static-projection → configurationIdentity → hostLane-bound chain traced through `routing.ts` → `identity-v2.ts` → `identity.ts`; cross-lane replay code path traced (no repair/mutation branches); workflow security by file audit; fixture-helper fail-closed paths by script audit. Implementation-reported totals (Gateway: trusted 576, bootstrap-action 17, conformance 17, runtime 53, storage 431+2 skip, crash 5, mcp 0-fail; pi-shuttle: 194 tests/192 pass/2 truthful darwin-only skips) are recorded as implementation evidence, not review-executed evidence.

## 21. Findings

| ID | Sev | Class | Location | Invariant violated | Smallest correction | In PS-6 envelope? | Contract escalation? |
|---|---|---|---|---|---|---|---|
| SIR-PS6-001 | MAJOR | TEST/EVIDENCE | Gateway `fixtures/pointofuse-v2/POUV2-{003,004,009,011,012,018,022,024,031}.json` + `tests/integration/conformance.test.ts` (darwin test) | darwin conformance lane cannot pass its authoritative suite; test blesses 639/648 as expected instead of per-lane oracles (ADR-016: digest values are protocol contract) | Parameterize per-lane expected static identities for exactly these 9 fixtures (or lane-aware oracle selection); darwin run asserts 648/648 | Yes | **ADR-level: required** (ADR-016 "reviewed protocol evolution" + ADR-042 addendum) |
| SIR-PS6-002 | MODERATE | SECURITY | `.github/workflows/lane-b-macos-arm64.yml` (fixture fetch step) | Dispatch-controlled string interpolated into shell → command injection | Validate `fixture_source` against a strict charset (`^https://[A-Za-z0-9:./_%-]+$`) before curl | Yes | No |
| SIR-PS6-003 | MODERATE | SECURITY | Lane B (both git provisioning steps) | Git v2.45.4 tag-ref tarball downloaded with no checksum; built version not asserted | Pin tarball SHA-256 (kernel.org tarball w/ published digest) + assert `git --version` = 2.45.4 | Yes | No |
| SIR-PS6-004 | MODERATE | TEST/EVIDENCE | Lane B `npm test` step | Mandatory APFS evidence tests can skip silently with a green job (§10 requirement) | Add a darwin step that fails/reports if the APFS evidence tests skip (dedicated run with skip detection) | Yes | No |
| SIR-PS6-005 | MODERATE | INTEGRATION | `src/installer/**`, `install.sh` | platform-support-contract §3.7 (quarantine strip after SHA verify) unimplemented for the promoted darwin lane; not addressed in the implementation report | darwin `xattr -d com.apple.quarantine` after digest verification, or explicit approved deferral with Lane D evidence gate | Yes | No (contract already mandates it) |
| SIR-PS6-006 | MINOR | TEST/EVIDENCE | Gateway `tests/unit/bootstrap-action.test.ts` | Reverse cross-lane replay (darwin store → linux lane) not directly tested (symmetric binding makes it low-risk) | Add the mirrored one-way test | Yes | No |
| SIR-PS6-007 | MINOR | TEST/EVIDENCE | Lane B Node provisioning step | `node -p process.arch` printed but not asserted ("must print darwin arm64" comment) | `test "$(node -p process.arch)" = arm64` | Yes | No |
| SIR-PS6-008 | MINOR | DOCUMENTATION | `src/compat/manifest.ts` gatedLanes doc comment; doctor dead gated branch | Stale wording ("PS-6 evidence required" while empty) | One-line comment update | Yes | No |

No CRITICAL findings. Absence of remote CI execution is recorded as the external human gate, not a finding.

## 22. Mandatory review conclusions (§21)

1. **Supported trusted host-lane set exactly Linux x86_64 + darwin arm64?** YES (closed two-member set, strict equality, all others TCF-028/exit 2).
2. **One host observation feeds both bootstrap and runtime identity?** YES — single derivation at `cli.ts`, shared by both paths; they cannot diverge.
3. **Validated lane retained in trusted configuration?** YES (validate.ts stamps the validated operand; no constant replacement).
4. **Linux/darwin identities distinct as intended?** YES (projection includes hostLane; digests differ solely by lane; projection itself not redesigned).
5. **Cross-lane replay fails closed without mutation?** YES (existing binding → FOREIGN/ERR-STO-INTEGRITY; bytes unchanged; own-lane replay green; reverse direction symmetric, untested directly — SIR-PS6-006).
6. **9 POUV2 divergences: valid lane-specific drift or correction-required?** **CORRECTION-REQUIRED** — expected lane-bound output against obsolete single-lane oracles, but the authoritative ADR-016 corpus cannot be passed as-is; blessing 639/648 is not GREEN (SIR-PS6-001).
7. **Production case-folding or Unicode normalization introduced?** NO.
8. **darwin-arm64 Node verification rejects Rosetta/x64 truthfully?** YES (probe of the actual product node; closed vocabulary; Rosetta additionally caught by platform lane; no new vocabulary).
9. **Can APFS tests be skipped without falsely claiming Lane B evidence?** Unit tests skip truthfully; but the workflow does not surface a darwin skip → NO until SIR-PS6-004 is corrected.
10. **Lane C explicitly unsupported?** YES (compat evidence only; refusal honesty asserted; no healthy acceptance path).
11. **Workflows locally safe and non-publishing?** YES except SIR-PS6-002 (dispatch-input shell interpolation) and SIR-PS6-003 (unpinned git tarball).
12. **Fixture-source absence surfaced as NOT EXECUTED?** YES (`fixture-source not configured — … skipped`, never PASS).
13. **Git 2.45.4 exact and unrelaxed?** YES in product; provisioning download needs a checksum/version assertion (SIR-PS6-003).
14. **Pi 0.83.0 policy unchanged?** YES.
15. **Gateway authority/MCP surfaces unchanged?** YES (no authority, server, or tool-surface change; nine-tool surface intact).
16. **pi-guard unchanged?** YES.
17. **Remote CI execution recorded as NOT PERFORMED?** YES.

## 23. External evidence still required

- Remote Lane A/B/C CI execution (repo creation + Actions authorization — human-gated).
- Lane B real-stack run with a configured fixture source (component remotes/approved fixture location).
- Physical macOS arm64 UAT (Lane D) — install → add → Pi 0.83.0 + pi-guard → doctor → start/Gateway → (PS-7) tunnel/ChatGPT → PS-8 zero-state journey.
- Reviewed ADR addendum for per-lane POUV2 oracles (SIR-PS6-001 correction precondition).

## 24. Exact Git status (end of review)

- **pi-shuttle** (master @ `42c1e5b3…`): 9 modified + 10 new files, all uncommitted/unstaged; no commits; no remote; plus this review report once saved.
- **Gateway** (main @ `7f3b4afd…`): 11 modified source + 3 modified tests + 4 new files (ADR-042, containment test, report) uncommitted/unstaged; WP-13D debris untouched; no remote.
- **pi-guard** (main @ `7a7580cc…` = v0.1.2): unchanged; pre-existing review docs untouched.
- This review modified nothing in any repository. **The report file could not be physically created in this read-only review mode** — the content above is the exact report to be saved to `docs/reports/pi-shuttle-ps-6-macos-ci-senior-review.md`, uncommitted and unstaged, by the next write-capable step.

## 25. Verdict rationale

All production/architecture deltas are correct, in-envelope, and honest (lanes, operand retention, single observation boundary, cross-lane fail-closed, APFS/no-normalization, refusal honesty, fixture-gating, pins verified). One mandatory review conclusion (§6) requires correction: the darwin conformance lane cannot pass its authoritative suite as committed, and the current test converts the 9-failure state into the expected outcome. Four focused, small, in-envelope corrections (POUV2 per-lane oracles + reviewed ADR addendum; fixture-source input validation; git tarball checksum/version assertion; APFS skip surfacing) plus two minor tests/one comment close the gap. PS-6 remains open for remote Lane B CI and physical Lane D evidence regardless.

`PS-6 SENIOR REVIEW — CORRECTIONS REQUIRED`
