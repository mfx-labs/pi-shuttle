# PS-6 — GitHub Email-Privacy Baseline Remediation

**Classification of the observed blocker:**
`CI/INFRASTRUCTURE — NOT A PRODUCT DEFECT`

## Event record

1. GitHub push rejected BEFORE any workflow execution:
   `remote: push declined due to email privacy restrictions` — the
   account-level "Block command line pushes that expose my email"
   protection rejected the commit author/committer email. The private
   email address itself is NOT recorded in this report (redacted).
2. The blocker was classified CI/INFRA (no product bytes involved); the
   account email-privacy protection was NOT disabled.
3. The replacement commit uses the HUMAN-established GitHub noreply
   identity `mfx-labs <mfx-labs@users.noreply.github.com>` — the exact
   author/committer identity the operator already uses on pushed pi-guard
   releases (pi-guard `main` HEAD `7a7580cc…` on GitHub is authored and
   committed with this address), so it is a recorded human-supplied
   identity, never a guessed numeric address.

## Old vs new

| Fact | Value |
|---|---|
| OLD reviewed implementation SHA | `1b3c2469660fb088d5466a14363690538bde0c22` |
| OLD tree object | `41b3ece27813fd19e0a491fac296a3765a2e4d7d` |
| OLD parent | `42c1e5b3bd53c5b922b9635c86ecdceb123c9847` |
| NEW privacy-safe SHA | `be959560c6da96615b869a61cdcaf0e91b1df8fd` |
| NEW tree object | `41b3ece27813fd19e0a491fac296a3765a2e4d7d` |
| NEW parent | `42c1e5b3bd53c5b922b9635c86ecdceb123c9847` |
| Subject (both) | `feat: add macOS arm64 product lane` |
| Author/committer (new) | `mfx-labs <mfx-labs@users.noreply.github.com>` |

## Proofs (executed)

- `new^{tree} == old^{tree}` → **TREE IDENTITY: IDENTICAL**
- `git diff --exit-code 1b3c246…^{tree} be95956…^{tree}` → **ZERO content
  difference** (exact tree-object equality, so no test rerun is claimed —
  the new SHA is tree-equivalent to the previously accepted
  implementation, not independently re-tested)
- `new^ == 42c1e5b3bd53c5b922b9635c86ecdceb123c9847` → parent unchanged
- commit subject/message byte-unchanged (metadata-only `--reset-author`
  amend; no file edited, no new content staged)
- committed Gateway provenance pin remains exactly
  `1a454b61241ca23a638c3083e2e7d28e28f86b18` (verified in the new
  commit's tree); pi-guard pins unchanged (`v0.1.2`
  @ `7a7580cc4cbd7926797564c72269394fc29a860a`)
- **Product change: NONE.** No production bytes, modes, or content
  differ.

## State

- Repository-local identity now `mfx-labs <mfx-labs@users.noreply.github.com>`
  (repository-local only; global config untouched).
- This report is deliberately NOT folded into the rewritten commit (it
  would change the tree); it remains uncommitted/unstaged.
- `REMOTE CI EXECUTION` remained `NOT PERFORMED` before this remediation;
  the push retry resumes the already authorized remote CI evidence gate.

`PS-6 GITHUB PRIVACY REMEDIATION — COMPLETE; REMOTE CI RETRY AUTHORIZED`

## Push retry outcome (appended after the retry)

- The push of the privacy-safe SHA SUCCEEDED: remote `master` on
  `mfx-labs/pi-shuttle` = `be959560c6da96615b869a61cdcaf0e91b1df8fd`
  (normal push; no tag/release/publication).
- The push auto-triggered the three committed workflows; ALL THREE were
  rejected by GitHub at workflow-file validation with zero jobs
  materialized (run IDs 31661831839 / 31661831198 / 31661832535).
- Remote validation revealed workflow-file defects confined to the CI
  files (bare-SHA `uses:` form, workflow-level `inputs` env, real-stack
  `if:` gate) — classified CI/INFRA, NO product bytes involved, nothing
  patched in this gate (see `pi-shuttle-ps-6-remote-ci-evidence.md`,
  findings PS6-CI-002/003/004).
- REMOTE CI EXECUTION remains NOT PERFORMED; the remote CI evidence gate
  stands at `PS-6 REMOTE CI — CORRECTIONS REQUIRED` pending a workflow
  correction gate.
