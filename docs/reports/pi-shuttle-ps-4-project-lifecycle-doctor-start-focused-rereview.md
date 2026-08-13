# PS-4 — pi-shuttle Project Lifecycle + Doctor + Start — FOCUSED REREVIEW (SIR-PS4-001..008)

**Review mode:** READ-ONLY focused rereview of the post-senior-review
corrections. No production code, tests, or docs modified by this rereview.
Baseline: senior review `pi-shuttle-ps-4-project-lifecycle-doctor-start-
senior-review.md` (verdict `PS-4 SENIOR REVIEW — ACCEPTED`).

**Reviewed tree:** pi-shuttle HEAD `7622ad90da6a6b2772f1a19a56492c52f70b4881`
with the uncommitted PS-4 corrections; Gateway `7f3b4afdb43704e7dac82da7b086d8367347c641`
and pi-guard `v0.1.2` / `7a7580cc4cbd7926797564c72269394fc29a860a` read-only,
unmodified.

---

## 1. Correction review — SIR-PS4-001 (artifactLocation correlation)

**Correction read:** `src/lifecycle/projects.ts`,
`correlateResolvedSurface` now compares `workspace.artifactLocation !==
expected.artifactsDir` and fails closed with the existing
bootstrap-mismatch family (`ERR-PS4-BOOTSTRAP-MISMATCH`, message names
`artifactLocation mismatch`). No new authority concept; no
`configurationIdentity` involvement; pure comparison of an
operator-owned prepared path.

**Tests verified:** exact artifactLocation accepted (assertion added to the
valid-add test: persisted value == `<root>/artifacts`); wrong-but-inside-
root (`<root>/artifacts-other`) and wrong descendant (`<env>/outside-
artifacts`) both rejected via `FIXTURE_GATEWAY_ARTIFACT`; no registration
persisted after rejection; Gateway-created store residual preserved and
reported truthfully ("preserved"). All green.

**Q001: Can a Gateway exit-0 response with a different artifactLocation be
registered? — NO.**

## 2. Correction review — SIR-PS4-002 (start store-v1 presence)

**Correction read:** `src/lifecycle/start.ts` preflight now requires
`<locator>/store-v1` local presence (same `pathExists` observation
semantics doctor uses) before the Gateway child is spawned; typed
`ERR-PS4-START-STORE-V1-MISSING` with truthful wording ("local presence
observation only, not a trusted-verification claim") and safe
`project add <path>` replay / `doctor` guidance. No private-metadata
inspection, no bootstrap, no repair, no store creation.

**Tests verified:** locator exists + store-v1 missing → exit 1, empty
stdout, `MUST-NOT-APPEAR` marker absent (no child spawn), `store-v1`
still absent afterward (no filesystem mutation); store-v1 present →
normal start path proceeds (existing start tests, including byte-clean
stdout and exit propagation, all green).

**Q002: Can `pi-shuttle start` spawn Gateway when locator exists but
`store-v1` does not? — NO.**

## 3. Correction review — SIR-PS4-003 (signal listener lifecycle)

**Correction read:** `src/lifecycle/start.ts` — forwarding listeners for
SIGINT/SIGTERM/SIGHUP are held as lifecycle-local `{signal, listener}`
references and removed with `process.removeListener` (exact references,
never `removeAllListeners`) after the child reaches its terminal state
(`close` or spawn `error` both resolve the promise; cleanup runs after
the await on every path). Public mapping unchanged: exit code as-is,
signal → 128+N, inherited stdio, byte-clean stdout.

**Tests verified:** repeated start invocations (3×) in one process with
`forwardSignals: true` leave SIGINT/SIGTERM/SIGHUP listener counts at
baseline; an unrelated SIGTERM listener installed by the test survives
cleanup; real-CLI SIGTERM forwarding still yields 143 (existing test
green).

**Q003: Can one completed start invocation leave its signal-forwarding
listeners installed? — NO.**

## 4. Correction review — SIR-PS4-004 (add-vs-remove contention)

**Correction read:** new real-CLI test in `tests/unit/lifecycle.test.ts`:
a project is registered; a re-add with a slow (3 s) Gateway bootstrap
holds `project.lock` across bootstrap + registry finalization (verified
by polling the lock artifact); a competing `project remove` runs while
the lock is held and returns the deterministic `ERR-PS4-BUSY` result
(naming `project.lock` and the stale-lock guidance); the slow add then
completes as an exact idempotent replay; final state = exactly one
coherent registration at the expected locator, store intact, lock
released. No second project-operation lock introduced; the pinned order
`project.lock → runtime.json.lock` is unchanged (no code change to the
lock layer).

**Q004: Can concurrent add-vs-remove lose a registry update or bypass
`project.lock` serialization? — NO** (same lock, same ordering, verified
by the new real-CLI test; structural argument unchanged: the only
runtime-document writers are add/remove, both under `project.lock`).

## 5. Correction review — SIR-PS4-005 (bounded conformance shutdown)

**Correction read:** `tests/unit/gateway-conformance.test.ts`
`probeStartup` now separates the alive window (unchanged: 4 s) from a
bounded post-EOF shutdown deadline (4 s); if the Gateway does not close
after EOF within the deadline, the test child is killed safely
(SIGKILL) and the probe reports `timedOut: true`, which fails the
acceptance assertions with a clear conformance-timeout message. Early
exit within the alive window remains classified as rejection. Real
Gateway fixture kept; no production behavior touched.

**Tests verified:** conformance suite re-run — **3 pass / 0 skip** on
this environment (real Gateway `7f3b4af…`, real store init, real git
lane, valid config enters runtime and shuts down cleanly with exit 0;
drifted configs rejected with exit 1).

**Q005: Can the real Gateway conformance test hang indefinitely after
stdin EOF? — NO.**

## 6. Correction review — SIR-PS4-007 (documentation truthfulness)

**Correction read:** implementation report §24 corrected —
`tests/unit/doctor.test.ts` now listed as tracked-modified (` M`), not
untracked. A new §26 correction table records SIR-PS4-001..005/007
CLOSED, SIR-PS4-006/008 DEFERRED, SIR-PS4-002/003/004/005 dispositions,
the preserved historical totals, and SIR-PS2-009 re-verified status.

**Q007: Does the implementation report now accurately represent the file
status and correction evidence? — YES.**

## 7. Deferred findings — preserved exactly

- **SIR-PS4-006 — DEFERRED / OPTIONAL HARDENING** — operator-boundary
  `mkdir` may follow a same-user pre-existing symlink. No generalized
  no-symlink filesystem policy introduced in this gate. Recorded as a
  later hardening candidate (§26 of the implementation report).
- **SIR-PS4-008 — DEFERRED / OPTIONAL HARDENING** — `start` rechecks bin
  regular-file presence but does not revalidate full package identity;
  `start` is not expanded into a second installer/package verifier.
  Recorded as a later hardening candidate (§26).

## 8. Regression checks

| Invariant | Status |
|---|---|
| SIR-PS2-009 remains VERIFIED CLOSED | ✓ re-verified: real Gateway black-box conformance 3/3, 0 skip, after the corrections |
| Gateway authority boundary unchanged | ✓ corrections touch only correlation + start preflight/listeners; no Gateway private imports (static guard green) |
| configurationIdentity still Gateway-owned | ✓ no recomputation added anywhere (static guard: no trusted-authority vocabulary) |
| remove still deregister-only | ✓ untouched code |
| operation lock graph still acyclic | ✓ lock layer untouched; `project.lock → runtime.json.lock` only; `install.lock` disjoint |
| doctor still read-only | ✓ untouched |
| start remains byte-clean on stdout | ✓ stdio untouched; byte-clean start test green |
| no network / shell / new runtime dependency | ✓ static guards green; `package.json` unchanged |
| PS-3 installer behavior unchanged | ✓ installer sources untouched; installer suites green |
| Git/Pi probes read-only; real Pi state untouched | ✓ |

## 9. Verification performed (focused, then full)

- Focused: `lifecycle` + `start` + `gateway-conformance` — **41 pass /
  0 skip**; `doctor` + `static-guard` + `cli` + `installer-process` +
  `installer-flow` — **80 pass / 0 skip**.
- Full authoritative suite `npm test` — **184 run / 184 pass / 0 fail /
  0 skip** (pre-correction historical total 179/179 preserved in the
  implementation report; not overwritten).
- `npm run typecheck` clean; `npm ci --dry-run` green; `git diff --check`
  clean.
- Gateway's broad regression suite NOT run; pi-guard regression NOT run;
  no real Pi state mutated; Gateway/pi-guard repositories unmodified.

## 10. Findings

None. All six authorized corrections are closed as specified; the two
deferred findings remain deferred with their reasons recorded. No
regression of clean PS-4 architecture observed; no evidence of regression
of SIR-PS2-009's black-box conformance.

## 11. Verdict

`PS-4 FOCUSED REREVIEW — ACCEPTED`
