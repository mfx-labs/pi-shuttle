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
