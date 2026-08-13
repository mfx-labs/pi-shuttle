# PS-6 — pi-shuttle macOS arm64 Host Lane + CI Foundation Implementation Report

**Gate type:** PS-6 implementation gate (readiness verdict `READY`).
All changes uncommitted and unstaged in both modified repositories; no
push/tag/publish/deploy; no remotes configured or changed; no remote
GitHub Actions execution. pi-guard untouched.

---

## 1. Baselines (verified before mutation)

| Repo | Expected | Observed |
|---|---|---|
| pi-shuttle (`master`) | `42c1e5b3bd53c5b922b9635c86ecdceb123c9847` (`docs: close pi-shuttle PS-5 Linux E2E`) | identical |
| Gateway | `7f3b4afdb43704e7dac82da7b086d8367347c641` | identical |
| pi-guard | `v0.1.2` @ `7a7580cc4cbd7926797564c72269394fc29a860a` | identical |

Pre-existing untracked debris recorded and untouched: pi-shuttle — the
PS-6 readiness analysis report (previous gate artifact); Gateway — WP-13D
entries (report + `src/retrospective/` + 2 test files); pi-guard — 8
v0.1.1 review/release docs.

## 2. Readiness decisions consumed

- Gateway host-lane parameterization is mechanical (operand already
  exists; closed accepted-lane set + CLI-boundary threading).
- Identity stays sha256(canonical root); no case-fold or Unicode
  normalization introduced anywhere; realpath canonicalization closes the
  APFS case/Unicode collision space.
- Default case-insensitive APFS supported; fixed-lowercase store layout;
  probe records `caseSensitive:false` without failing.
- Cross-lane replay fails closed by the existing lane-bound
  `configurationIdentity` binding.
- Git 2.45.4 is an exact runtime requirement (Gateway `wrong-version`
  fail-closed), operator-provisioned, PATH-discovered.
- Pi 0.83.0 + pi-guard v0.1.2 are platform-neutral (WASM-only native dep;
  pure-TS extension) — macOS arm64 CI install feasible.
- GitHub-hosted arm64 runners are real (`macos-15` arm64; `macos-15-intel`
  explicit Intel); execution remains human-gated.
- CI real-stack jobs are fixture-gated with truthful skip.

## 3. Exact Gateway changes (summary; details in the Gateway report)

`src/trusted/host-lane.ts` (closed two-member set + `TrustedHostLane` type
+ `trustedHostLaneForPlatformArch` pure mapping), `src/trusted/types.ts`
(lane union), `src/trusted/validate.ts` (validated configuration retains
the validated operand), `src/trusted/containment-validate.ts` (closed
predicate), `src/trusted/index.ts` (exports), `src/runtime/mcp/cli.ts`
(single CLI-boundary derivation, exit 2 on unsupported hosts),
`src/bootstrap/run.ts`, `src/control-plane/storage-bootstrap-action.ts`
(required `hostLane` operand), `src/runtime/mcp/lanes.ts`,
`src/runtime/mcp/compose.ts` (threaded; default Linux for existing direct
callers), `src/conformance/runner.ts` (explicit lane option), new
`docs/decisions/ADR-042-…md`, runbook host-lane wording, focused tests.

## 4. Gateway host-lane threading

One shared pure mapping (`trustedHostLaneForPlatformArch`) consumed only
at the operator CLI boundary (`src/runtime/mcp/cli.ts`); the trusted core
remains ambient-probe-free. Bootstrap (`runBootstrapCommand(argv, lane)`)
and runtime/start (`composeTrustedRegistry(config, {}, lane)`) receive the
same derivation, so bootstrap identity == start identity per machine.
Unsupported hosts (darwin-x64, win32, unknown) exit 2 before any
validation. `hostLane` is never an operator runtime-config field.

## 5. Identity / cross-lane replay tests (Gateway)

- Validator: both accepted lanes validate; the validated configuration
  carries the actual lane; identity digests differ across lanes for
  identical inputs.
- Bootstrap: linux-lane store replayed under darwin-arm64 → fail closed
  (`ERR-STO-INTEGRITY` / FOREIGN aggregate), store metadata byte-identical,
  no repair/migration; own-lane replay afterwards still green.
- Containment: both accepted lanes pass the same contract; branded
  unsupported-lane config fails TCP-011; unbranded clone fails TCP-021.
- Conformance: darwin-arm64 runner operand executes the full corpus; the
  only divergence is exactly the 9 POUV2 fixtures whose oracles embed
  linux-lane identity digests (lane-bound identity by design).

## 6. Gateway ADR

`docs/decisions/ADR-042-darwin-arm64-trusted-host-lane-and-apfs-compatibility.md`
— records only the human-approved/resolved decisions (accepted set;
Intel unsupported; default APFS supported; no normalization; canonical
filesystem identity; fixed lowercase layout; dev/ino namespace identity;
identity-bound lane; cross-lane fail-closed; probe case record;
probe-based fsync/no-follow/exclusive-create evidence; JCS/Unicode
unchanged). Gateway runbook host-lane wording updated; unrelated contracts
untouched.

## 7. Exact pi-shuttle changes

- `src/compat/manifest.ts` — darwin-arm64 promoted: `supportedLanes =
  [linux-x86_64, darwin-arm64]`, `gatedLanes = []`.
- `src/installer/preflight.ts` — platform-lane message generalized
  (supported-lanes list; gated wording removed); darwin+x64 stays refused.
- `src/command/doctor.ts` — darwin-arm64 Node-architecture probe (below);
  platform claim now manifest-bound to both supported lanes.
- `src/host/environment.ts` — unchanged (mapping was already correct).
- Tests updated/new: `manifest.test.ts`, `installer-preflight.test.ts`,
  `doctor.test.ts`, `lifecycle.test.ts`, `start.test.ts`,
  `apfs-path-evidence.test.ts` (new).
- `README.md` — supported-lanes status row updated (status/evidence row
  only; contract semantics unchanged).
- `.github/workflows/lane-{a,b,c}*.yml` (new, local only).
- `scripts/prepare-fixtures.sh`, `scripts/ci-lane-b-real-stack.sh`,
  `scripts/pi-extension-load-probe.mjs`, `scripts/mcp-handshake-probe.mjs`
  (new).

## 8. Manifest promotion

`darwin-arm64-posix-utf8-node22` moved gated → supported. Final claims:
supported = linux x86_64 + darwin arm64; unsupported = darwin x64/Intel,
Windows, unknown lanes (installer refuses / doctor exit 2). No other lane
broadened; Linux claim unchanged.

## 9. darwin Node-architecture probe

Doctor-only (contract §3.9: "arch mismatch fails closed in doctor"): on
`platform=darwin && arch=arm64` only, a second read-only argv-safe probe
(`node -p process.arch`) runs through the existing process boundary.
Verdicts use the closed vocabulary: arm64 → `supported` (arch fact in the
detail); non-arm64 (Rosetta/x64) → `unsupported` (exit 2); unobservable →
`installed but unverified`. Linux behavior is untouched (tested: no arch
probe on linux).

## 10. APFS evidence implementation

No case-folding/normalization implementation — only evidence tests over
the existing canonicalization model (`tests/unit/apfs-path-evidence.test.ts`):
- symlink alias → one canonical project, one identity, one registration
  (host-independent);
- case variant (`Project` vs `project`) — darwin only; asserts same
  realpath, same dev+ino, one identity, exact-replay dedupe; a
  case-sensitive CI volume records the fact and skips only the alias
  assertion truthfully (never a product failure);
- Unicode NFC/NFD spelling — darwin only; one filesystem object → one
  identity via realpath; no string normalization anywhere.

## 11. CI Lane A — `lane-a-linux-regression.yml`

`ubuntu-24.04`; exact Node 22.23.2 linux-x64 (nodejs.org tarball,
SHA-pinned `d60acfe0…`); `npm ci` (lockfile); build; typecheck; full
self-contained suite (fixture-based — no secrets/external artifacts);
npm-pack executable regression (PS5-LINUX-001 release-shaped direct
exec); `git diff --check`. The full manual PS-5 E2E is not re-run by
default.

## 12. CI Lane B — `lane-b-macos-arm64.yml`

`macos-15` (GA arm64 image; verified `uname -m` = arm64); exact Node
22.23.2 darwin-arm64 (SHA-pinned `61130f39…`; `process.arch` = arm64
asserted); npm ci/build/typecheck/full suite (APFS evidence runs as real
default-APFS tests); npm-pack + direct exec; exact Git 2.45.4 user-scope
source build (origin/version/path recorded; stock `/usr/bin/git` never
sufficient); volume case-sensitivity record; then the fixture-gated
real-stack job (§14) and a fixture-gate report job.

## 13. CI Lane C — `lane-c-macos-intel-compat.yml`

`macos-15-intel` (explicit Intel label); exact Node 22.23.2 darwin-x64;
npm ci; build/typecheck (static portability); selected unit tests
(manifest/host/registry/persistence/config/preflight/APFS-skips);
npm-pack static package check; **installer refusal honesty** (darwin-x64 →
UNSUPPORTED, exit 2, no receipt) and **doctor refusal honesty**
(`platform: unsupported`, exit 2). No installer/product runtime steps; no
support claim is made or advertised.

## 14. Fixture-source policy

Real-stack jobs MUST NOT pretend to run without provenance: Lane B's
`real-stack` job runs only when `workflow_dispatch` input
`fixture_source` is configured; otherwise a report job prints
`fixture-source not configured — real-stack integration subsection skipped`
(never PASS), while all self-contained jobs still run. Fixtures are
SHA-pinned against `fixture-manifest.json` (prepared by
`scripts/prepare-fixtures.sh` from exact local clean checkouts — Gateway
`7f3b4af…`, pi-guard `v0.1.2@7a7580cc…`; fails closed on baseline
mismatch; no arbitrary cloning/publication/sudo/global install). Fixture
acquisition is test/CI only; the production installer never acquires
component source remotely.

## 15. Git 2.45.4 provisioning

Unchanged Gateway requirement (exact 2.45.4; `wrong-version` fails
closed). Lane B provisions a user-scope source build
(`git/git@v2.45.4` tarball, no sudo, no system replacement), records
origin/version/path, and places it first on PATH. Product discovery stays
PATH-based.

## 16. Pi 0.83.0 / macOS evidence design

Lane B real-stack job provisions an isolated
`@earendil-works/pi-coding-agent@0.83.0` lane in runner temp (no real
user Pi state, no provider auth): `pi --version` = 0.83.0; pi-guard
installed from the exact fixture source; exact `pi list` line
verification; extension-load probe (`scripts/pi-extension-load-probe.mjs`,
pi's own loader, `load errors: NONE`, `/guard` registered) — the PS-5
methodology on the darwin lane.

## 17. Local workflow validation

- YAML parses (all three files; jobs/permissions inspected).
- Every `uses:` is a full commit SHA (`actions/checkout` v4.2.2 =
  `11bd71901bbe5b1630ceea73d27597364c9af683`, verified against the
  upstream tag).
- `permissions: contents: read` everywhere; no release/npm
  publish/deployment steps; no GITHUB_TOKEN usage; no sudo; no untrusted
  PR interpolation (the only `${{ inputs.* }}` use is a quoted
  workflow_dispatch URL, not PR-controllable).
- Runner labels match the readiness design (ubuntu-24.04 / macos-15 /
  macos-15-intel).
- All referenced scripts exist, are `bash -n`/`node --check` clean, and
  run locally (fixture prep, probes, real-stack orchestrator).
- Lane C cannot accidentally claim support (refusal-honesty assertions +
  no runtime steps).

`REMOTE CI EXECUTION — NOT PERFORMED / HUMAN-GATED`

## 18. Tests and exact totals

pi-shuttle `npm test`: **194 tests / 192 pass / 0 fail / 2 skipped** —
the 2 skips are the darwin-only APFS case/Unicode tests skipping with
truthful reasons on the Linux host (on macOS arm64 they run → 194/194
expected). Historical 187/187 baseline preserved as a record, not pinned
in code. `npm run typecheck` clean; `npm ci --dry-run` green;
`git diff --check` clean (both repos). Gateway focused totals in the
Gateway report (trusted 576, bootstrap-action 17, conformance 17, runtime
53, storage 431+2 skip, storage-crash 5, mcp unit 0 fail).

## 19. Files changed (both repositories)

**Gateway:** `src/trusted/host-lane.ts`, `src/trusted/types.ts`,
`src/trusted/validate.ts`, `src/trusted/containment-validate.ts`,
`src/trusted/index.ts`, `src/runtime/mcp/cli.ts`, `src/bootstrap/run.ts`,
`src/control-plane/storage-bootstrap-action.ts`, `src/runtime/mcp/lanes.ts`,
`src/runtime/mcp/compose.ts`, `src/conformance/runner.ts`,
`tests/trusted/host-lane.test.ts`, `tests/unit/bootstrap-action.test.ts`,
`tests/integration/conformance.test.ts`, new
`tests/trusted/containment-host-lane.test.ts`, new
`docs/decisions/ADR-042-…md`, `docs/operations/project-gateway-operator-runbook.md`,
new `docs/reports/pi-shuttle-ps-6-gateway-host-lane-implementation-report.md`.

**pi-shuttle:** `src/compat/manifest.ts`, `src/installer/preflight.ts`,
`src/command/doctor.ts`, `tests/unit/manifest.test.ts`,
`tests/unit/installer-preflight.test.ts`, `tests/unit/doctor.test.ts`,
`tests/unit/lifecycle.test.ts`, `tests/unit/start.test.ts`, new
`tests/unit/apfs-path-evidence.test.ts`, new
`.github/workflows/lane-a-linux-regression.yml`,
`.github/workflows/lane-b-macos-arm64.yml`,
`.github/workflows/lane-c-macos-intel-compat.yml`, new
`scripts/prepare-fixtures.sh`, new `scripts/ci-lane-b-real-stack.sh`,
new `scripts/pi-extension-load-probe.mjs`, new
`scripts/mcp-handshake-probe.mjs`, `README.md`, new
`docs/reports/pi-shuttle-ps-6-macos-ci-implementation-report.md`.

## 20. Contracts left unchanged

`docs/product-contract.md`, `docs/component-boundaries.md`,
`docs/installation-contract.md`, `docs/operator-cli-contract.md`,
`docs/platform-support-contract.md`, `docs/test-and-release-plan.md`,
`docs/work-packages.md`, `docs/decisions/ADR-001-…md` — all untouched.
The darwin-arm64 promotion is the already-human-approved decision;
contract evidence rows (Lane B/D) remain pending evidence and are
recorded in this report, not rewritten in the contracts. Gateway
contracts/runbook beyond the directly affected host-lane wording
untouched. No CONTRACT ESCALATION required.

## 21. Deferred / environmental evidence

- Remote CI execution: human-gated (repository creation + Actions
  authorization); workflows written locally only.
- Lane B real-stack evidence: requires a fixture source (component
  remotes or an approved fixture location — external authorization);
  truthful skip otherwise.
- Physical macOS arm64 UAT (Lane D): install → project add → Pi 0.83 +
  pi-guard → doctor → start/Gateway → later PS-7 tunnel/ChatGPT → PS-8
  zero-state journey. **Not claimed from GitHub-hosted CI.** PS-6
  implementation is READY FOR REVIEW before Lane D executes; PS-6 must
  not be declared final release-ready from local Linux development alone.
- Gateway dependency materialization (PS5-LINUX-003) is encoded in the
  Lane B real-stack script as the release-pipeline step.

## 22. PS5-LINUX-002/003 carry-forward

- `PS5-LINUX-002 — OPTIONAL HARDENING` (npm-pack 0775 component dirs):
  unchanged; same artifact-shape behavior expected on macOS; 0700 parent
  mitigation; no production change in this gate.
- `PS5-LINUX-003 — RELEASE-PIPELINE EVIDENCE`: unchanged classification;
  now encoded as a CI step (Lane B real-stack materialization), still not
  a product defect.

## 23. Exact Git status (end of gate)

- pi-shuttle (`master` @ `42c1e5b3…`): modified files + new files
  (above) — **uncommitted, unstaged**; plus the pre-existing untracked
  readiness report. No commits; no remotes.
- Gateway (@ `7f3b4af…`): 11 modified source files, 3 modified tests,
  ADR-042 + containment test + implementation report new — **uncommitted,
  unstaged**; pre-existing WP-13D untracked debris untouched.
- pi-guard (@ `7a7580cc…` = `v0.1.2`): **unchanged** (zero source
  changes; pre-existing untracked review docs untouched).
- No push / tag / publication / deployment / remote CI execution.

## 24. Readiness verdict

All implementation deltas from the readiness analysis are implemented
exactly, tested, and within the approved envelope: Gateway host-lane
parameterization (mechanical, ADR-042 recorded), cross-lane replay
fail-closed pinned by tests, manifest promotion with refusal semantics
intact, darwin Node-architecture probe with the closed vocabulary, APFS
path-evidence tests over the existing canonicalization model, CI
workflows written locally with full-SHA pins, minimal permissions, no
secrets, no publication, and a truthful fixture-source gate. pi-guard
requires no source change (verified). No contract escalation was
required. Environmental evidence (remote CI execution, Lane B real-stack
run, physical Lane D UAT) remains human-gated/deferred and is reported
truthfully, never fabricated.

`PS-6 MACOS ARM64 + CI — READY FOR SENIOR REVIEW`
