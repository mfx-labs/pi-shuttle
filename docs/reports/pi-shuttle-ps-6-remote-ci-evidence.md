# PS-6 — Remote CI Evidence Report

**Gate type:** REMOTE CI EVIDENCE GATE.
**Local baseline (privacy-safe):** pi-shuttle
`be959560c6da96615b869a61cdcaf0e91b1df8fd` — tree-identical to the
reviewed implementation `1b3c2469660fb088d5466a14363690538bde0c22`
(see the email-privacy remediation report). Gateway pin
`1a454b61241ca23a638c3083e2e7d28e28f86b18`; pi-guard `v0.1.2`
(`7a7580cc4cbd7926797564c72269394fc29a860a`) unchanged.
**Outcome:** push succeeded; all three committed workflows were triggered
remotely and ALL THREE failed at workflow-file validation with zero jobs
materialized. No lane executed a single step. No product code is
implicated. Per the gate, nothing was patched — the affected lanes are
stopped and classified.

---

## 1. Preflight (all passed)

| Check | Result |
|---|---|
| pi-shuttle HEAD exact | ✓ `1b3c2469660fb088d5466a14363690538bde0c22` (superseded by the privacy-safe `be95956…` in §2; tree `41b3ece2…` identical) |
| Working tree clean / nothing staged | ✓ |
| Gateway pin == `1a454b61241ca23a638c3083e2e7d28e28f86b18` | ✓ |
| pi-guard pins | ✓ `v0.1.2` @ `7a7580cc…`; repo unchanged |
| Three workflows committed | ✓ |
| permissions `contents: read`; no publish/release/deploy; no secrets | ✓ (static) |
| `uses:` refs full-SHA pinned | ✗ **FORM-INVALID**: bare 40-hex SHA without the required `owner/repo@` prefix (see PS6-CI-002) — this is the remote-revealed defect |

## 2. Repository and push

- Remote repository: `mfx-labs/pi-shuttle` (PRIVATE), default branch
  `master`, URL `https://github.com/mfx-labs/pi-shuttle.git`.
- Privacy-safe baseline pushed (normal push, no tag/release):
  local `master` = remote `master` =
  **`be959560c6da96615b869a61cdcaf0e91b1df8fd`** (author/committer
  `mfx-labs <mfx-labs@users.noreply.github.com>` — the human-established
  GitHub noreply identity; see the remediation report).
- The push auto-triggered all three committed workflows (event `push`,
  branch `master`).

## 3. Lane A — Linux regression

**NOT EXECUTED — workflow-file validation failure.**
Run ID `31661831839`, head `be95956…`, `completed/failure`, 0s, **zero
jobs**. GitHub's own message: "This run likely failed because of a
workflow file issue"; `gh run rerun` refused with "its workflow file may
be broken". No build, no typecheck, no test totals.

## 4. Lane B — macOS arm64 self-contained evidence

**NOT EXECUTED — workflow-file validation failure.**
Run ID `31661832535`, head `be95956…`, `completed/failure`, 0s, zero
jobs. No runner facts, no Node arch assertion, no Git provenance
assertion, no build/tests, no strict APFS evidence invocation, no Pi
0.83.0 evidence.

## 5. Lane B real-stack subsection

`REAL-STACK LANE B — NOT EXECUTED: fixture-source not configured`
(no approved exact fixture source was authorized) — and the subsection
could not run in any case because the workflow file itself never
validated.

## 6. Lane C — macOS Intel compatibility-only

**NOT EXECUTED — workflow-file validation failure.**
Run ID `31661831198`, head `be95956…`, `completed/failure`, 0s, zero
jobs. `macOS Intel remains unsupported` (claim unchanged; no evidence
collected).

## 7. Workflow security observation

No steps executed remotely, so there is no runtime security behavior to
observe (no secrets, no tokens, no sudo, no publication occurred — and
none could, since zero jobs materialized). The fixture-source adversarial
protection remains present in the committed workflow revision and would
be active once the workflow files validate.

## 8. CI findings

| ID | Severity | Class | Detail |
|---|---|---|---|
| PS6-CI-002 | CRITICAL | CI/INFRA | All three committed workflows use `uses:` with a BARE 40-hex SHA (`uses: 11bd71901bbe5b1630ceea73d27597364c9af683`) — GitHub requires the `owner/repo@ref` form (a SHA is only the `ref` portion). Every workflow file fails remote validation → zero jobs → instant failure of all lanes. Compounding: the committed static test `tests/unit/ci-workflow-security.test.ts` asserts `!ref.includes('@')`, which ENFORCES the invalid form. Correction (next gate): `uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683` (comment keeps the tag name) and fix the static test to require `^[A-Za-z0-9-]+/[A-Za-z0-9.-]+@[0-9a-f]{40}$`. |
| PS6-CI-003 | MAJOR | CI/INFRA | `lane-b-macos-arm64.yml` references the `inputs` context in a WORKFLOW-LEVEL `env:` block (`FIXTURE_SOURCE: ${{ inputs.fixture_source }}`) — the `inputs` context is not available at the workflow level (documented restriction) and further invalidates the Lane B file. Correction: move `FIXTURE_SOURCE` env to the `real-stack` and `fixture-gate-report` JOB level. |
| PS6-CI-004 | MAJOR | CI/INFRA | `lane-b-macos-arm64.yml` real-stack gate `if: ${{ inputs.fixture_source != '' }}` evaluates TRUE on push/PR events (empty inputs context → `null != ''`), so the fixture-gated job would run and fail on every push once the file validates. Correction: `if: ${{ github.event_name == 'workflow_dispatch' && inputs.fixture_source != '' }}`. |

No PRODUCT, SECURITY, INTEGRATION, or TEST/EVIDENCE findings: zero
product bytes are involved; the defects are confined to the workflow
files (and one static test) and were revealed by remote validation that
no local YAML parser could perform.

## 9. Acceptance

Lane A: NOT GREEN (not executed). Lane B self-contained: NOT GREEN (not
executed). Lane B mandatory APFS evidence: NOT EXECUTED. Lane C: NOT
GREEN (not executed). Remote CI evidence cannot be accepted while the
committed workflow files fail GitHub validation.

## 10. Repository state (end of this gate)

- pi-shuttle: HEAD `be959560c6da96615b869a61cdcaf0e91b1df8fd` (tree
  identical to `1b3c246…`); working tree carries only the uncommitted
  evidence/remediation reports (`pi-shuttle-ps-6-remote-ci-evidence.md`,
  `pi-shuttle-ps-6-github-email-privacy-remediation.md`); nothing staged.
- Remote: `mfx-labs/pi-shuttle` `master` = `be95956…` (the exact
  privacy-safe baseline; no further commits, no tags, no releases, no
  npm publication, no deployment).
- Gateway: unchanged `1a454b61241ca23a638c3083e2e7d28e28f86b18`; pi-guard:
  unchanged `7a7580cc…` = v0.1.2.
- No production patch was made in this gate (as mandated); the workflow
  corrections belong to a separate correction gate.

`PS-6 REMOTE CI — CORRECTIONS REQUIRED`

---

## 11. Workflow correction and authorized CI retry (PS6-CI-002/003/004)

The three zero-job runs above are preserved as historical evidence (§3–§6);
they were workflow-file validation failures and are NEVER rewritten as
executed tests.

### 11.1 Correction commits

| SHA | Subject | Content |
|---|---|---|
| `58e488cd96754967496de2afd0256da0520068f0` | `fix: correct PS-6 GitHub Actions workflows` | PS6-CI-002: every `uses:` is `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683` (owner/repo@full-40-hex); static validator rewritten to REQUIRE that form and REJECT the exact bare-SHA syntax that failed remotely (+ regression cases). PS6-CI-003: workflow-level `env:` with `inputs.*` removed; fixture source crosses only the real-stack job-level env boundary. PS6-CI-004: real-stack gate is `github.event_name == 'workflow_dispatch' && inputs.fixture_source != ''`; report job derives state from `needs.real-stack.result`. Rereview: `pi-shuttle-ps-6-remote-ci-workflow-focused-rereview.md` — ACCEPTED. |
| `3db0379fa73fc043f30b4b0538752c99f832ea74` | `fix: fail closed on duplicate filesystem object registration (PS6-MAC-001)` | Product finding surfaced by the EXECUTED Lane B APFS evidence (see §11.4): on real default APFS `realpath` preserves the input spelling of the final component, so case/Unicode variants of one directory produce different canonical strings and different identities. Added the dev+ino duplicate-object guard in `project add` (`ERR-PS4-REG-DUPLICATE-OBJECT`, fired before any store/directory creation) — the operator-cli-contract's already-mandated "fail closed on conflicting registration of the same root under a different identity". Test portability fix: lifecycle fixtures live on the canonical env spelling (`/var/folders` → `/private/var/folders`). |

### 11.2 Workflow validation result (retry)

**All three workflows passed GitHub workflow-file validation — jobs
created, runners allocated, steps executed.** No zero-job run occurred.

### 11.3 New run IDs (both correction SHAs)

| Lane | Run @ `58e488c` | Result @ `58e488c` | Run @ `3db0379` | Result @ `3db0379` |
|---|---|---|---|---|
| A — Linux x86_64 | `31662342309` | **success** (1 job) | `31662695369` | **success** (1 job) |
| B — macOS arm64 | `31662342304` | failure (see §11.4) | `31662695206` | **success** (3 jobs: build-test, real-stack skipped, gate report) |
| C — macOS Intel | `31662342284` | failure (same root causes) | `31662695294` | **success** (1 job) |

### 11.4 Findings from the first executed runs (at `58e488c`)

| ID | Severity | Class | Detail | Disposition |
|---|---|---|---|---|
| PS6-MAC-001 | CRITICAL | PRODUCT/INTEGRATION | Real default APFS evidence: `realpath` preserves the INPUT spelling of the final path component (case AND Unicode normalization). `/…/Project` and `/…/project` (and NFC/NFD spellings) resolve to one object with two canonical strings → two identities → `project add` could create duplicate registrations (duplicate authority) for one filesystem object. The PS-6 safe outcome requires fail-closed before duplicate authority. | **FIXED** at `3db0379`: dev+ino duplicate-object guard (`ERR-PS4-REG-DUPLICATE-OBJECT`) before any store/directory creation; identity formula and canonicalization unchanged; no normalization introduced. Live-verified on the runner (lifecycle test `ok 150` — case-variant re-add refused, exactly one registration, one store). |
| PS6-TEST-001 | MAJOR | TEST/EVIDENCE (portability) | Lifecycle tests derived expectations from the raw `os.tmpdir()` env (`/var/folders/…`) while the product canonicalizes roots (`/private/var/folders/…`) → 11 lifecycle tests failed on macOS only. Test-fixture defect, not a product defect (real `$HOME` on macOS is `/Users/…`, un-symlinked). | **FIXED** at `3db0379`: fixtures live on the canonical env spelling (no-op on Linux). |

### 11.5 Lane results at the correction baseline `3db0379`

**Lane A — Linux x86_64 regression (run `31662695369`):** GREEN.
Exact Node 22.23.2 (SHA-pinned) provisioned; `npm ci`; build; typecheck;
full suite **217 tests / 211 pass / 0 fail / 6 skip** (3 darwin-only
truthful skips + 3 SIR-PS2-009 Gateway-CLI-fixture skips — the pinned
local Gateway path is absent on runners, pre-existing environmental
skip class); npm-pack direct-exec regression green
(`pi-shuttle 0.1.0` direct exec); `git diff --check` clean.
**No PS5-LINUX-001 regression.** Actual job execution: 1 job, all steps
success.

**Lane B — macOS arm64 self-contained (run `31662695206`):** GREEN.
Runner verified arm64 (`uname -m`); exact Node 22.23.2 darwin-arm64
(SHA-pinned `61130f39…`), `process.arch` = arm64 ASSERTED; `npm ci`,
build, typecheck; full suite **217 tests / 214 pass / 0 fail / 3 skip**
(only the SIR-PS2-009 fixture-absent skips — all darwin evidence
EXECUTED); npm-pack + direct exec green; Git 2.45.4 digest-pinned
kernel.org source build with exact version assertion
(`git version 2.45.4`); volume case-sensitivity record step green.
**Lane B mandatory APFS evidence: PASS — 3/3 evidence tests executed
and passed on default APFS** (symlink alias; case variant with the
duplicate-object guard branch; Unicode NFC/NFD with the guard branch),
zero skips in the strict invocation. The real-CLI case-variant
duplicate-refusal test (`ok 150`) also passed on the runner.
**Real-stack subsection: NOT EXECUTED: fixture-source not configured**
(no independently authorized fixture source in this gate; none was
manufactured). The gate-report job truthfully printed the NOT EXECUTED
status; the real-stack job is `skipped` on the normal push, proving the
PS6-CI-004 event gate live.

**Lane C — macOS Intel compatibility-only (run `31662695294`):** GREEN
with the intended semantic: runner = `macos-15-intel` (x86_64); exact
Node 22.23.2 darwin-x64; build/typecheck/static package evidence;
selected unit tests; **installer refusal honesty (darwin-x64 →
UNSUPPORTED, exit 2, no receipt)** and **doctor refusal honesty
(darwin-x64 → unsupported, exit 2)** — both steps success.
Recorded explicitly: **macOS Intel — UNSUPPORTED** (compatibility-only
evidence; no support claim created).

### 11.6 Remote/local SHA relationship

- Old privacy-safe SHA: `be959560c6da96615b869a61cdcaf0e91b1df8fd`
  (first remote evidence baseline; all three original runs zero-job).
- Workflow-correction SHA: `58e488cd96754967496de2afd0256da0520068f0`.
- Product-correction SHA: `3db0379fa73fc043f30b4b0538752c99f832ea74`.
- Remote `mfx-labs/pi-shuttle` `master` == `3db0379fa73fc043f30b4b0538752c99f832ea74`
  (verified by `git ls-remote` after push).
- Gateway pin unchanged: `1a454b61241ca23a638c3083e2e7d28e28f86b18`.
- pi-guard unchanged: `7a7580cc4cbd7926797564c72269394fc29a860a` = `v0.1.2`.

### 11.7 Acceptance

Lane A: **GREEN**. Lane B self-contained incl. mandatory APFS evidence:
**GREEN** (first-class evidence for the corrected object-identity
invariant). Lane B real-stack: **NOT EXECUTED: fixture-source not
configured** (external fixture authorization required; not manufactured
in this gate). Lane C: **GREEN** (compatibility-only; macOS Intel
UNSUPPORTED). The original zero-job failures are preserved as
historical evidence and are not rewritten as executed tests.

### 11.8 Final classification

Workflow-file validation: PASS for all three lanes (jobs created, steps
executed — the exact failure mode of the original three runs is
eliminated and is pinned by the corrected static validator). Self-
contained Lane A, Lane B (incl. the mandatory strict APFS evidence), and
Lane C all GREEN at `3db0379…` with the intended refusal semantics.
The normative Lane B scope (installer batch, focused real-stack E2E)
remains fixture-gated and NOT EXECUTED pending an independently
authorized fixture source (none was manufactured in this gate), and the
evidence plan does not waive that subsection. Physical Lane D is not
declared completed.

`PS-6 REMOTE CI — PARTIAL EVIDENCE; FIXTURE AUTHORIZATION REQUIRED`

---

## 12. Lane B real-stack — fixture preparation (hosting boundary)

Gate: `PS-6 — MACOS ARM64 REAL-STACK CI EVIDENCE`. Baselines frozen:
pi-shuttle local == remote == `c3eb4fdce85122f890b0d1be6167a7019d9d46fd`
(clean tree); Gateway `1a454b61241ca23a638c3083e2e7d28e28f86b18`;
pi-guard `7a7580cc4cbd7926797564c72269394fc29a860a` = `v0.1.2`.
Pre-existing untracked debris recorded and untouched (Gateway WP-13D
entries; pi-guard v0.1.1 review docs). No component repository modified.

### 12.1 Fixture built through the committed helper

`scripts/prepare-fixtures.sh --gateway-checkout … --pi-guard-checkout …
--out /tmp/ps6-realstack-fixture` — verified exact Gateway HEAD, exact
pi-guard HEAD/tag, rejected dirty tracked state, built from scratch
clean clones (`npm ci` + `npm run build` + `npm pack`), produced the
artifacts and the fixture manifest, computed SHA-256 values.

| Component | Package | Version | Source commit/tag | Artifact SHA-256 |
|---|---|---|---|---|
| Gateway | `@project-gateway/artifact-core` (bin `project-gateway-mcp` → `./dist/runtime/mcp/cli.js`) | 0.1.0 | `1a454b61241ca23a638c3083e2e7d28e28f86b18` | `e211403b3b8bf3c4f6d47faba627d4f1dfaabd53b2775565466cf8a4c3134a8b` |
| pi-guard | `pi-guard` | 0.1.2 | `7a7580cc4cbd7926797564c72269394fc29a860a` = `v0.1.2` | `057f1b636328e8c77857a4b590d051fcc52c0c9b015ca5dd1a773c21d7d24d01` (identical to the PS-5 recorded digest — deterministic pack) |

Transport bundle (containing manifest + both artifacts):
`ps6-lane-b-fixtures-0.1.0.tgz`, bundle SHA-256
`54fec79447a6a8b16d334a4d7f6ca865bb5124074e3d624a06b812808599e0af`.

### 12.2 Fixture content inspection (before any placement)

- Gateway artifact: exactly the npm-pack shape for `files: ["dist"]` —
  507 members, all `package/dist/**` + `package/package.json`; identity
  verified `@project-gateway/artifact-core@0.1.0`.
- pi-guard artifact: exactly `package/{src,extensions/pi-guard/index.ts,
  package.json,LICENSE,README.md}` (12 members).
- No `.git`, no source-repository debris, no secrets/credentials, no
  `.env`/`.npmrc`/keys, no HOME state, no real Pi state, no unrelated
  files (member-level scan of both tarballs).
- Independent provenance verification: manifest commits/tags and every
  artifact SHA-256 recomputed from bytes — **ALL MATCH** (manifest
  gateway commit == `1a454b61…`; pi-guard commit == `7a7580cc…`, tag
  == `v0.1.2`).

### 12.3 Hosting boundary determination

The gate authorizes placement ONLY at the operator-authorized HTTPS
fixture source. Exhaustive local review found **no operator-authorized
HTTPS fixture destination/source**: no fixture URL is recorded in any
report or repository history, no storage/bucket configuration exists on
this host, and no prior fixture source was ever authorized (this
report's §5/§11.5 record `NOT EXECUTED: fixture-source not configured`
for the same reason). Per the gate instruction, the fixture was NOT
made public or placed by improvisation (no gist, no release, no new
repo, no access-control disabling, no npm publication).

**workflow_dispatch: NOT PERFORMED** (no run ID; the already-committed
Lane B workflow was not dispatched because no authorized fixture source
exists to reference).

### 12.4 State for the authorized continuation

- Local fixture ready at `/tmp/ps6-realstack-fixture/` (manifest +
  artifacts + bundle, SHA-256s above).
- On operator authorization of an HTTPS destination: place the bundle
  unchanged, dispatch the committed Lane B workflow with
  `fixture_source = <authorized URL>` (no workflow modification
  needed), then record run ID/job inventory/results in §12.5.

`PS-6 LANE B REAL-STACK — FIXTURE HOSTING REQUIRED`

---

## 13. PS-6 public multi-repo continuation — real-stack evidence (gate: `PS-6 — PUBLIC MULTI-REPO LANE B COMPOSITION`)

### 13.1 Gateway publication fact and governing pin decision

The Gateway repository `mfx-labs/project-gateway` is now PUBLIC, main ==
`98d1b204a864596bda91bec1104b8a8d5e89e1cd`. Per the gate's governing-rule
resolution (product-contract §6: "`gatewayCommit` pins the exact source
closure for the packaged artifact" — semantic A), the pi-shuttle
authoritative Gateway pin was updated from the pre-public
`1a454b61241ca23a638c3083e2e7d28e28f86b18` to the exact public source
commit `98d1b204a864596bda91bec1104b8a8d5e89e1cd` in
`src/compat/manifest.ts` (`GATEWAY_PS1_BASELINE_COMMIT`) and in
`scripts/prepare-fixtures.sh`. No Gateway/pi-guard source change; pi-guard
commit/tag `7a7580cc…` = `v0.1.2` unchanged; Pi policy unchanged 0.83.0;
macOS Intel remains unsupported.

### 13.2 New pi-shuttle commits (normal push, no force)

| SHA | Purpose |
|---|---|
| `dfe3c40280cca4c553aaeb28220c975fad3c454d` | correction: pins, multi-repo Lane B, helper fixes, rereview report, preserved §12 evidence |
| `83bf2bc0d60d87f6b007123c5338f40285f0845f` | correction follow-up: component checkout `path` under workspace (actions/checkout v4 rejects `runner.temp`) |
| `6b733b724e97544d5593fedcf975f03020e580f9` | correction follow-up: pi-guard checkout `fetch-depth: 0` so the v0.1.2 tag object is assertable |
| `afb609b0797e7f83f7956c92314dd8b596a149f6` | correction follow-up: `npm ci` in the real-stack job (per-job workspace) |

Final remote master == `afb609b0797e7f83f7956c92314dd8b596a149f6`.
(§12's earlier "fixture hosting required" state is superseded: temporary
hosting is no longer needed now that the components are public. The
historical record of the blocked state above is preserved.)

### 13.3 Remote run IDs (commit `afb609b`, push event)

| Lane | Run ID | Result |
|---|---|---|
| A — Linux x86_64 regression | `31665543829` | success (44s) |
| B — macOS arm64 evidence | `31665543802` | success (3m9s) |
| C — macOS Intel compatibility | `31665543851` | success (53s; Intel UNSUPPORTED semantic intact) |

Earlier correction-execution runs (same correction subject, prior SHAs):
`31664774964` (checkout-path failure), `31665228964` (tag-missing
failure), `31664994934` (fixture-gate passed; npm-ci failure), recorded as
the remote-driven correction evidence. Zero-job validation failure: none —
all workflows validated and executed jobs.

### 13.4 Lane B job inventory (run `31665543802`)

- Job `Build + tests (darwin arm64)` (ID `94339198558`) — 1m47s:
  arm64 runner assertion, exact Node 22.23.2 darwin-arm64 (arch
  ASSERTED), `npm ci`, build, typecheck, full suite 217 pass / 0 fail
  (3 truthful non-darwin skips absent on darwin; PS6-MAC-001
  duplicate-object tests included), **APFS evidence: PASS — 3 evidence
  tests executed and passed (case variant, Unicode NFC/NFD, symlink
  alias; one filesystem object ⇒ at most one registration) on darwin**,
  npm-pack direct-exec evidence, digest-pinned Git 2.45.4 build +
  exact version assertion, volume case-sensitivity record, clean-tree.
- Job `Real-stack integration (public multi-repo)` (ID `94339500407`) —
  1m13s: exact public component checkouts, HEAD assertions, fixture
  build, real installer → lifecycle → MCP → pi/pi-guard, GREEN.

### 13.5 Exact component checkout SHAs (asserted on the runner)

- Gateway: `git rev-parse HEAD` == `98d1b204a864596bda91bec1104b8a8d5e89e1cd` (public pin).
- pi-guard: `git rev-parse HEAD` == `7a7580cc4cbd7926797564c72269394fc29a860a` (v0.1.2 tag asserted at the pinned commit).

### 13.6 Generated fixture digests (run `31665543802`; deterministic)

| Component | Source commit | Artifact SHA-256 |
|---|---|---|
| Gateway | `98d1b204…` | `e41a3530face0f32fe78779363b4affb699a35b5d461a5dae7dac67ef9d7c1c9` |
| pi-guard | `7a7580cc…` = v0.1.2 | `057f1b636328e8c77857a4b590d051fcc52c0c9b015ca5dd1a773c21d7d24d01` |

The Gateway digest differs from the historical `e211403b…` (built from
the pre-public `1a454b61…`) because the public MIT/repository metadata
changed package.json bytes — expected, NOT a defect. The pi-guard digest
is byte-identical to the PS-5/§12.1 historical record. Both digests
matched the values produced in the local pre-push rehearsal on a
different host — deterministic packaging proven. Provenance chain proven
on the runner: exact public source → `npm ci`/build/pack →
fixture-manifest.json (commits == repository-owned pins, asserted) →
SHA-256 verified → installer `--expect-*-sha256` verified the same
bytes (`digestVerified: true`).

### 13.7 Real-stack results (run `31665543802`, job `94339500407`)

- Installer run 1 → truthful PARTIAL (dependency materialization pending);
  PS5-LINUX-003 exact-pin materialization
  (`@modelcontextprotocol/server@2.0.0`, `ajv@8.20.0`, `zod@4.4.3`);
  run 2 → **COMPLETE**, receipt: gateway + pi-guard both
  `installed-verified`, both `digestVerified: true`; pi 0.83.0 lane
  (isolated, no real user state); installed Gateway corresponds to the
  exact pinned public commit (receipt `commit` ==
  `98d1b204a864596bda91bec1104b8a8d5e89e1cd`).
- pi-guard: exact-source `pi list` confirmation (exact absolute source
  line, no substring); pi-guard extension load via pi 0.83.0's own
  loader: `load errors: NONE`, `registered commands: ['guard']`.
- Lifecycle on the installed executable: add → list → exact re-add
  (verification-replay) → **doctor exit 0** → remove (deregister-only)
  → re-add (verification-replay) — trusted store survives; GREEN.
- Real MCP through `pi-shuttle start` (primary product path):
  initialize, server identity `@project-gateway/artifact-core@0.1.0`,
  **exactly 9/9 public tools**, protocol-clean stdout, clean EOF,
  exit 0.
- No source/user-state mutation: isolated HOME under `runner.temp`,
  isolated Pi lane, clean scratch clones for packaging.

### 13.8 Corrections surfaced by actual remote execution

The real-stack path had never executed before (fixture hosting was
unavailable); first remote executions surfaced four mechanical defects,
each fixed in a same-subject correction commit and re-pushed normally:

1. `actions/checkout` v4 rejects a `path` outside `$GITHUB_WORKSPACE`
   → component checkouts moved under the workspace.
2. SHA-ref checkout with default `fetch-depth: 1` omits tag objects
   → pi-guard checkout uses `fetch-depth: 0` so the v0.1.2 tag is
   assertable by prepare-fixtures.sh.
3. The real-stack job has its own workspace → `npm ci` added before
   the build.
4. (Local rehearsal, same class) `pi list` prints the resolved absolute
   source line indented → whitespace-tolerant exact-line match; the
   CLI column-aligns `state:` values → whitespace-tolerant grep; the
   MCP probe sent an id-bearing notification colliding with the next
   request id → notification now carries no id (JSON-RPC-correct).

All were workflow/helper defects in pi-shuttle; no product or component
source change was involved.

### 13.9 Final remote CI verdict

Lane A (Linux x86_64 regression) GREEN; Lane B self-contained
(build/test/APFS/Node/Git) GREEN; Lane B real-stack (public multi-repo)
GREEN; Lane B APFS strict evidence PASS; Lane C GREEN (macOS Intel
UNSUPPORTED as designed).

`PS-6 REMOTE CI — ACCEPTED`
