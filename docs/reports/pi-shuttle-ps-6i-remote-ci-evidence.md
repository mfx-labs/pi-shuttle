# PS-6I — Remote Evidence: Authoritative History Reattach + Publication

Status: publication complete; Lane A/B/C remote evidence observed green.
Date: 2026-08-13.

## 1. Authoritative remotes established

| Remote | Expected | Observed | Result |
|---|---|---|---|
| `mfx-labs/pi-shuttle` master HEAD | `5efff90e932547caf442777d09f3fb4e9423a2f9` | `5efff90e932547caf442777d09f3fb4e9423a2f9` | no drift |
| `mfx-labs/project-gateway` origin/main (pre-push) | `28f1d3a12382bc145376c8d8a2d87d89495785ec` | `28f1d3a12382bc145376c8d8a2d87d89495785ec` | verified |

Observation note: this host reaches `mfx-labs/pi-shuttle` through git
smart-HTTP using the macOS keychain GitHub credential for the
repository-owning account (web/API surface is 404 without it). CI runs
were observed through the authenticated Actions API; no secret is
recorded in this report.

## 2. History relationship

`git merge-base --is-ancestor 5efff90e 251bcae` → **false**; `git
merge-base 5efff90e 251bcae` → **no common ancestor**. The archive-derived
local chain (`2acc8183 → e631bd52 → 57b74ac → 251bcae`) was classified as
**archive-derived patch history**. It was never forced onto remote master.

## 3. Archive baseline equivalence

`git diff --stat 5efff90e 2acc8183` → **0 files, 0 lines**: the tracked
tree of the archive-derived baseline is **byte-identical** to the
authoritative remote baseline. Product/source baseline equivalence proven;
no divergence stop was triggered.

## 4. Reapplication onto authoritative history

Fresh branch at `5efff90e…`; the PS-6I deltas were cherry-picked
(preserving the exact reviewed content):

| Reviewed (archive chain) | Reattached (authoritative chain) |
|---|---|
| `e631bd52` PS-6I implementation | `5b0e60debcfdc09e9b0e6d5426389d93cbbad9a3` |
| `57b74ac` workflow rename | `afd7f75ebf6d22ee22788e54e43a78eaea754e96` |
| `251bcae` reports | `3234b9f27aae50dad913819f1d747f25560be22d` |

Final-tree comparison against reviewed `251bcae`: **byte-identical except
the two evidence reports' history/provenance references**, which were
updated to the new authoritative chain (16 insertions / 12 deletions in
`docs/reports/pi-shuttle-ps-6i-macos-intel-{implementation-report,
focused-review}.md`). No substantive product diff; no focused review stop
was required.

## 5. Gateway publication

- Local `55f764290a4567a20557f1db19d2a6fb97572a97` parent =
  `28f1d3a12382bc145376c8d8a2d87d89495785ec` (direct normal descendant).
- Pushed by normal fast-forward: `28f1d3a..55f7642 main -> main`.
- Re-fetch: public main = **`55f764290a4567a20557f1db19d2a6fb97572a97`**
  (== reviewed commit). No force/tag/release.

## 6. Gateway provenance synchronization

Every active pin location on the reattached chain points at the
now-public `55f76429…`:

- `src/compat/manifest.ts` `GATEWAY_PS1_BASELINE_COMMIT` ✓
- `scripts/prepare-fixtures.sh` `GATEWAY_COMMIT` ✓
- Lane B + Lane C workflows: `GATEWAY_COMMIT` env + checkout `ref:` ✓
  (Lane A is the self-contained Linux regression lane with no Gateway
  pins — pre-existing design)
- exact-pin tests: `tests/unit/manifest.test.ts` (2 assertions),
  `tests/unit/ci-workflow-security.test.ts` ✓

Remaining `28f1d3a…` references are historical superseded-pin comments
only (historical evidence remains historical).

## 7. Focused verification (transplant preservation)

- pi-shuttle: `npm ci` + `npm run build` + `npm run typecheck` clean;
  manifest/workflow-security/host tests **15/15 pass**;
  `git diff --check 5efff90e HEAD` → clean.
- Gateway: published tree == reviewed `55f76429` (same commit object);
  `git diff --check` → clean.
- Physical Intel UAT and broad regressions were NOT rerun (reusing the
  accepted local physical/focused evidence; the transplanted content is
  byte-equivalent in behavior).

## 8. Authoritative pi-shuttle history

Normal commits on top of `5efff90e…` (logical separation preserved):
implementation `5b0e60d`, workflow rename `afd7f75`, evidence reports
`3234b9f`. The archive-derived SHAs remain local evidence ancestry only.

## 9. Push

`git push origin ps6i-reattach:master` → `5efff90..3234b9f` (normal
fast-forward, no force). Re-fetch: local chain == remote master
`3234b9f27aae50dad913819f1d747f25560be22d`; parent = `afd7f75`; the
authoritative baseline `5efff90e` is an ancestor of remote master.

## 10. Remote CI — observed runs (push @ `3234b9f2`)

| Lane | Run ID | Result |
|---|---|---|
| Lane A — Linux x86_64 regression | `31699150200` | **success** |
| Lane B — macOS arm64 evidence | `31699150163` | **success** |
| Lane C — macOS Intel evidence | `31699150153` | **success** |

### Lane C (SUPPORTED real-stack lane, run `31699150153`)

Build + tests job (`94443775935`, macos-15-intel):

- `uname -m` = `x86_64`; `test "$(uname -m)" = "x86_64"` green.
- Node arch ASSERTED: `test "$(node -p process.arch)" = "x64"` green
  (native Intel, not emulation).
- Exact CI Node baseline: `node-v22.23.2-darwin-x64.tar.gz` SHA-256
  pinned (`58e99022…`, `shasum -c` OK).
- Full suite: **228 tests, 225 pass, 0 fail** (3 truthful skips).
- **APFS evidence: PASS — 3 evidence tests executed and passed (case
  variant, Unicode NFC/NFD, symlink alias; one filesystem object ⇒ at
  most one registration) on darwin** (mandatory step, no silent skip).
- npm-pack direct-exec evidence: `packed dist/cli.js executes directly
  on darwin Intel x64`.
- Exact CI Git baseline: `GIT_VERSION = 2.45.4`; `git version 2.45.4`.

Real-stack job (`94444447529`):

- `fixture: gateway baseline verified (55f764290a4567a20557f1db19d2a6fb97572a97)` —
  **exact public Gateway PS-6I commit**.
- `fixture: pi-guard baseline verified (7a7580cc4cbd7926797564c72269394fc29a860a, v0.1.2)` —
  **exact pi-guard v0.1.2**.
- `real-stack: lane facts — node=darwin x64 nodeVersion=v22.23.2
  git=git version 2.45.4 pi=0.83.0` (exact CI evidence dependencies).
- `real-stack: fixture manifest commits match the repository-owned pins`;
  `real-stack: fixture digests verified against fixture-manifest.json`.
- Installer run 1 truthful PARTIAL → dependency materialization →
  `real-stack: installer COMPLETE (receipt: gateway + pi-guard
  installed-verified, digestVerified)`.
- `real-stack: pi list confirms the exact pi-guard source`.
- `pi-guard compatibility probe: PASS — guard command + required events
  (session_start, session_shutdown, before_agent_start, tool_call)
  verified through pi's own loader; tools at load: 0` (isolated Pi
  0.83.0 lane).
- `real-stack: lifecycle green (add → list → exact re-add → doctor →
  remove → re-add)` (doctor exit 0 asserted by the orchestrator; the job
  fails on any nonzero doctor exit or missing `platform: supported`).
- `MCP handshake OK: initialize + exactly 9/9 tools verified, clean EOF
  exit 0` — real installed Gateway start.
- `real-stack: LANE C REAL-STACK EVIDENCE — GREEN`.

### Lane B (unchanged, run `31699150163`)

- `Image: macos-15-arm64`; `uname -m` = arm64; node arch ASSERTED arm64;
  Node 22.23.2 arm64 SHA-pinned; full suite 225 pass / 0 fail; **APFS
  evidence: PASS (3/3)**.
- Real-stack: `fixture: gateway baseline verified (55f76429…)` (Lane B
  now composes the PS-6I Gateway); node=darwin arm64 v22.23.2, git
  2.45.4, pi 0.83.0; installer COMPLETE; pi-guard probe PASS; MCP 9/9;
  `LANE B REAL-STACK EVIDENCE — GREEN`.

### Lane A (unchanged, run `31699150200`)

Completed **success** (self-contained Linux x86_64 regression lane).

## 11. Verdict

Authoritative history reattached (no force push; archive-derived chain
retained as local evidence ancestry), Gateway published at the exact
reviewed SHA, pi-shuttle published normally on top of the exact
authoritative baseline, and Lane A/B/C are all green with Lane C running
as the SUPPORTED macOS Intel real-stack lane.

PS-6I REMOTE EVIDENCE — ACCEPTED
