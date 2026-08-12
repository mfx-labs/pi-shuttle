# PS-2 — pi-shuttle CLI / Configuration Model — Implementation Report

**Status:** Implementation complete; uncommitted, unstaged, awaiting senior
review. No commit, no remote, no publication in this gate.

## 1. Baseline SHA

- Baseline HEAD: `f190b32da520e890e72a8f59f8c250f3efeb2007`
  (`docs: establish pi-shuttle PS-0 product contract`), verified unchanged
  before and after implementation.
- Gateway PS-1 baseline referenced (untouched, separate repository):
  `7f3b4afdb43704e7dac82da7b086d8367347c641`.
- pi-guard: separate component, not modified.

## 2. Approved PS-2 objective

Per work-packages PS-2: "the pi-shuttle skeleton: layout, manifest
embedding, runtime-config read/write (atomic, 0600), identity derivation
helpers, version/lane constants, `--help`/`--version`, doctor skeleton with
the status taxonomy." This report records what is implemented vs
intentionally deferred; the full end-user workflow is NOT claimed to work
after PS-2.

## 3. Package/toolchain established

- `package.json`: name `pi-shuttle`, version `0.1.0`, `private: true`,
  `license: UNLICENSED` (no public license/name decision exists in the
  contract; these are the truthful unpublished defaults), `"type": "module"`,
  one bin (`pi-shuttle` → `dist/cli.js`), engines `node >=22.0.0`,
  `files: ["dist"]`.
- **Zero runtime dependencies** (no installer/network/framework). Dev-only:
  `typescript 7.0.2`, `@types/node 26.1.2` (exact pins mirroring the
  Gateway toolchain).
- Build: `tsc` → `dist/`; tests compile to `dist-test/` and run under
  `node --test` (same pattern as the Gateway repo). Node 22 lane, ESM,
  strict TypeScript, deterministic output.
- `npm install` created `node_modules/` (gitignored) and `package-lock.json`
  (untracked; commit decision deferred to the PS-2 review/commit gate).

## 4. Exact public CLI grammar (closed)

```text
pi-shuttle doctor
pi-shuttle project add <path>
pi-shuttle project list
pi-shuttle project remove <path-or-workspace-id>
pi-shuttle start
pi-shuttle --help
pi-shuttle --version
```

- Parser is a small explicit pure function (`src/command/parse.ts`); no CLI
  framework. Exact cardinality: `project add`/`project remove` require
  exactly one non-empty, non-`-` operand; `project list`, `doctor`,
  `start`, `--help`, `--version` accept no operands; unknown commands,
  unknown options, extra operands, empty operands all fail closed.
- No hidden generic commands exist or can parse (no shell/exec/admin/
  init-store/grant/approve/activate/issue/receipt vocabulary).
- **Closed exit-code model** (defined once in the dispatch and help text):
  `0` success; `1` operational failure (deferred handlers, invalid config);
  `2` malformed invocation (and doctor's unsupported-platform verdict, per
  operator-cli-contract §2).
- Help/version are deterministic and require zero initialized state.

## 5. Exact functionality implemented vs intentionally deferred

| Command | PS-2 state |
|---|---|
| `--help`, `--version` | **Implemented** (deterministic text; version prints the manifest's pinned components per operator-cli-contract §8) |
| `doctor` | **Skeleton implemented (PS-2 scope)**: closed status vocabulary, deterministic renderer, and the observations PS-2's model can truthfully make without subprocess probes (platform/architecture lane claims, runtime-config state). **Deferred to PS-4**: all component probes (node, git, pi, gateway component, pi-guard, trusted stores, ChatGPT/tunnel readiness) — reported as deferred, never fabricated |
| `project add/list/remove` | Grammar **implemented**; operational behavior **deferred to PS-4** (canonicalization, Gateway bootstrap subprocess composition, persistence wiring). Handlers fail closed with a typed `PS-4`-owned message, exit 1 |
| `start` | Grammar **implemented**; operational behavior **deferred to PS-4** (Gateway process composition). Fails closed, exit 1 |

## 6. Configuration model

`src/config/document.ts` — pi-shuttle's OWN operator composition document
(`~/.config/pi-shuttle/runtime.json`, operator-cli-contract §7): the
Gateway startup-document shape (`surfaces[]`, fields per
component-boundaries §3) with **closed-field shape validation only** —
surfaceId, locator (absolute), serviceUid (non-negative safe int),
forbiddenRoots (absolute array), configurationIdentity (`sha-256:<64hex>`
syntax; REQUIRED, matching the post-PS-1 runtime profile), configurationVersion,
limitProfile (number values), workspaces (workspaceId/root/artifactLocation),
gitPath/gitHome/gitTmpdir. Duplicate surfaceIds rejected.

Authority classes kept visibly separate: this is ordinary operator-owned
application config — **not** Gateway trusted configuration. No identity
derivation, no provenance, no capability/brand material, no approval/
issuance vocabulary lives here; the Gateway loader remains the authority
for the document at startup. `src/config/json.ts` provides the bounded
(1 MiB) fd-bound read and a **correct duplicate-key scanner** (raw
tokenizer with full escape handling, so `{"a":1,"a":2}` and escaped-key
duplicates are both rejected) before `JSON.parse`.

## 7. Filesystem/state layout

`src/host/environment.ts` — the approved portable layout
(installation-contract §8) resolved from the injected home:
`~/.local/share/pi-shuttle` (share: stores/packages/git-home/git-tmp/
manifests), `~/.local/state/pi-shuttle` (install receipt/staging/logs),
`~/.config/pi-shuttle` (runtime.json), `~/.local/bin`. Identical on Linux
and macOS; no `~/Library/...` specialization (PS-6 owns macOS host-lane
semantics). `process.env` is confined to this seam; no hard-coded
`/home/chef`, no hard-coded `/usr/bin/git`, no sudo. `canonicalizePath`
(realpath, fail closed) is the security-relevant canonicalization seam.

## 8. Project registry model

`src/registry/identity.ts` — deterministic derivation per
operator-cli-contract §3: `storeId = sha256(canonicalRoot).hex.slice(0,32)`,
`workspaceId = "pgw:w:" + storeId`, `locator = <shareDir>/stores/<storeId>`.
Input MUST be canonical (PS-4 canonicalizes operator input first). This is
pi-shuttle's own path-derived opaque identity — NOT the Gateway WP-6
configuration identity (that stays inside the Gateway bootstrap verb).

`src/registry/model.ts` — pure transitions over the runtime document:
`registerSurface` (idempotent exact re-registration is a no-op; duplicate
surfaceId / duplicate store locator / duplicate workspace identity fail
closed — equivalent canonical paths derive the same storeId/locator and
are therefore rejected by construction), `deregisterSurface` (deregister
ONLY; by surfaceId/workspaceId/canonical root; unknown fails closed; the
model has no deletion capability and never references store paths beyond
the inert `locator` string), `listSurfaces` (deterministic code-unit
ordering by surfaceId).

## 9. Persistence semantics

`src/persistence/writer.ts` — the SINGLE authoritative writer
(`writeFileAtomic`): atomic publication (same-dir tmp `wx` 0600 + fchmod +
complete-buffer write loop + fsync + rename + dir fsync), parent dirs 0700
created only when missing, exact 0600 target, identical-content idempotent
no-op (no rewrite), fail-closed on incompatible existing state via an
injected `isCompatible` predicate (foreign/malformed content is never
silently overwritten), failure-path tmp cleanup, no partial final-file
exposure. The complete-write loop and the narrow injectable write seam
mirror the approved PS-1 output-writer pattern (SIR-PS1-002). No Gateway
storage engine is copied; the two authority classes remain separate.

## 10. Compatibility representation

`src/compat/manifest.ts` — the pinned manifest shape (product-contract §6)
as frozen constants: pi-shuttle 0.1.0; gateway 0.1.0 at the **PS-1
baseline `7f3b4afdb43704e7dac82da7b086d8367347c641`**; gateway deps
`@modelcontextprotocol/server@2.0.0`, `ajv@8.20.0`, `zod@4.4.3`; pi-guard
0.1.2 at `7a7580cc4cbd7926797564c72269394fc29a860a`; Pi baseline `0.83.0`
(`pi-0.83.0-extension-api-v1`); node 22.23.2; git 2.45.4;
configurationVersion 2; configFormatVersion 1.

Truthful only: artifact SHA-256 digests are `null` (computed at release —
the contract's own `<computed-at-release>` placeholder); **no `latest`, no
semver ranges, no Pi 0.84.x claims**. Lanes: `supportedLanes = [linux-x86_64-posix-utf8-node22]`;
`darwin-arm64-posix-utf8-node22` is represented as a **gated lane only**
(PS-6 evidence required; never claimed).

## 11. Host abstraction

Minimal injectable `HostEnvironment` (home/platform/arch) + layout
resolution + canonicalization + lane mapping, all in `src/host/environment.ts`.
No subprocess execution exists anywhere in PS-2 src (static-guard pinned);
later work packages inject their own composition rather than coupling PS-2
to Git/Pi/Gateway processes.

## 12. Authority/boundary assessment

PS-2 introduces **no** trusted lifecycle authority: no approval, issuance,
activation, grant, receipt, RuntimeGrant, TrustedReceipt, Gateway bootstrap
provenance, ExecutionResult, or trusted-input vocabulary exists in src
(static-guard pinned, and the guard's fs/import confinement is structural).
The only filesystem mutations are pi-shuttle's own config/state writes
through the single writer; `project remove` semantics are deregister-only
in the model. When PS-4 later invokes Gateway bootstrap, authority remains
in the Gateway's operator-only verb (PS-1 baseline); pi-shuttle composes
that boundary, never duplicates it.

## 13. Files changed

**New (production, 12 files):** `src/cli.ts`, `src/app.ts`,
`src/command/parse.ts`, `src/command/help.ts`, `src/command/doctor.ts`,
`src/config/json.ts`, `src/config/document.ts`, `src/registry/identity.ts`,
`src/registry/model.ts`, `src/compat/manifest.ts`,
`src/host/environment.ts`, `src/persistence/writer.ts`.

**New (tests, 8 files):** `tests/unit/cli.test.ts`, `config.test.ts`,
`registry.test.ts`, `persistence.test.ts`, `host.test.ts`, `doctor.test.ts`,
`manifest.test.ts`, `static-guard.test.ts`.

**Tooling:** `package.json`, `tsconfig.json`, `tsconfig.tests.json`,
`package-lock.json` (untracked).

**Docs:** `README.md` (status/layout truthfulness only). No PS-0 contract
document was modified. No new ADR: every resolved detail (exit-code model,
lane gating, doctor-skeleton split, writer semantics) is a mechanical
resolution inside the approved envelope, recorded here.

## 14. Focused tests and exact results

`npm test` (clean build + tests compile + `node --test`), Node v22.23.2,
TypeScript 7.0.2:

**49 tests run / 49 pass / 0 fail / 0 skip.** Coverage: every approved
grammar case + 19 malformed shapes; deterministic help/version; exit
classification 0/1/2 (unit + real-CLI subprocess); closed-field rejection
(15 cases incl. duplicate surfaceId); duplicate-key rejection incl.
escaped keys; deterministic round-trip serialization; identity formula
pinned against the contract; registry add/deregister/list incl. all
conflict codes; writer atomicity/0600/0700/idempotence/incompatibility/
short-write/zero-progress-cleanup/unwritable-parent; doctor vocabulary (all
five values), lane verdicts incl. gated macOS, config finding; manifest pin
truthfulness incl. no-latest/no-0.84; static guards (import confinement,
process.env/crypto/fs localization, no authority vocabulary, single bin,
zero runtime deps). `npm run typecheck` clean. `git diff --check` clean.

## 15. Deviations from contract

None material. Resolutions inside the approved envelope:

1. **Doctor skeleton scope**: PS-2 observes only platform/architecture and
   runtime-config state; component probes are reported as deferred (PS-4)
   rather than fabricated — consistent with the approved "doctor skeleton"
   ownership and the closed status vocabulary.
2. **Lane representation**: `darwin-arm64` is a gated lane, not a
   supported claim, until PS-6 evidence exists (platform-support-contract
   §4: "the manifest IS the claim").
3. **Package identity**: `private: true` + `UNLICENSED` until a public
   name/license decision exists (contract leaves it unresolved).
4. **Exit-code model**: 0/1/2 closed set, consistent with the doctor
   contract and the Gateway CLI convention.

## 16. Open risks / dependencies on later work packages

- **PS-3**: installer must consume the manifest representation and replace
  the `null` artifact digests with release-computed SHAs; receipt model
  (`install.json`) is path-resolved but not read in PS-2.
- **PS-4**: project lifecycle operational handlers (canonicalization,
  Gateway bootstrap subprocess, registry persistence via `writeFileAtomic`
  with the document-compatibility predicate), full doctor probes, `start`
  composition; `project remove` must preserve stores (model already
  deregister-only).
- **PS-6**: macOS arm64 support requires the Gateway host-lane change; the
  gated lane moves to `supportedLanes` only with evidence.
- APFS case-insensitivity: PS-2's representation is neutral (path-derived
  identities over canonical roots); the PS-6 ADR must assess case
  semantics before macOS claims.
- The doctor skeleton intentionally under-reports vs the final doctor;
  PS-4 must extend observations, not change vocabulary or exit codes.

## 17. Git status

```
 M README.md
?? src/
?? tests/
?? package.json
?? package-lock.json
?? tsconfig.json
?? tsconfig.tests.json
```

All PS-2 changes are **uncommitted and unstaged** (PS-0 baseline files
remain committed; nothing modified outside the authorized set). No remote
configured; no GitHub repository created; no push/tag/publish/deploy; no
Gateway or pi-guard modification; no macOS host-lane implementation; no
installer; no network behavior.

## 18. Readiness verdict

PS-2 delivers the smallest robust pi-shuttle foundation per the approved
contract: closed CLI grammar with deterministic exit classification, the
operator runtime-document model (shape-only, clearly separated from
trusted Gateway configuration), deterministic project identity derivation,
pure registry transitions with deregister-only semantics, a single
authoritative atomic 0600 persistence writer, a truthful compatibility
manifest, an injectable host seam, a doctor skeleton with the exact status
vocabulary, and focused tests + static guards — with PS-3/PS-4/PS-6
dependencies recorded honestly. Ready for senior review.

---

# 19. Post-senior-review corrections (SIR-PS2) — supersedes the sections above where they conflict

Senior review: `docs/reports/pi-shuttle-ps-2-cli-config-senior-review.md` —
verdict CORRECTIONS REQUIRED. Original implementation test total:
**49/49**. This chapter records the authorized corrections; historical
evidence above is preserved. Three original claims are superseded:
(1) "foreign/malformed content is never silently overwritten" — false under
concurrency (SIR-PS2-001); (2) "mirror the approved PS-1 output-writer
pattern" — true for the write-loop seam, but the publication primitive
differs (rename vs PS-1's link no-clobber) and needed a concurrency guard;
(3) doctor `missing`-exits-0 and the help text's exit-2 wording were
inconsistent with the approved exit model (SIR-PS2-003/004).

## 19.1 SIR-PS2-001 + SIR-PS2-002 (CLOSED) — concurrency-safe transactional persistence

**Root cause (one):** read/check → compute → temp → `renameSync` over
target; POSIX rename replaces, so the compatibility check was not atomic
with publication and concurrent writers lost updates while reporting
success (senior review's read-only experiments: deterministic
incompatible-overwrite; 30/30 success → 1 surface survived, 3/3 runs).

**Correction design** (`src/persistence/writer.ts`):

- New **transactional primitive** `mutateDocumentAtomically<T>(path,
  { decode, transition, serialize, write? })` — the logical state
  transition runs under an exclusive sibling lock artifact
  (`<path>.lock`):
  `acquire → read current state → decode → transition → serialize →
  durable publish → verify → release`.
- The transition function receives the CURRENT authoritative state
  (read AFTER lock acquisition); callers cannot pre-read and compute
  outside the boundary — stale snapshots cannot report success by
  construction.
- **Lock acquisition** is atomic via `openSync(lockPath, 'wx')`
  (O_CREAT|O_EXCL — Node-core, no flock dependency, portable POSIX
  Linux/macOS). Contention wait is **bounded** (20 × 25 ms ≈ 500 ms,
  `Atomics.wait` sync sleep); exhaustion → deterministic
  `ERR-PS2-CONFIG-BUSY`. No unbounded busy loop, no deadlock.
- **Stale locks are never auto-stolen** (no time/PID guessing): a lock
  surviving process death fails closed with `ERR-PS2-CONFIG-BUSY` and
  explicit operator recovery guidance ("remove the stale lock file").
  Operational limitation recorded for PS-4/doctor follow-up (doctor
  should detect a stale `<path>.lock` and report it).
- **Incompatible state** (decode → null, unreadable, oversized) fails
  closed with `ERR-PS2-CONFIG-INCOMPATIBLE` under the lock; foreign
  content is never replaced. Post-publication **verification**: the
  published file is read back and byte-compared (bounded read; oversized
  documents — outside the model — skip verification) — a mismatch fails
  `ERR-PS2-WRITE-VERIFY` instead of reporting success.
- **Raw `writeFileAtomic`** remains as the low-level atomic byte
  publisher (temp wx 0600 + complete-write loop + fsync + rename + dir
  fsync; identical-content no-op; failure cleanup) with its `isCompatible`
  option REMOVED — compatibility semantics now live ONLY under the
  transaction boundary. Documented: raw writer is for single-writer
  contexts; state transitions MUST use `mutateDocumentAtomically`.
- Registry transitions remain pure functions
  (`src/registry/model.ts` unchanged); persistence invokes them while
  holding the boundary. Authority separation unchanged: ordinary
  pi-shuttle-owned config/state, not Gateway trusted storage.

**Concurrency semantics (v0.1.0):** serialized success — every reported
success is present in the final state; competing operations that exhaust
the bounded wait fail `ERR-PS2-CONFIG-BUSY` (never silent loss).
Non-cooperating writers (arbitrary processes that ignore the lock) can
always clobber any file — documented boundary, not defended against.

**Acceptance evidence (executable):** 8 real processes × 3 runs — all
succeed, all 8 surfaces present per run; a separate 30-process × 3 runs
reproduction of the senior review's experiment — **0 failures, 30/30
surfaces survive** (previous behavior: 30/30 success → 1 survives, is
impossible now). Deterministic tests: BUSY under a held lock with the
foreign target surviving; INCOMPATIBLE after release with the foreign
target still preserved; zero-progress publish failure cleans tmp and
releases the lock; transition failure writes nothing; exact
re-registration stays an idempotent no-op.

## 19.2 SIR-PS2-003 (CLOSED) — doctor finding-class verdicts exit 1

`src/command/doctor.ts`: exit classification now mirrors the approved
model (operator-cli-contract §2): `unsupported` → 2 (precedence);
finding-class verdicts (`missing`, `installed but unverified`, `partial
installation`) → **1**; otherwise 0. `runtime configuration: missing`
now exits 1. Tests updated at unit and real-CLI subprocess level; the
closed verdict vocabulary is unchanged; no PS-4 probes fabricated.

## 19.3 SIR-PS2-004 (CLOSED) — help text exit-2 semantics

`src/command/help.ts` exit-code line now reads: "0 success; 1 operational
failure (findings, missing state); 2 malformed invocation or unsupported
platform/architecture (`doctor`)". Deterministic; exit model unchanged.

## 19.4 SIR-PS2-005 (CLOSED) — 1 MiB ceiling exercised by executable tests

`tests/unit/config.test.ts`: exactly-`MAX_CONFIG_BYTES` file accepted;
`MAX + 1` rejected with `ERR-PS2-READ-TOO-LARGE` (stat path); the
**read-loop** ceiling (growth-after-stat) proven deterministically via
`/dev/zero` (fstat reports size 0, unbounded content — the loop rejects
`ERR-PS2-READ-TOO-LARGE`). Reader unchanged.

## 19.5 SIR-PS2-007 (CLOSED) — package-lock regenerated

`npm install --package-lock-only`: root `packages[""].devDependencies`
now records the exact pins `@types/node 26.1.2`, `typescript 7.0.2`
(was `^26.1.2`/`^7.0.2`); zero runtime dependencies; resolved versions
exact; `npm ci --dry-run` succeeds. No package upgrades.

## 19.6 SIR-PS2-010 (CLOSED) — help/version work without HOME

`src/cli.ts` now dispatches the state-free commands (`--help`,
`--version`) BEFORE constructing host/layout state; `src/app.ts` takes an
optional environment and requires it only for `doctor` (missing → exit 2
"HOME is not set"). Real-CLI subprocess tests with HOME removed:
`--help`/`--version` exit 0; `doctor` exits 2. Deterministic, no config/
state reads, no filesystem mutation.

## 19.7 Deferred findings (NOT implemented)

- `SIR-PS2-006 — DEFERRED / OPTIONAL HARDENING` — symlink final-target
  handling. The persistence correction does not change symlink behavior
  (a symlink at the target is still replaced by rename; a symlink at the
  lock path fails closed as a busy lock). Generalized symlink policy
  deferred.
- `SIR-PS2-008 — DEFERRED / OPTIONAL HARDENING` — post-publication fsync
  failure taxonomy and stale-tmp sweeping. Not implemented; no new
  error taxonomy beyond the transaction's `ERR-PS2-WRITE-VERIFY`.
- `SIR-PS2-009 — DEFERRED / PS-4 CONFORMANCE RISK RECORD` — Gateway-shape
  drift check (black-box conformance test against the pinned Gateway
  loader) recommended at PS-4 composition; no schema sharing, no private
  imports.

## 19.8 Post-correction focused test inventory and totals

`npm test` (clean build + tests compile + `node --test`), Node v22.23.2,
TypeScript 7.0.2 — **60 tests run / 60 pass / 0 fail / 0 skip**;
`npm run typecheck` clean; `git diff --check` clean; `npm ci --dry-run`
green.

Suite inventory: `cli` 10 (grammar 2, dispatch 5 incl. help/version
without env + exit-2 help text, subprocess 2 incl. HOME-less, deferred 1);
`config` 8 (round-trip, determinism, closed fields, malformed, duplicates,
false-positive freedom, absent-vs-invalid, ceiling); `registry` 6;
`persistence` 15 (raw guarantees 7 + transaction 6 + multi-process 1 +
BUSY 1); `host` 4; `doctor` 7; `manifest` 4; `static-guard` 6.

No Gateway/pi-guard/platform/network scope expansion: the correction adds
only the lock artifact + transaction primitive (Node-core `openSync 'wx'`,
`Atomics.wait`, `SharedArrayBuffer` — no new imports beyond the existing
fs allowlist, no dependencies, no subprocess in production, no network,
no installer behavior, no authority vocabulary). PS-4 handlers remain
deferred and fail closed.
