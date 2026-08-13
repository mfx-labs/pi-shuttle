# PS-6 — Remote CI Workflow — FOCUSED REREVIEW (PS6-CI-002/003/004)

**Review mode:** READ-ONLY focused rereview of the workflow correction
`fix: correct PS-6 GitHub Actions workflows` (local working tree, before
commit/push). Prior remote evidence preserved in
`pi-shuttle-ps-6-remote-ci-evidence.md` (runs `31661831839` /
`31661831198` / `31661832535` — all zero jobs, workflow-file validation
failures; never rewritten as executed tests).

## Corrections under review

- **PS6-CI-002 (CRITICAL):** every remote `uses:` now uses the
  `owner/repository@FULL_40_HEX_SHA` form
  (`actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683`, the
  reviewed v4.2.2 commit). The static validator now REQUIRES
  `owner/repo@40-hex` (exactly one `@`; valid identity; exactly 40 hex)
  and rejects the exact bare-SHA form that failed remote validation,
  with regression cases.
- **PS6-CI-003 (MAJOR):** the workflow-level `env:` block referencing
  `inputs.fixture_source` is REMOVED. The input crosses only the narrow
  job-level `env:` boundary of the consuming `real-stack` job, and the
  report job derives state from `needs.real-stack.result` (no `inputs`
  reference at all).
- **PS6-CI-004 (MAJOR):** the real-stack gate is now
  `if: ${{ github.event_name == 'workflow_dispatch' && inputs.fixture_source != '' }}`
  — an explicit event requirement; push/PR and empty-input dispatch can
  never activate the fixture path.

No product runtime code changed. No Gateway/pi-guard change. No
tag/release/publication.

## Mandatory answers

1. **Every remote `uses:` is `owner/repo@full-40-sha`?** YES — all four
   `uses:` entries across the three workflows are
   `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683`.
2. **No bare SHA `uses:` remains?** YES — verified by the updated static
   validator (`isValidRemoteActionRef` requires the `owner/repo@` form).
3. **Static validation now rejects the exact syntax that caused the three
   GitHub failures?** YES — the committed test previously ASSERTED the
   invalid bare-SHA form (`!ref.includes('@')`); it now requires
   `owner/repo@40-hex` and includes the regression cases: bare SHA →
   FAIL; `actions/checkout@<40-sha>` → PASS; `actions/checkout@v4` →
   FAIL; `actions/checkout@main` → FAIL; malformed/multiple `@` → FAIL
   (plus short-SHA, non-hex, missing identity, empty ref).
4. **No workflow-level `inputs.*` context remains?** YES — Lane B has no
   workflow-level `env:`; a regression test scans for 2-space-indented
   `env` values referencing `inputs.` and asserts none exist.
5. **Lane B real-stack requires `workflow_dispatch` explicitly?** YES —
   `github.event_name == 'workflow_dispatch'` is part of the job `if:`,
   pinned by a regression test.
6. **Normal push cannot activate real-stack?** YES — the event gate
   excludes push/PR; the report job then truthfully reports
   `fixture-source not configured — … NOT EXECUTED`.
7. **Empty fixture source remains NOT EXECUTED rather than PASS?** YES —
   the gate requires `inputs.fixture_source != ''`; the report job maps a
   skipped real-stack job to NOT EXECUTED (never PASS).
8. **Invalid fixture source fails before curl?** YES — unchanged
   SIR-PS6-002 boundary: `bash scripts/ci-validate-fixture-source.sh
   "$FIXTURE_SOURCE"` runs BEFORE the fetch step and fails closed on any
   value outside the closed https URL policy (selftest + adversarial unit
   tests green in this rereview).
9. **fixture_source remains data rather than shell syntax?** YES — env
   variable only, `curl -fsSL -- "$FIXTURE_SOURCE"` argv-safe; no
   interpolation into `run:` text (static invariant).
10. **Lane A semantics unchanged?** YES — only the `uses:` form changed
    (identical checkout action + SHA); build/typecheck/tests/package
    steps untouched.
11. **Lane B self-contained semantics unchanged except parser/context
    fixes?** YES — build-test job steps are byte-identical except the
    `uses:` form; only the real-stack gate/env and report job were
    corrected.
12. **Lane C remains compatibility-only / Intel unsupported?** YES —
    only the `uses:` form changed; refusal-honesty steps unchanged.
13. **No product runtime code changed?** YES — no `src/**` change; only
    workflow files, the workflow static test, and comment wording in the
    fixture-source validator/its test (directly affected CI helpers).
14. **Gateway pin remains `1a454b61241ca23a638c3083e2e7d28e28f86b18`?**
    YES.
15. **Gateway/pi-guard unchanged?** YES — neither repository was touched.

## Local validation evidence (this rereview)

- YAML parses for all three workflows; Lane B has no top-level `env:`.
- `npm test`: **215 tests / 213 pass / 0 fail / 2 skipped** — the 2 skips
  are the pre-existing darwin-only APFS tests skipping truthfully on
  Linux (historical corrected baseline 212 with 2 skips → +3 new
  PS6-CI-002/003/004 regression tests).
- `bash scripts/ci-validate-fixture-source.sh --selftest`: green.
- `npm run typecheck`: clean. `npm ci --dry-run`: green.
  `git diff --check`: clean.
- Every `uses:` is `owner/repo@40-hex`; `permissions: contents: read`;
  no publish/release/deploy/sudo/token usage (static checks green).

## Verdict

The exact syntax that produced the three zero-job remote failures is
rejected by the corrected static validator, the parser-invalid workflow
contexts are removed, and the real-stack event gate is explicit. No
product code is implicated; nothing beyond the focused correction is
changed.

`PS-6 CI WORKFLOW FOCUSED REREVIEW — ACCEPTED`
