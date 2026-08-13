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
