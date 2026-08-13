# pi-shuttle PS-6R — focused correction → focused rereview

Gate: `PS-6R — FOCUSED CORRECTION → FOCUSED REREVIEW → LOCAL BASELINE`.
Correction set executed: SIR-PS6R-001, SIR-PS6R-002, SIR-PS6R-003
(mandatory, from `pi-shuttle-ps-6r-runtime-compatibility-senior-review.md`,
verdict `CORRECTIONS REQUIRED`). SIR-PS6R-004 preserved as documented
residual risk. SIR-PS6R-005/-006/-007 NOT implemented (optional
hardening, deferred). No push/tag/release/publication/deployment;
pi-guard untouched.

Baselines re-verified at gate start:

- pi-shuttle local HEAD `2076575efb7e8d9d7aeaff8f4bfafb7df3e965e8` == expected;
- Gateway local HEAD `98d1b204a864596bda91bec1104b8a8d5e89e1cd` == expected;
- pi-guard `7a7580cc4cbd7926797564c72269394fc29a860a` = `v0.1.2`, tracked
  tree clean (8 pre-existing untracked v0.1.1-era docs, untouched).

---

## 1. SIR-PS6R-001 — CLOSED

Correction applied: `Project_Gateway_MCP/scripts/run-wp7-tests.mjs`.

- `EXPECTED_COUNTS` git 38 → 41; reader 62, fff 26, security 39
  unchanged; header/comment updated (165 → 168 total + PS-6R
  authorization note).
- Source inventory verified BEFORE editing: reader 33+29 = 62, git 41,
  fff 26, security 39 → total 168. No unrelated mismatch existed; no
  other count changed.
- Exact count enforcement unchanged (still requires
  tests == expected, pass == tests, fail == cancelled == skipped ==
  todo == 0, plan-line + summary parse; no >=/nonzero weakening).
- `scripts/wp7-discovery-guard.mjs`: source↔compiled correspondence
  **OK** (exit 0).
- `node scripts/run-wp7-tests.mjs`: **GREEN** —
  `reader: 62/62, git: 41/41, fff: 26/26, security: 39/39 (exit 0);
  WP-7 validated execution OK: 168 tests across 4 suites, 0
  failed/skipped/cancelled/todo`.
- `git diff --check`: clean.

Disposition: **CLOSED** — manifest matches the 41-test Git suite;
exact-count enforcement remains fail-closed; WP-7 runner green.

## 2. SIR-PS6R-002 — CLOSED

Correction applied: pi-shuttle `docs/installation-contract.md` §3 and
`docs/platform-support-contract.md` §1.

- installation-contract §3 now separates **installed artifact pins**
  (gateway 0.1.0, pi-guard 0.1.2, gateway dependencies — still exact)
  from **runtime environment requirements** (Node `>=22.19.0`,
  22.23.2 validated CI baseline, native arm64 mandatory on
  darwin-arm64; Git `>=2.30.0`, 2.45.4 validated CI baseline, Gateway
  fingerprint/ownership checks fail-closed unchanged; Pi candidate
  `>=0.83.0`, 0.83.0 known-good, non-baseline candidate requires
  probe PASS). "No `latest`, no floating versions, no 'if newer is
  available'" retained; "no ranges" blanket dropped because the
  approved policy IS a fixed minimum — no arbitrary-version
  installation claim weakened.
- platform-support-contract §1 lane constants now state the
  minimum+baseline policy for Node/Git/Pi; `SUPPORTED_PI_LANE`
  string unchanged; the "never substitute release evidence" rule for
  the host's 0.84.1 retained; `/usr/bin/git` prohibition and
  Gateway-safety note retained.
- Grep for the stale forms (`Component versions are exact:`,
  `pinned binary`, `no ranges`, `not a claimed lane`) across both
  documents: **zero matches**.
- Unrelated requirements preserved: native-arm64, Git executable
  safety, unsupported macOS Intel policy, `SUPPORTED_PI_LANE`
  constant, `/usr/bin/git` prohibition. No blanket future-version
  compatibility language introduced.
- `git diff --check`: clean.

Disposition: **CLOSED** — no contradictory exact-runtime requirement
remains; minimum+baseline policy is consistent throughout both
documents.

## 3. SIR-PS6R-003 — CLOSED

Correction applied: `src/command/doctor.ts` module header (comment
only).

- Replaced the stale exact-version refusal text with the implemented
  policy: Node minimum `>=22.19.0` (22.23.2 baseline, reported never
  gating; native arm64 on darwin-arm64); Git minimum `>=2.30.0`
  (2.45.4 baseline, reported never gating; PATH discovery, never
  `/usr/bin/git`); Pi 0.83.0 known-good, candidates `>=0.83.0`
  probe-gated (FAIL → unsupported; infrastructure unavailable →
  installed but unverified; below minimum → unsupported).
- Verified the correction is comment-only within the already-reviewed
  PS-6R diff: the header hunk touches only `*` comment lines; no
  behavioral source change was made by this finding.

Disposition: **CLOSED**.

## 4. SIR-PS6R-004 — ACCEPTED RESIDUAL RISK (no correction)

Preserved disposition:

- The committed Pi probe (`src/compat/pi-guard-probe.ts`) verifies
  load/factory/registration compatibility through pi's own loader:
  zero load errors, factory executes, `guard` command registered, the
  four required events (`session_start`, `session_shutdown`,
  `before_agent_start`, `tool_call`) registered.
- Isolated loader probing **cannot** exercise pi session-time action
  APIs (`registerTool`/`getAllTools`/`getActiveTools`/`setActiveTools`,
  event delivery, block-return contracts) — empirically demonstrated in
  senior review: pi 0.84.1 rejects action-method calls outside a live
  session ("Extension runtime not initialized. Action methods cannot be
  called during extension loading.").
- This is an inherent isolation boundary, **not a PS-6R contract
  violation**: candidate acceptance per the approved policy is the
  committed probe, and full-session enforcement evidence remains
  provided by the exact known-good Pi 0.83.0 real-stack/release
  evidence lane (Lane B), which is unchanged.
- No implementation correction required; probe NOT broadened in this
  gate.

## 5. SIR-PS6R-005 / -006 / -007 — OPTIONAL HARDENING — DEFERRED

- SIR-PS6R-005 (probe CLI exit-code taxonomy for loader-import
  failures): DEFERRED — not converted into a correction-required
  finding; no production behavior changed.
- SIR-PS6R-006 (real-HOME probe env vs isolated-HOME contract text):
  DEFERRED — no production behavior changed.
- SIR-PS6R-007 (Gateway `parseGitVersion` prefix grammar vs pi-shuttle
  strict parser): DEFERRED — no production behavior changed.

None of the deferred items remain open correction-required findings.

---

## 6. Focused verification results

Gateway (no full `npm test`; no POUV2/conformance/trusted/identity/
reader/FFF/writing/storage reruns):

1. Authoritative WP-7 inventory verified: reader 62 (unchanged),
   git 41, fff 26 (unchanged), security 39 (unchanged), total 168. ✅
2. `node scripts/wp7-discovery-guard.mjs` — source↔compiled
   correspondence OK. ✅
3. `node scripts/run-wp7-tests.mjs` — single run, GREEN 168/168 exact
   (runner executes the Git and security suites itself; no separate
   rerun performed). ✅
4. `git diff --check` — clean. ✅

pi-shuttle (no full 227-test rerun — senior-review result 224 pass /
0 fail / 3 truthful skips remains valid: no executable behavior was
corrected; SIR-PS6R-002 is documentation-only, SIR-PS6R-003 is
comment-only):

- No narrow documentation/static consistency script exists in the
  repository (package.json exposes build/typecheck/test only), so the
  equivalent check was performed directly: stale-pattern grep across
  both corrected documents → zero matches. ✅
- `git diff --check` — clean. ✅
- Typecheck not required (comment-only source change). ✅

## 7. Mandatory regression conclusions

- Node runtime policy: **unchanged** from reviewed implementation
  (minimum `>=22.19.0`, 22.23.2 reporting-only baseline, native arm64
  on darwin-arm64).
- Git runtime policy: **unchanged** except test-manifest bookkeeping
  (SIR-PS6R-001); minimum `>=2.30.0`, 2.45.4 reporting-only baseline.
- Pi compatibility implementation: **unchanged** (0.83.0 known-good;
  probe-gated candidates; fail-closed classification).
- Gateway Git safety/fingerprint implementation: **unchanged**
  (canonical path, owner, mode, dev/ino/mode/size/mtime/SHA-256,
  per-launch revalidation, sanitized env, preflight, no-shell).
- TrustedHostLane strings: **unchanged**
  (`linux-x86_64-posix-utf8-node22`,
  `darwin-arm64-posix-utf8-node22`, byte-identical).
- Configuration/store identity: **unchanged**.
- pi-guard: **unchanged** (`7a7580cc…` = `v0.1.2`).
- macOS Intel remains **unsupported**.

---

## 8. Commit record

### Gateway

- Parent: `98d1b204a864596bda91bec1104b8a8d5e89e1cd`
- New SHA: recorded below
- Subject: `feat: relax Gateway Git runtime compatibility`
- Paths: `src/git/host-lane.ts`, `tests/wp7/git/git.test.ts`,
  `scripts/run-wp7-tests.mjs`
- Pre-existing WP-13D debris excluded.

### pi-shuttle

- Parent: `2076575efb7e8d9d7aeaff8f4bfafb7df3e965e8`
- New SHA: recorded below
- Subject: `feat: simplify runtime compatibility requirements`
- Paths: the approved PS-6R implementation, tests, approved contract
  docs, readiness analysis, implementation report, senior-review
  report, focused-rereview report (this document). Unrelated untracked
  material excluded.

---

## Rereview verdict

SIR-PS6R-001 CLOSED (WP-7 runner green, exact enforcement intact).
SIR-PS6R-002 CLOSED (both normative documents consistent).
SIR-PS6R-003 CLOSED (header reflects actual policy).
SIR-PS6R-004 ACCEPTED RESIDUAL RISK. SIR-PS6R-005/-006/-007 DEFERRED
(optional hardening, not open corrections).

`PS-6R FOCUSED REREVIEW — ACCEPTED`
