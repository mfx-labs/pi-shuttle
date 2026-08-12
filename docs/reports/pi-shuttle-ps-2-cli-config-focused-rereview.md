# PS-2 — pi-shuttle CLI / Configuration Model — Focused Rereview

**Role:** combined PS-2 FOCUSED CORRECTION → FOCUSED REREVIEW → LOCAL
BASELINE COMMIT gate. Read-only rereview of the seven authorized
corrections; commit authorized only by this verdict. No Gateway/pi-guard
mutation; no remote/push/tag/publication/deployment.

---

## 1. Baseline identity

| Item | Value |
|---|---|
| PS-0 baseline HEAD (expected/actual) | `f190b32da520e890e72a8f59f8c250f3efeb2007` — `docs: establish pi-shuttle PS-0 product contract` ✔ |
| Senior review | `docs/reports/pi-shuttle-ps-2-cli-config-senior-review.md` — verdict CORRECTIONS REQUIRED |
| Gateway PS-1 baseline (external) | `7f3b4afdb43704e7dac82da7b086d8367347c641` — untouched |
| pi-guard (external) | `v0.1.2` / `7a7580cc4cbd7926797564c72269394fc29a860a` — untouched |
| Staged content | none; `git diff --check` clean |

## 2. Rereview scope

Only the seven authorized findings: SIR-PS2-001, 002, 003, 004, 005, 007,
010. Deferred status confirmed for SIR-PS2-006, 008, 009. Full PS-2
architecture not reopened; no cross-cutting issue introduced by the
corrections.

## 3. SIR-PS2-001 + SIR-PS2-002 — VERIFIED CLOSED (concurrency)

**Algorithm inspected independently (src/persistence/writer.ts):**

```
mutateDocumentAtomically(path, { decode, transition, serialize, write? })
  mkdir parents (0700, idempotent)
  acquireLock(<path>.lock)          # openSync 'wx' — atomic O_CREAT|O_EXCL
    bounded retry 20 × 25 ms (Atomics.wait sync sleep; no busy loop, no deadlock)
    EEXIST exhaustion → ERR-PS2-CONFIG-BUSY + truthful stale-lock recovery text
    (lock content: pid, informational only; NO time/PID-based auto-steal)
  read current state (bounded)      # AFTER ownership — the authoritative snapshot
  decode → null ⇒ ERR-PS2-CONFIG-INCOMPATIBLE (foreign/oversized/unreadable)
  transition(current)               # pure; input is current state, never a caller snapshot
  serialize → publishBytes          # temp wx 0600 + complete-write loop + fsync +
                                    # rename + dir fsync; identical-content no-op
  verify (bounded read-back, byte-compare; oversized documents skip) →
    mismatch ⇒ ERR-PS2-WRITE-VERIFY (never report success for absent/different state)
  finally: releaseLock              # unlink-then-close, best-effort
```

Rereview acceptance points, each proven:

- **Logical state read under the boundary**: read/decode/transition/publish/
  verify all occur after acquisition and before release. ✔
- **Transition based on current authoritative state**: the transition
  function receives the state read under the lock; the API accepts a pure
  function, so a caller cannot pre-read and compute outside the boundary —
  the stale-snapshot pattern the gate forbids is structurally impossible. ✔
- **Publication cannot turn stale state into reported success**: the
  reported success value is the transition's output over the locked read,
  and post-publish verification confirms the final bytes. ✔
- **Incompatible-state fail closed**: decode under lock; foreign content is
  never replaced (deterministic test: foreign file created while the lock
  is held → BUSY and the foreign target survives; after release →
  INCOMPATIBLE and the foreign target still survives). ✔
- **No lock-only-around-rename**: the lock covers the whole logical
  transition, not the rename. ✔
- **Concurrent mutations**: serialized success or deterministic BUSY.
  Evidence: unit test 8 real processes × 3 runs (all succeed, all
  surfaces present); independent reproduction of the senior review's
  exact experiment — **30 real processes × 3 runs: 0 failures, 30/30
  surfaces in final state** (previous observed behavior 30/30 success →
  1 survivor is impossible). ✔
- **Lock semantics**: atomic acquisition ('wx'); deterministic collision
  (bounded retry → `ERR-PS2-CONFIG-BUSY`); safe release (unlink-then-close;
  crash before unlink leaves a stale lock, never a missing one mid-
  transaction); stale lock fail-closed with explicit recovery guidance;
  no auto-steal. Contention bounded (~500 ms), no deadlock, no unbounded
  loop. ✔
- **`isCompatible` removed from the raw writer**: compatibility semantics
  now exist ONLY under the transaction boundary; the raw `writeFileAtomic`
  is documented as single-writer-only. The racy API surface is gone. ✔
- **Scope discipline**: no new fs imports (writer's allowlist unchanged:
  mkdirSync/openSync/closeSync/writeSync/fsyncSync/renameSync/unlinkSync/
  fchmodSync — guard green); only Node-core primitives (`openSync 'wx'`,
  `Atomics.wait`, `SharedArrayBuffer`); no dependencies; registry
  transitions remain pure; no Gateway provenance/authority vocabulary;
  PS-4 handlers still deferred and fail closed. The lock artifact is
  ordinary pi-shuttle config/state coordination, not trusted storage. ✔
- **Operational limitation recorded**: stale lock requires operator
  removal; recorded for PS-4/doctor follow-up (doctor should surface a
  stale `<path>.lock`). Non-cooperating writers (arbitrary processes
  ignoring the lock) can always clobber any file — documented boundary,
  not defended against. ✔

## 4. SIR-PS2-003 — VERIFIED CLOSED

`src/command/doctor.ts` exit classification: `unsupported` → 2
(precedence); finding-class verdicts (`missing`, `installed but
unverified`, `partial installation`) → **1**; else 0. Verified:
`runtime configuration: missing` → exit 1 at unit level and in a real CLI
subprocess; unsupported platform stays 2; valid config (incl. empty
surfaces) stays 0. Closed vocabulary unchanged; no PS-4 probes fabricated.

## 5. SIR-PS2-004 — VERIFIED CLOSED

Help text now reads: "0 success; 1 operational failure (findings, missing
state); 2 malformed invocation or unsupported platform/architecture
(`doctor`)" — deterministic, pinned by test, exit model unchanged.

## 6. SIR-PS2-005 — VERIFIED CLOSED

Executable tests (`tests/unit/config.test.ts`): exactly `MAX_CONFIG_BYTES`
(1 MiB) accepted; `MAX + 1` rejected with `ERR-PS2-READ-TOO-LARGE` via the
stat path; the **read-loop** ceiling (growth-after-stat) proven
deterministically via `/dev/zero` (fstat size 0, unbounded content →
loop rejects). The reader itself was not redesigned.

## 7. SIR-PS2-007 — VERIFIED CLOSED

`package-lock.json` regenerated via `npm install --package-lock-only`:
root `packages[""].devDependencies` records the exact pins
`{"@types/node":"26.1.2","typescript":"7.0.2"}` (was `^`-prefixed);
resolved versions exact (7.0.2 / 26.1.2); zero runtime dependencies;
`npm ci --dry-run` succeeds. No package upgrades, no version drift.

## 8. SIR-PS2-010 — VERIFIED CLOSED

`src/cli.ts` dispatches `--help`/`--version` before constructing host/
layout state; `src/app.ts` requires the environment only for `doctor`
(missing → exit 2, "HOME is not set"). Real-CLI subprocess evidence with
HOME removed from the environment: `--help` → 0, `--version` → 0,
`doctor` → 2. Deterministic, no config/state reads, no fs mutation.

## 9. Deferred findings — confirmed, not implemented

- `SIR-PS2-006 — DEFERRED / OPTIONAL HARDENING` — symlink final-target
  policy. The correction changes no symlink behavior (a symlink at the
  target is still replaced by rename; a symlink at the lock path fails
  closed as busy). No generalized symlink framework introduced.
- `SIR-PS2-008 — DEFERRED / OPTIONAL HARDENING` — post-publication fsync
  taxonomy / stale-tmp sweeping. Not implemented; the only new failure
  code is the transaction's `ERR-PS2-WRITE-VERIFY`, which is part of the
  mandatory correction (never-report-success-for-absent-state), not a
  generalized error taxonomy.
- `SIR-PS2-009 — DEFERRED / PS-4 CONFORMANCE RISK RECORD` — Gateway-shape
  drift; black-box conformance check recommended at PS-4 composition. No
  schema sharing, no Gateway private imports.

## 10. Exact focused tests rerun

`npm test` (clean build + `tsc` tests compile + `node --test`
`dist-test/tests/unit/*.test.js`), Node v22.23.2, TypeScript 7.0.2:
**60 tests run / 60 pass / 0 fail / 0 skip.** `npm run typecheck` clean;
`npm ci --dry-run` green; `git diff --check` clean. No Gateway/pi-guard
suites, no PS-3 installer tests, no macOS lane tests.

## 11. Exact current evidence totals

**60 run / 60 pass / 0 fail / 0 skip** (original implementation 49/49
recorded as historical evidence in the implementation report §19).

## 12. Boundary regression check

- Zero runtime dependencies (`package.json` none; lockfile root deps
  null); one public bin (`pi-shuttle`); `private: true`.
- No Gateway/pi-guard changes; no subprocess/network in production (static
  guard green; the only `@modelcontextprotocol` occurrence in src is the
  manifest's pinned dependency NAME as data).
- No new authority domain: no provenance/capability/grant/receipt/
  initializeTrustedStore vocabulary (guard green); the lock artifact is
  ordinary config coordination.
- No installer behavior; no supported-lane change (linux supported,
  darwin-arm64 gated only); PS-4 handlers (`project add/list/remove`,
  `start`) still deferred, exit 1, fail closed (re-verified on the real
  CLI).
- Filesystem mutation vocabulary still confined to the single writer
  module (guard green); writer fs allowlist unchanged.

## 13. Git status before commit

```
 M README.md
?? docs/reports/
?? package-lock.json
?? package.json
?? src/
?? tests/
?? tsconfig.json
?? tsconfig.tests.json
```

Baseline HEAD unchanged; nothing staged; no remote; `dist/`, `dist-test/`,
`node_modules/` gitignored. All corrections uncommitted, ready for the
baseline commit.

## 14. Findings

No new correction-required findings.

- SIR-PS2-001 — VERIFIED CLOSED (lock-covered transactional mutation;
  incompatible-state race closed; deterministic + 30-process evidence)
- SIR-PS2-002 — VERIFIED CLOSED (serialized success or typed BUSY;
  30-process × 3 runs: 0 failures, 30/30 surfaces survive)
- SIR-PS2-003 — VERIFIED CLOSED (missing → exit 1; unsupported → 2)
- SIR-PS2-004 — VERIFIED CLOSED (full exit-2 semantics in help text)
- SIR-PS2-005 — VERIFIED CLOSED (ceiling exercised by executable tests,
  incl. read-loop growth path via /dev/zero)
- SIR-PS2-007 — VERIFIED CLOSED (lockfile regenerated; exact pins; ci
  reproducible)
- SIR-PS2-010 — VERIFIED CLOSED (help/version HOME-less in real
  subprocess)
- SIR-PS2-006 — DEFERRED / OPTIONAL HARDENING
- SIR-PS2-008 — DEFERRED / OPTIONAL HARDENING
- SIR-PS2-009 — DEFERRED / PS-4 CONFORMANCE RISK RECORD

## 15. Envelope exceptions

None. All corrections are pi-shuttle-side, inside the approved PS-2
envelope: no new authority domain, no Gateway/pi-guard change, no runtime
dependency, no network/subprocess in production, no installer behavior,
no supported-lane change, no destructive semantics, no macOS host-lane
work.

## 16. Verdict

PS-2 FOCUSED REREVIEW — ACCEPTED
