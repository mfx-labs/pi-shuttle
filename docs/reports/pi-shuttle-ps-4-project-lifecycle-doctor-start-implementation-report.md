# PS-4 — pi-shuttle Project Lifecycle + Doctor + Start — Implementation Report

**Status:** Implementation complete; uncommitted, unstaged, awaiting senior
review. No commit, no remote, no publication in this gate. Gateway and
pi-guard repositories were NOT modified.

## 1. Baseline SHA

- pi-shuttle baseline HEAD: `7622ad90da6a6b2772f1a19a56492c52f70b4881`
  (`feat: establish pi-shuttle PS-3 installer component composition`),
  verified unchanged before and after implementation.
- External Gateway baseline (read-only, pinned): `7f3b4afdb43704e7dac82da7b086d8367347c641`
  (PS-1 operator bootstrap verb; `Project_Gateway_MCP` at the expected
  HEAD, unmodified).
- External pi-guard (read-only, pinned): `v0.1.2` /
  `7a7580cc4cbd7926797564c72269394fc29a860a` (unmodified).

## 2. Objective

Turn the PS-2 CLI/config foundation and PS-3 installed component layout
into a real local operator workflow: `project add` (canonicalize → derive
identity → prepare operator paths → compose bootstrap input → invoke the
installed Gateway operator bootstrap verb → validate/persist the resolved
runtime configuration → register transactionally), plus truthful `project
list`, `project remove` (deregister only), full `doctor`, and `start`
runtime composition. ChatGPT/tunnel onboarding is NOT implemented (PS-7
owns it; `doctor` reports it as not locally observable).

## 3. Exact CLI behavior now implemented

The PS-2 closed grammar is unchanged (static-guard pinned). Every command
now has its real operational handler:

- `pi-shuttle project add <path>` — exit 0 on registration (or exact
  idempotent replay), 1 on typed operational failure, 2 on unsupported
  platform. Stdout: `registered project` summary (workspace, surface,
  canonical root, store locator, state `initialized` | `verification-replay`);
  `project already registered (exact replay; no registry change)` on
  re-add. Failures: typed codes on stderr.
- `pi-shuttle project list` — read-only; `no registered projects` (exit 0)
  on an empty registry; otherwise one deterministic line per project
  (workspaceId, canonical root, surface id, store locator), ordered by
  surfaceId. Never spawns a subprocess; needs no receipt.
- `pi-shuttle project remove <path-or-workspace-id>` — DEREGISTER ONLY:
  removes the registration transactionally; prints the preserved store
  locator; never deletes the store, project, `.git`, artifacts, or
  lifecycle records. Unknown target → `ERR-PS2-REG-NOT-FOUND`, exit 1,
  nothing changed.
- `pi-shuttle doctor` — full probe suite (below); exit 0 all supported
  checks pass, 1 findings, 2 unsupported platform (precedence); the closed
  status vocabulary is used exactly.
- `pi-shuttle start` — receipt + config gates, then composes the installed
  Gateway CLI with inherited stdio; stdout stays MCP protocol; pre-start
  diagnostics to stderr; Gateway exit code/signal propagated (signal →
  128+N). Never bootstraps, never mutates.
- `--help` / `--version` unchanged (state-free; work without HOME).

## 4. Project identity / canonicalization

Unchanged PS-2 formula (gate §5, pinned by tests): `storeId =
sha256(canonicalRoot).hex.slice(0,32)`, `workspaceId = "pgw:w:" +
storeId`, `locator = <shareDir>/stores/<storeId>`. Operator input is
canonicalized through the host seam (`realpathSync`, fail closed on
unresolvable) BEFORE derivation; symlinked roots register under the
canonical root. No case-folding/macOS semantics added (PS-6 owns macOS).

New (mechanical, inside the envelope): `deriveSurfaceId(canonicalRoot) =
"pgw-" + storeId` — the Gateway's closed logical-identifier grammar
(`/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/`, ≤ 64 chars) forbids the `:` of the
workspaceId form, so the surface gets its own deterministic derivation.
The trusted configuration identity is NEVER computed by pi-shuttle: it
arrives from the Gateway bootstrap verb and is persisted verbatim.

## 5. Operation-wide concurrency model (gate §18)

One operator/project-state lock (`<stateDir>/project.lock`, shared PS-2
O_EXCL semantics: atomic acquisition, bounded wait 20×25 ms, deterministic
`ERR-PS2-CONFIG-BUSY`, stale locks NEVER auto-stolen) is acquired by
`project add` (spans Gateway bootstrap + runtime-config regeneration +
registry mutation) and `project remove` (spans regeneration + mutation).

Lock ordering (documented in `src/lifecycle/state.ts`, deadlock-free by
construction):

1. `project.lock` — outer, PS-4 lifecycle operations;
2. `<runtime.json>.lock` — inner leaf, PS-2 transactional writer
   (`mutateDocumentAtomically` re-reads current state under the lock, so
   stale snapshots cannot report success);
3. `install.lock` (PS-3) is never nested with `project.lock` — the
   installer acquires it alone; no lifecycle operation takes it.

`start` and `doctor` take no locks (read-only); `doctor` detects lock
artifacts and reports recovery guidance without deleting them.

## 6. Project-add algorithm (`src/lifecycle/projects.ts`)

1. Platform gate (Linux x86_64; else exit 2) + node lane gate
   (22.23.2; running interpreter, same rule as the installer).
2. Installation receipt gate (`resolveGatewayInstallation`): the closed
   PS-3 receipt must exist, validate, and record the Gateway component as
   `installed-verified`. Never inferred from filesystem existence; never
   reinstalled (installer rerun owns that).
3. Canonicalize the project path (fail closed: unresolvable / not a
   directory).
4. Git executable discovery (PATH, never `/usr/bin/git`) + read-only
   repository probe (`git -C <root> rev-parse --git-dir`, bounded).
5. Derive storeId/workspaceId/surfaceId/locator from the canonical root.
6. Acquire `project.lock`; everything below runs under it.
7. Prepare operator-owned directories (`prepareOperatorDirs`): the store
   parent locator (0700; the Gateway PS-1 verb requires the parent to
   pre-exist — pi-shuttle creates the parent, never the Gateway's internal
   structure), per-store `git-home/<storeId>` and `git-tmp/<storeId>`
   (empty, 0700, outside workspace roots), and the version-2
   `artifacts/` dir inside the project root (created only when absent;
   existing content untouched; fail closed on non-directory).
8. Compose the smallest bootstrap config (`composeBootstrapConfig`):
   one surface with surfaceId, locator, forbiddenRoots=[canonicalRoot],
   configurationVersion `2`, `limitProfile: {}`, one workspace entry
   (workspaceId, canonical root, artifactLocation), gitPath (discovered),
   gitHome/gitTmpdir. `configurationIdentity` is OMITTED (the PS-1
   bootstrap profile derives it — pi-shuttle never fabricates it).
9. Write the input to a pi-shuttle-owned disposable probe file under the
   state dir (atomic, 0600); best-effort removal of prior-run probe files
   (these are pi-shuttle probe artifacts, never Gateway store state).
10. Invoke the installed exact Gateway binary:
    `node <gateway-bin> bootstrap --config <input> --output <resolved>`
    (argv arrays only, bounded output, 60 s timeout, never through MCP).
11. Result validation: the resolved file must exist, parse through the
    PS-2 closed document model, contain exactly one surface, and
    correlate EXACTLY (surfaceId, locator, configurationVersion,
    workspaceId, canonical root, gitPath/gitHome/gitTmpdir,
    forbiddenRoots). Any mismatch fails closed
    (`ERR-PS4-BOOTSTRAP-MISMATCH`) with the store-preserved residual
    stated truthfully.
12. Register transactionally: `mutateDocumentAtomically` over
    `runtime.json` with the pure registry transition
    (`registerSurface`); idempotent exact re-registration is a no-op;
    conflicting registrations fail closed.
13. Report; release the lock in `finally` on every path.

## 7. Gateway bootstrap composition

The ONLY trusted-store bootstrap path is the installed Gateway operator
CLI (PS-1 baseline), invoked as a pinned subprocess with a fixed argv
shape. pi-shuttle imports nothing from the Gateway, never calls
`initializeTrustedStore` (static-guard pinned), never mints provenance or
capability material, never computes trusted configuration identity, and
stores the Gateway-resolved identity as ordinary operator orchestration
state. The static guard pins the `'bootstrap'` and `'--config'` argv
literals to the lifecycle boundary and the runner.

## 8. Runtime-config validation / persistence

The operator runtime document stays the single composition document
(`~/.config/pi-shuttle/runtime.json`): it is written ONLY by
`project add` / `project remove` through the PS-2 transactional writer
(atomic tmp+fsync+rename, 0600, decode-under-lock, read-back
verification). Adding/removing derives the complete next document from the
authoritative registered surfaces; malformed/foreign existing content
fails closed (`ERR-PS2-CONFIG-INCOMPATIBLE`, never silently overwritten);
Gateway-derived per-surface identities are preserved exactly (re-add
re-validates; a foreign identity conflicts and fails closed).

## 9. SIR-PS2-009 — black-box conformance closure

Implemented as a real black-box check against the EXACT pinned Gateway
runtime boundary (`tests/unit/gateway-conformance.test.ts`): the pinned
local Gateway PS-1 checkout's built CLI (default
`/home/chef/Documents/Project_Gateway_MCP/dist/runtime/mcp/cli.js`,
invoked in place so its ESM imports resolve; configurable via
`PI_SHUTTLE_TEST_GATEWAY_CLI`; skipped truthfully when absent). The test
drives the FULL production composition path (`project add` against the
real bootstrap verb, real store initialization in a throwaway HOME, real
git 2.45.4 lane), then probes the persisted runtime config against the
real startup boundary: acceptance = the server stays alive past a bounded
window (rejection exits 1 with a diagnostic within milliseconds) and
shuts down cleanly on stdin EOF. Drift detection: a foreign field and a
missing `configurationIdentity` are both rejected by the Gateway loader;
the serialization shape is pinned. The Gateway remains authoritative —
pi-shuttle fails closed if the Gateway ever rejects its composed config.
SIR-PS2-009 is CLOSED by this gate.

## 10. `project list`

Real listing from the authoritative runtime document (read-only, no
subprocess, no receipt requirement). Empty registry → `no registered
projects`, exit 0. Non-empty → one deterministic line per project
(workspaceId, canonical root, surface id, store locator), code-unit order
by surfaceId. Registry membership is never presented as operational health
(that is doctor's job).

## 11. `project remove` / deregister semantics

DEREGISTER ONLY (human-approved): the registration is removed from the
runtime document transactionally (under `project.lock` + the writer's
runtime-document lock). The Gateway trusted store, project directory,
`.git`, artifacts, lifecycle records, audit/history, and pi-guard state are
never referenced for deletion. The command prints the preserved store
locator. Accepts workspaceId, canonical path (canonicalized first), or
surfaceId. Unknown target → typed `ERR-PS2-REG-NOT-FOUND`, exit 1, nothing
changed. A removed store remains on disk and re-add derives the same
identity and verification-replays it.

## 12. Re-add behavior

Adding the same canonical project again: same identity, same locator,
Gateway bootstrap exact replay (the verb's committed replay semantics),
no duplicate registry entry (exact re-registration is a no-op), no new
store identity, runtime configuration re-correlated. After `remove`, the
store is preserved and re-add reports `state: verification-replay` with
the same locator. Never purges or recreates trusted history.

## 13. Doctor probes / status model (`src/command/doctor.ts`)

Full local probe suite (read-only; async only for bounded subprocess
probes; the closed vocabulary is used exactly — no new public status
words):

| # | Check | Verdict sources |
|---|---|---|
| 1 | platform | manifest lanes; Linux x86_64 supported; macOS arm64 gated (unsupported, not claimed) |
| 2 | node | running interpreter `--version` == 22.23.2 (else `unsupported`) |
| 3 | git | PATH discovery + version; 2.45.4 supported; other version `unsupported`; absent `missing`; unparseable `installed but unverified` |
| 4 | pi | presence + version; 0.83.0 supported; any other (incl. 0.84.x) `unsupported` per the PS-3 normative refusal policy (unchanged); absent `missing` |
| 5 | installation receipt | absent `missing`; invalid → fail closed exit 1; PARTIAL → `partial installation` naming omitted components; COMPLETE → `supported` (+ 0600 mode folded in; unsafe mode → `installed but unverified`) |
| 6 | gateway component | receipt + installed package: `failed` → `missing`; `installed-unverified` → `installed but unverified`; `installed-verified` → package identity (name/version), bin regular-file, bounded `--help` smoke → `supported`; missing-deps smoke → `installed but unverified`; package absent → `missing`; package present without a receipt record → `installed but unverified` |
| 7 | pi-guard | receipt + read-only `pi list` exact-source check (SIR-PS3-008 discipline); verified → `supported`; unconfirmable → `installed but unverified`; absent → `missing` |
| 8 | runtime configuration | absent `missing`; invalid → fail closed exit 1; valid → `supported` (+ mode) |
| 9 | registered projects | per surface: root resolves, locator parent present, `store-v1` present, locator mode 0700 → `supported`; any missing fact → `missing`/`installed but unverified` with the exact fact named |
| 10 | git isolation dirs | per workspace surface: gitHome/gitTmpdir exist, directories, not group/world writable, outside workspace roots, empty (the Gateway WP-7 host-directory conditions) |
| 11 | coordination locks | runtime.json.lock / install.lock / project.lock present → `installed but unverified` (artifact present, liveness unconfirmable — a finding, exit 1) with explicit never-auto-steal recovery guidance; none → `supported` |

Notes (never verdicts): trusted-store integrity verification is available
only through the Gateway operator bootstrap replay (`pi-shuttle project
add <path>`); doctor never invokes bootstrap and never mutates; ChatGPT/
tunnel readiness is not locally observable (PS-7); layout paths.

Exit classification (SIR-PS2-003, unchanged): any `unsupported` → 2
(precedence); any finding-class verdict (`missing`, `installed but
unverified`, `partial installation`) → 1; otherwise 0. Malformed runtime
config or receipt → fail closed, exit 1.

## 14. Stale-lock handling

Lock artifacts (`runtime.json.lock`, `install.lock`, `project.lock`) are
DETECTED by doctor and reported with the exact recovery guidance from the
shared lock semantics (verify no operation is running, then remove the
stale file). Doctor never deletes locks; lifecycle operations never
auto-steal (bounded wait then deterministic BUSY). No new lock scheme was
introduced — the PS-2/PS-3 primitive is reused.

## 15. `start` composition (`src/lifecycle/start.ts`)

1. Platform gate (exit 2 on unsupported) and node lane gate.
2. Receipt gate: usable, verified Gateway required.
3. Runtime configuration: absent/empty → `no registered projects — run
   pi-shuttle project add <path>` (exit 1); invalid → fail closed.
4. Local pre-check: each registered surface's store parent exists
   (read-only; the Gateway remains the authority for deep verification).
5. Resolve the exact installed Gateway executable (receipt-pinned
   binPath, re-verified as a regular file).
6. Compose `node <gateway-bin> --config <runtime.json>` via the fixed
   `spawnGatewayForStart` shape (the ONLY inherited-stdio spawn in the
   product; argv fixed; never through a shell).
7. Propagate the Gateway exit status truthfully (code as-is; signal →
   128+N); forward SIGINT/SIGTERM/SIGHUP to the child on the real CLI
   path.

No bootstrap during start, no auto-repair, no mutation, no download, no
lifecycle authority.

## 16. Stdio / protocol safety

`start` inherits stdio: the Gateway owns stdout (MCP protocol) from the
moment it spawns; pi-shuttle prints NOTHING to stdout afterwards
(`outcome.stdout` stays empty on the start path; pre-start diagnostics are
stderr-only; no banners). Proven by tests: with a fixture Gateway emitting
a protocol marker, the captured stdout of `pi-shuttle start` is exactly
the marker line — no pi-shuttle text ever contaminates the stream.

## 17. Process boundary (gate §17)

PS-4 extracts the PS-3 installer argv runner UNCHANGED into the single
shared boundary `src/process/runner.ts` (the installer module becomes a
re-export shim; installer behavior byte-identical, its tests unchanged).
The boundary adds ONE narrow start-path spawn (`spawnGatewayForStart`)
with a fixed executable class and fixed `--config` argv. Properties
preserved: argv arrays only, no shell, bounded output for probes,
inherited stdio only on the intentional start path, fixed executable
classes, no arbitrary operator command execution. Static guards pin:
`node:child_process`/`spawn(` only in the runner, `'bootstrap'` and
`'--config'` argv only in the lifecycle boundary/runner, `stdio: 'inherit'`
only in the runner, and per-module `node:fs` allowlists including the new
lifecycle modules.

## 18. Failure / residual semantics (gate §19)

Two state classes, never presented as one atomic transaction:

- **`project add`**: any failure before registration leaves the registry
  unchanged. If the Gateway bootstrap succeeded (store initialized or
  replay-verified) but pi-shuttle persistence/registration fails, the
  failure message reports the residual truthfully: the store at the
  locator is PRESERVED (Gateway store state is never deleted to roll back
  pi-shuttle metadata) with re-run guidance (`pi-shuttle project add
  <path>` replay-verifies and registers). Typed codes:
  `ERR-PS4-RECEIPT-*`, `ERR-PS4-ROOT-*`, `ERR-PS4-PREFLIGHT-*`,
  `ERR-PS4-STATE-*`, `ERR-PS4-BOOTSTRAP-FAILED`,
  `ERR-PS4-BOOTSTRAP-OUTPUT`, `ERR-PS4-BOOTSTRAP-MISMATCH`,
  `ERR-PS4-REGISTER-FAILED`, `ERR-PS4-BUSY` (plus the registry/writer
  codes `ERR-PS2-*` from the shared model).
- **`project remove`**: only pi-shuttle deregistration changes; the store
  intentionally survives (printed).
- **`start`**: no repair mutation; `doctor`: read-only.

## 19. Authority / security boundary

Verified by static guards and tests: no network imports, no shell, no
generic filesystem writer (the lifecycle's `mkdirSync`/`unlinkSync` are
confined to the approved operator-directory boundary with a per-module
allowlist), no Gateway private imports, no provenance/approval/issuance/
activation vocabulary, no RuntimeGrant, no receipt authority, no
model-callable bootstrap, no arbitrary Git mutation (only the read-only
`rev-parse --git-dir` probe; the Gateway owns its read-only Git lane
later), no updater, no tunnel implementation. Project paths are operator
inputs, never authority grants; access flows only through the Gateway's
own validation/authority model via the composed config.

## 20. Tests and exact totals

`npm test` (clean build + tests compile + `node --test`), Node v22.23.2,
TypeScript 7.0.2 — **179 tests run / 179 pass / 0 fail / 0 skip**
(stable across repeated runs). `npm run typecheck` clean; `npm ci
--dry-run` green; `git diff --check` clean.

New/updated suites:

- `lifecycle` (21): add (valid, relative-input canonicalization,
  nonexistent path, symlinked root, not-a-git, receipt gates, platform
  gate, idempotent re-add, bootstrap failure, malformed output,
  no-output, mismatch + residual, persistence-failure residual, list
  empty/one/many/deterministic/no-subprocess/invalid, remove by
  workspaceId/path/surfaceId/unknown, remove→re-add store reuse,
  concurrent same-project (deterministic BUSY), concurrent
  different-project (both succeed), real-CLI end-to-end).
- `start` (11): valid launch + exact exit propagation + protocol-clean
  stdout, no-registered-projects refusal, malformed config refusal before
  child, missing Gateway refusal, missing store refusal, unsupported
  platform exit 2, missing receipt refusal, SIGTERM forwarding (143),
  never-invokes-bootstrap, unverified-gateway refusal.
- `doctor` (20): vocabulary pin, rendering, complete healthy (exit 0),
  receipt missing/invalid/partial, gateway missing/unverified/package-
  gone/unrecorded, pi baseline/non-baseline (0.84.x), git missing/
  wrong-lane/unparseable, runtime config missing/malformed, project root
  missing, stale lock detection (never auto-deleted), unsupported
  platforms (darwin-arm64 gated, win32), tunnel-not-observable note, git
  isolation missing, symlinked root canonicalization.
- `gateway-conformance` (3): SIR-PS2-009 acceptance of the persisted
  config by the exact pinned Gateway startup boundary; drifted/invalid
  rejection (foreign field, missing identity); deterministic closed
  serialization shape. Runs against the real pinned Gateway checkout
  (0 skipped on this machine); skips truthfully elsewhere.
- `cli` (updated): async dispatch; PS-4 handlers fail closed with typed
  codes; list without installation; subprocess probes with deterministic
  PATH (the host's real Pi 0.84.1/git lanes never leak into assertions).
- `static-guard` (extended): runner boundary, bootstrap/`--config` argv
  confinement, inherited-stdio confinement, lifecycle fs allowlists and
  mutation-boundary confinement, PS-3 installer behavior unchanged
  (installer suites untouched and green).

No brittle global count tests.

## 21. Files changed

**New (production, 7):** `src/process/runner.ts` (shared process
boundary: PS-3 runner moved verbatim + `spawnGatewayForStart`),
`src/lifecycle/state.ts` (operator context, receipt gate, project lock),
`src/lifecycle/projects.ts` (add/list/remove), `src/lifecycle/start.ts`
(start), `src/command/doctor.ts` (full PS-4 probe suite — replaces the
PS-2 skeleton).

**Modified (production, 6):** `src/installer/process.ts` (re-export shim;
behavior unchanged), `src/host/environment.ts` (`pathEnv` captured in the
host seam), `src/registry/identity.ts` (`deriveSurfaceId`),
`src/app.ts` (async dispatch wiring), `src/cli.ts` (await; signal
forwarding flag), `src/command/help.ts` (command descriptions reflect the
implemented handlers; exit-code line unchanged in meaning).

**New (tests, 4):** `tests/helpers/lifecycle-fixtures.ts`,
`tests/unit/lifecycle.test.ts`, `tests/unit/start.test.ts`,
`tests/unit/gateway-conformance.test.ts`.
**Modified (tests, 3):** `tests/unit/cli.test.ts`,
`tests/unit/doctor.test.ts` (PS-2 skeleton rewritten as the full probe
suite), `tests/unit/static-guard.test.ts`.

**Docs:** `README.md` (status + operator CLI section).

## 22. Deviations from contract

None material. Resolutions inside the approved envelope:

1. `surfaceId` derivation (`pgw-<storeId>`) — the Gateway's closed
   logical-identifier grammar cannot carry the `:` of the workspaceId
   form; documented in `registry/identity.ts`.
2. The coordination-lock doctor check maps a present lock artifact to the
   closed vocabulary word `installed but unverified` ("artifact present,
   liveness cannot be confirmed") — a finding (exit 1) with explicit
   recovery guidance; the vocabulary itself is unchanged.
3. The project-state lock lives at `<stateDir>/project.lock` (next to the
   installer's `install.lock`) — the state dir is the coordination
   location; ordering documented in §5.
4. The black-box conformance fixture is the pinned local Gateway checkout
   (a local-only release dependency); the suite skips truthfully when it
   is absent.
5. Doctor's deep trusted-store verification remains a truthful limitation
   note (bootstrap replay only) — invoking bootstrap from doctor could
   mutate (provision) an absent store, violating doctor's read-only
   discipline.

No new ADR: every decision above is a mechanical resolution inside the
approved envelope, documented in code and this report.

## 23. Open risks / dependencies on PS-5/PS-6/PS-7

- **PS-5 (Linux Lane A)**: real end-to-end evidence on the exact lane
  (installer → add → pi-guard composition → start → handshake → tools);
  validates the real Gateway bootstrap path against the installed
  product.
- **PS-6 (macOS)**: macOS arm64 remains gated (Gateway host-lane change
  required); doctor reports it as unsupported/not claimed; `project add`/
  `start` exit 2 on non-Linux-x86_64.
- **PS-7 (tunnel/ChatGPT)**: onboarding and tunnel readiness are deferred;
  doctor reports "not locally observable" truthfully.
- **Release dependency (unchanged from PS-3)**: official artifacts/
  digests/public URL; Gateway dependency materialization; the receipt's
  `commitVerified: false` for local artifacts becomes true for
  release-built artifacts.
- **SIR-PS3-012 (deferred)**: process-group supervision not implemented;
  runProcess resolves on close; unchanged.
- Real-world note: `project add` holds `project.lock` across the Gateway
  bootstrap (bounded by the 60 s timeout); a concurrent add deterministically
  BUSYs after ~500 ms. If bootstrap latency ever grows, the bounded-wait
  budget is the knob, not a lock redesign.

## 24. Git status

```
 M README.md
 M src/app.ts
 M src/cli.ts
 M src/command/doctor.ts
 M src/command/help.ts
 M src/host/environment.ts
 M src/installer/process.ts
 M src/registry/identity.ts
 M tests/unit/cli.test.ts
 M tests/unit/doctor.test.ts
 M tests/unit/static-guard.test.ts
?? src/process/
?? src/lifecycle/
?? tests/helpers/lifecycle-fixtures.ts
?? tests/unit/lifecycle.test.ts
?? tests/unit/start.test.ts
?? tests/unit/gateway-conformance.test.ts
?? docs/reports/pi-shuttle-ps-4-project-lifecycle-doctor-start-implementation-report.md
```

All PS-4 changes are **uncommitted and unstaged**; baseline HEAD unchanged
(`7622ad90da6a6b2772f1a19a56492c52f70b4881`); no remote configured; no
Gateway or pi-guard modification; no push/tag/publish/deploy.

## 25. Readiness verdict

PS-4 delivers the first real operational composition on the approved
boundaries: full `project add` operator bootstrap through the installed
Gateway PS-1 verb (canonicalize → derive → prepare → compose → invoke →
validate → correlate → register transactionally) with idempotent replay
and remove→re-add store reuse, deregister-only `project remove`,
deterministic `project list`, the full read-only `doctor` probe suite with
the closed vocabulary and truthful limitations, `start` runtime
composition with protocol-clean inherited stdio and truthful exit/signal
propagation, an operation-wide lock with documented ordering, typed
failure/residual semantics that never touch Gateway store state, the
SIR-PS2-009 black-box conformance check against the exact pinned Gateway
boundary (green), zero network/shell/authority leakage (static-guard
pinned), the PS-3 installer behavior unchanged, and 179/179 focused tests
green with clean typecheck/reproducibility/diff checks. Ready for senior
review.

---

## 26. Post-review focused corrections (SIR-PS4-001..008)

Recorded after the PS-4 senior review (`pi-shuttle-ps-4-project-lifecycle-
doctor-start-senior-review.md` — verdict ACCEPTED). This section corrects
§24's Git-status classification (SIR-PS4-007) and records the focused
corrections; historical totals above are not overwritten.

| Finding | Disposition | Correction |
|---|---|---|
| SIR-PS4-001 (MODERATE, PRODUCT) | **CLOSED** | `correlateResolvedSurface` now requires the resolved workspace `artifactLocation` to equal the prepared `<canonicalRoot>/artifacts`; mismatch fails closed with the bootstrap-mismatch family and truthful store-preserved residual; focused tests (exact acceptance; inside-root and outside-root wrong values rejected; no registration persisted; store residual preserved) |
| SIR-PS4-002 (MINOR, PRODUCT) | **CLOSED** | `start` preflight now requires `<locator>/store-v1` local presence before spawn (`ERR-PS4-START-STORE-V1-MISSING`, local-observation semantics, never a trusted-verification claim; no store state created); focused tests (locator-present/store-v1-missing refuses with no child and no mutation; store-v1-present proceeds) |
| SIR-PS4-003 (MINOR, ARCHITECTURE) | **CLOSED** | signal-forwarding listeners (SIGINT/SIGTERM/SIGHUP) are lifecycle-local and removed at terminal state (ordinary exit, signal exit, spawn failure); no `removeAllListeners`; focused tests (no accumulation across repeated start invocations; unrelated listeners untouched) |
| SIR-PS4-004 (MINOR, TEST/EVIDENCE) | **CLOSED** | real-CLI add-vs-remove contention test: slow re-add holds `project.lock`, competing remove returns deterministic `ERR-PS4-BUSY`, final state = exactly one coherent registration, store intact, lock released; lock order `project.lock → runtime.json.lock` pinned |
| SIR-PS4-005 (MINOR, TEST/EVIDENCE) | **CLOSED** | Gateway conformance probe's post-EOF shutdown wait is bounded (deadline + safe SIGKILL + clear conformance-timeout failure); alive-window proof unchanged; real Gateway fixture kept; re-run 0 skipped |
| SIR-PS4-006 (MINOR, OPTIONAL HARDENING) | **DEFERRED** | operator-boundary `mkdir` may follow a same-user pre-existing symlink; no generalized no-symlink filesystem policy introduced in this gate; hardening candidate for a later gate |
| SIR-PS4-007 (MINOR, DOCUMENTATION) | **CLOSED** | §24 corrected: `tests/unit/doctor.test.ts` is tracked and modified (` M`), not untracked; this section records the correction evidence |
| SIR-PS4-008 (MINOR, OPTIONAL HARDENING) | **DEFERRED** | `start` rechecks bin regular-file presence but does not revalidate full package identity; `start` is not expanded into a second installer/package verifier; hardening candidate for a later gate |

SIR-PS2-009 remains **VERIFIED CLOSED BY PS-4** (real black-box Gateway
conformance, 0 skipped on the validated environment — re-verified after
the corrections).

**Updated test totals (post-correction):** see the PS-4 focused rereview
report (`pi-shuttle-ps-4-project-lifecycle-doctor-start-focused-rereview.md`)
for the exact post-correction `npm test` total; the pre-correction total of
179 run / 179 pass / 0 fail / 0 skip is preserved above and not overwritten.

---

PS-4 PROJECT LIFECYCLE / DOCTOR / START — READY FOR SENIOR REVIEW

PS-4 FOCUSED CORRECTIONS — REREVIEW STATUS: see focused-rereview report
