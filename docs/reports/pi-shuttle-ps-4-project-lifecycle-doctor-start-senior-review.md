# PS-4 — pi-shuttle Project Lifecycle + Doctor + Start — SENIOR SECURITY / ARCHITECTURE REVIEW

**Review mode:** READ-ONLY, adversarial, risk-focused. No production code,
tests, or normative contract docs modified. No stage, no commit, no remote.
The only repository file created is this report.

**Reviewer stance:** the HUMAN-APPROVED contract (PS-0 docs, ADR-001,
PS-2/PS-3 gates) is normative; the PS-4 implementation report was treated
as an unproven claim throughout and verified independently.

---

## 1. Baseline / reviewed tree

| Item | Expected | Observed | Status |
|---|---|---|---|
| pi-shuttle HEAD | `7622ad90da6a6b2772f1a19a56492c52f70b4881` (`feat: establish pi-shuttle PS-3 installer component composition`) | identical | ✓ |
| Gateway HEAD | `7f3b4afdb43704e7dac82da7b086d8367347c641` (PS-1 operator bootstrap) | identical | ✓ |
| pi-guard | `v0.1.2` @ `7a7580cc4cbd7926797564c72269394fc29a860a` | identical (tag == HEAD) | ✓ |
| Remotes | none configured on pi-shuttle / Gateway | none; pi-guard has its pre-existing `origin` only | ✓ no mutation |
| PS-4 tree | uncommitted / unstaged | confirmed — see §30 | ✓ |

No external repository was modified. Gateway and pi-guard were inspected
read-only.

## 2. Scope

**PS-4 owns (verified present):** real `project add`; real `project list`;
deregister-only `project remove`; full local `doctor`; real `start`;
Gateway operator-bootstrap composition; runtime-config composition;
Git/Pi/Gateway read-only operational probes; operation-wide project-state
locking; black-box Gateway conformance closing SIR-PS2-009.

**PS-4 does NOT own (verified absent):** no Gateway source changes
(Gateway HEAD untouched); no pi-guard source changes; no trusted Gateway
authority reimplementation (no `initializeTrustedStore`,
`computeTrustedConfigurationIdentity`, provenance or capability vocabulary
anywhere in `src/` — static guard + grep); no macOS Gateway support
(darwin arm64 is gated, `unsupported`, never claimed); no network
acquisition; no Secure MCP Tunnel (no network imports at all); no ChatGPT
setup (PS-7 note only); no installer redesign (PS-3 installer behavior
byte-identical — see §24); no destructive trusted-store deletion; no Git
mutation (only the read-only `rev-parse --git-dir` probe); no
release/publication.

Scope discipline: **no boundary violations found.**

## 3. Process-boundary assessment

PS-3's installer runner was extracted to `src/process/runner.ts`; the
installer module (`src/installer/process.ts`) is now a re-export shim.

- **Move was verbatim.** Diff of PS-3 `installer/process.ts` against the
  new runner: implementation byte-identical (doc comments only). The
  shim re-exports the same names; installer call sites unchanged.
- **Installer tests still exercise the shared implementation** — all
  `installer-*.test.ts` suites are untouched and green (part of 179/179).
- **argv-array execution remains the only bounded probe model**;
  `runProcess` semantics unchanged (64 KiB bounded capture, timeout,
  deterministic code/signal result).
- **No `shell: true` anywhere** in `src/` (grep + static guard).
- **No generic arbitrary-executable/command interface** leaked into
  application layers: `node:child_process` import is confined to
  `runner.ts`; `spawn(`/`exec(` absent from all other modules.
- **Executable classes fixed by trusted composition:** bootstrap =
  `node <receipt-pinned gateway bin> bootstrap --config <input> --output
  <resolved>`; start = `node <receipt-pinned gateway bin> --config
  <runtime.json>`; probes = PATH-discovered `git`/`pi` + running node. No
  operator-supplied command strings are ever executed (paths are argv
  elements only).
- **Output bounds / timeout semantics intact** (bootstrap 60 s; probes
  10–15 s; probe capture 64 KiB each).
- **SIR-PS3-012 remains OPTIONAL and was not worsened:** the deferred
  grandchild-pipe hang risk applies to `runProcess` pipe capture
  (unchanged from PS-3). `spawnGatewayForStart` uses inherited stdio
  with no pipes, so it cannot exhibit the SIR-PS3-012 hang mode at all.

**`spawnGatewayForStart` (separate review):** fixed executable class
(node + receipt-pinned Gateway bin), fixed argv (`--config <runtime>`),
`stdio: 'inherit'`, env = operator env. It is the **ONLY** inherited-stdio
production spawn in the product (static guard pins `stdio: 'inherit'` to
the runner and `spawnGatewayForStart` to `src/lifecycle/start.ts`).
Inherited stdio is contractually appropriate because `start` fronts MCP
stdio (operator-cli-contract §6). Probe and bootstrap paths never inherit.

## 4. Project identity / canonicalization

Operator path flow traced: `inputPath` → `canonicalizePath` (`realpathSync`,
host seam) → `isDirectory` → Git probe → `deriveStoreId/WorkspaceId/
SurfaceId/Locator(canonicalRoot)`.

- **Nonexistent path fails closed** — `ERR-PS4-ROOT-UNRESOLVABLE`
  (tested).
- **Canonicalization uses real filesystem resolution** (`realpathSync`),
  not string normalization.
- **Symlinked roots resolve deterministically** — symlink input registers
  under the canonical root; identity derives from the canonical root only
  (tested: symlink fixture asserts `workspace.root == real` and
  `surfaceId == deriveSurfaceId(real)`).
- **Exact PS-2 formula unchanged** — `src/registry/identity.ts` diff is
  only the additive `deriveSurfaceId`. Independently recomputed
  `sha256(canonicalRoot).hex.slice(0,32)`, `pgw:w:<32hex>`, locator
  `share/stores/<32hex>` for a fixture root; matches implementation and
  determinism holds.
- **No mutable display name participates in authority identity** — the
  only identity inputs are the canonical root (workspace/store/surface)
  and the Gateway-validated trusted configuration (configurationIdentity,
  Gateway-derived). Display strings never appear in any identity.
- **No macOS case-folding behavior introduced** — no case-insensitive
  logic; darwin is gated before any derivation (`ERR-PS4-PREFLIGHT-
  PLATFORM`, exit 2).
- **No project contents modified by registration** — fixture asserts
  `readdirSync(root)` == `[MARKER.txt, artifacts]`; only the
  contract-approved `artifacts/` dir is created (§6).

**Independent identity recomputation:** performed (see §4 above) — exact
PS-2 formula confirmed.

## 5. Operator directory preparation

`prepareOperatorDirs` creates exactly: store **parent** locator
(`share/stores/<storeId>`, 0700, recursive), `share/git-home/<storeId>`
and `share/git-tmp/<storeId>` (0700, empty by construction), and
`<canonicalRoot>/artifacts` (0700, only when absent; existing non-directory
fails closed `ERR-PS4-STATE-ARTIFACTS`).

- Only pi-shuttle/Gateway operator-owned paths are created; the Gateway's
  internal trusted-store structure (`store-v1/`, `config-v1/`, metadata,
  tmp) is **not** created by pi-shuttle — the real Gateway's
  `initializeTrustedStore` provisions it (black-box conformance test
  proves the full chain).
- Modes are restrictive (0700 parents; the Gateway re-verifies ownership
  and modes at initialization).
- Project root is not mutated beyond the approved `artifacts/` dir.
- Git home/tmp isolation paths live under `share/`, outside project
  contents.
- Pre-existing foreign paths fail closed: non-directory at a target →
  `ERR-PS4-STATE-NOT-DIR`; existing directories are never chmodded
  (documented; the Gateway's ownership/mode verification is the second
  line).
- Symlink case: `mkdirSync(recursive)` follows a pre-existing same-user
  symlink at a target path; `isDirectory` (stat, follows) then passes.
  Self-inflicted only (same operator, same user) and the Gateway's
  no-follow store verification applies at store level. Recorded as
  OPTIONAL HARDENING (SIR-PS4-006), no evidence of cross-boundary
  exploitation.

## 6. Gateway bootstrap authority boundary — HIGH PRIORITY

Traced end to end:

```
pi-shuttle project add
  → composeBootstrapConfig()          (ordinary operator document, 0600, state-dir probe file)
  → node <installed gateway bin> bootstrap --config <input> --output <resolved>
      → Gateway loadBootstrapConfig() → WP-6 Phase-1 validation + resolvers
      → computeTrustedConfigurationIdentity()          (Gateway-owned)
      → createStorageBootstrapActionProvenance()       (Gateway-owned)
      → initializeTrustedStore() / replay              (Gateway-owned)
      → resolved runtime config → --output (0600, atomic, no-clobber)
  → pi-shuttle validates + correlates + registers
```

pi-shuttle does **NOT** (verified by grep + static guard + code trace):
import Gateway private modules (no imports outside its own tree; the
conformance fixture is a test-only path); call `initializeTrustedStore`
(vocabulary forbidden and absent); construct trusted provenance (absent);
compute `configurationIdentity` (absent — it arrives from the verb and is
persisted verbatim); mint authority (no capability/brand vocabulary);
use MCP to bootstrap (argv CLI only).

**Bootstrap input fields** (`composeBootstrapConfig`): `surfaceId`,
`locator`, `forbiddenRoots=[canonicalRoot]`, `configurationVersion='2'`
(manifest), `limitProfile={}`, one `workspaces` entry (workspaceId,
canonical root, artifactLocation), `gitPath` (PATH-discovered absolute),
`gitHome`/`gitTmpdir` (pi-shuttle-owned). `configurationIdentity` is
omitted (Gateway derives); `serviceUid` is omitted (Gateway defaults to
the process UID of the node running the verb — a Gateway-owned output).

Every input field is derived from HUMAN-APPROVED pi-shuttle facts or is a
Gateway-owned output. **No hidden duplicated trusted-authority logic
found.**

## 7. Bootstrap input correctness

Generated document inspected (fixture + real conformance run):
- canonical project root ✓ (correlated post-hoc, §8)
- workspace identity ✓ (`pgw:w:<32hex>`)
- surface identity ✓ (`pgw-<32hex>`, inside the Gateway's closed
  logical-identifier grammar — verified: `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/`,
  ≤ 64 chars; the `:` of the workspaceId form is outside that grammar, so
  the separate surface derivation is a legitimate mechanical resolution,
  documented in `registry/identity.ts`)
- locator ✓ (share/stores/<storeId>)
- service UID — omitted; Gateway-derived (process UID), which equals the
  operator's UID because the verb runs as the operator
- forbidden roots ✓ `[canonicalRoot]` — matches the Gateway PS-1
  bootstrap contract's notion of governed roots; no over-broad authority.
  pi-shuttle-owned state/config/package dirs are not *forbidden roots*,
  but they are outside every project root and the contract does not
  require their exclusion from the per-project forbidden set — no new
  policy invented here
- configuration version ✓ `"2"` (manifest-pinned)
- Git executable ✓ discovered absolute path (never `/usr/bin/git`)
- isolated gitHome/gitTmpdir ✓
- artifact location ✓ `<canonicalRoot>/artifacts`
- limit profile ✓ `{}` (Gateway merges repository defaults)

**Cross-project addressability:** one project's surface cannot address
another project's locator/root: the locator is a pure function of the
canonical root, resolved output is correlated per-project (§8), and the
registry rejects a second surface sharing a locator or workspace identity
(`ERR-PS2-REG-DUPLICATE-STORE` / `-WORKSPACE`).

## 8. Gateway-output correlation — HIGH PRIORITY

`correlateResolvedSurface` fails closed on ANY mismatch of: surfaceId,
locator, configurationVersion, workspace count (must be exactly 1),
workspaceId, workspace root, gitPath, gitHome, gitTmpdir, forbiddenRoots
(set equality). Output must parse through the PS-2 closed model (unknown
fields rejected, duplicate keys rejected, 1 MiB ceiling), exactly one
surface, `configurationIdentity` must exist with `sha-256:<64-hex>`
syntax.

Adversarial cases — all verified fail-closed:
- correct exit + wrong root → `ERR-PS4-BOOTSTRAP-MISMATCH` (unit test +
  adversarial EXP1 via real CLI; no registration persisted)
- wrong workspace id / wrong locator / wrong surface id / wrong
  forbiddenRoots → mismatch path (unit-tested via fixture modes; same
  code path as wrong-root)
- foreign additional surface → `surfaces.length !== 1` →
  `ERR-PS4-BOOTSTRAP-OUTPUT`
- multiple surfaces when one requested → same rejection
- malformed output (invalid JSON) → `ERR-PS4-BOOTSTRAP-OUTPUT`
- missing output on exit 0 → `ERR-PS4-BOOTSTRAP-OUTPUT`
- missing/malformed `configurationIdentity` → PS-2 closed model rejects
  (identity syntax pinned)
- unexpected unknown fields → PS-2 closed model rejects

`configurationIdentity` is **not** recomputed by pi-shuttle — it must
exist, be syntactically valid, and is accepted as Gateway-owned output;
identity drift between re-adds is caught by the registry's exact-surface
comparison (`ERR-PS2-REG-DUPLICATE-SURFACE`, fail closed).

**Gap:** the resolved workspace's `artifactLocation` is NOT correlated
against the prepared `artifactsDir` — see SIR-PS4-001. (`serviceUid` is
also uncorrelated, but it is Gateway-defaulted from the process UID, not
an operator-owned input, so that is correct.)

## 9. Bootstrap-success / registration-failure residual semantics — HIGH PRIORITY

Two state domains confirmed non-atomic: Gateway trusted store vs.
pi-shuttle operator registry. Failure sequence reproduced
(adversarial EXP2 via real CLI): Gateway bootstrap succeeds (store
initialized, `store-v1/metadata.json` present) → `runtime.json` blocked
by a directory → registration fails `ERR-PS4-REGISTER-FAILED`.

Required behavior — all verified:
- **Gateway trusted store NOT deleted** — locator and store intact after
  the failure (EXP2 asserts `store-v1/metadata.json` exists).
- **No full-rollback claim** — the message states the store was
  initialized and is `PRESERVED`, with re-run guidance
  (`re-run pi-shuttle project add <path>` to verify and register).
- **Deterministic re-run/recovery guidance** — re-run is the documented
  recovery; the store is replay-verified on the next add.
- **Later exact re-add safely replays** — EXP5b: re-add after remove
  reports `verification-replay` and the store metadata is byte-identical.
- **No catch/finally path removes the locator/store recursively** — the
  only unlink in the lifecycle is `unlinkIfPresent` on pi-shuttle's own
  state-dir probe files (`ps4-bootstrap-<storeId>*.json`), never store
  state; `rmSync` exists only in PS-3 installer rollback boundaries
  (attempt-created staging/bin paths), never stores.

## 10. Operation-wide lock — HIGH PRIORITY

Complete lock-acquisition inventory (entire production tree):
- `src/persistence/lock.ts` — the single shared primitive (O_EXCL `wx`,
  0600, PID informational content, 20×25 ms bounded wait, deterministic
  `ERR-PS2-CONFIG-BUSY`, never auto-steals, unlink-before-close release).
- `project.lock` (`stateDir/project.lock`) — acquired only by `project
  add` (spans bootstrap + regeneration + registry mutation) and `project
  remove` (spans regeneration + mutation); released in `finally` on every
  path.
- `<runtime.json>.lock` — inner leaf, only via
  `mutateDocumentAtomically` (decode-under-lock, publish, read-back
  verify).
- `install.lock` — only in the PS-3 installer; the installer's receipt
  write nests `<install.json>.lock` inside it.
- `doctor`/`start`/`list` take no locks (read-only).

**Lock-order graph (constructed):**

```
project.lock ──> runtime.json.lock        (add, remove)
install.lock ──> install.json.lock        (installer only)
```

Disjoint sets; `runtime.json.lock` is never acquired before
`project.lock` (the only writers are add/remove, both of which take
`project.lock` first); `install.lock` never nests with `project.lock` in
either order (no code path acquires both). **No cycle exists.**

Verified structurally and behaviorally:
- bounded wait + deterministic BUSY (`ERR-PS4-BUSY`, message names the
  lock and gives stale guidance) — EXP3 (pre-held `project.lock` → BUSY,
  no mutation) and the concurrent same-project add test (one success +
  one BUSY, exactly one registration survives);
- no unsafe stale-lock stealing — lock content (PID) is informational
  only; no PID/time-based steal anywhere;
- ordinary failure releases the lock — `finally` blocks in add/remove;
- stale lock remains fail closed — BUSY + guidance, never stolen;
- lock ownership spans Gateway bootstrap + registry finalization —
  `project.lock` is acquired before `prepareOperatorDirs` and released
  after registration;
- concurrent different-project adds both succeed with no lost updates
  (unit test: 2/2 registrations survive);
- add vs remove contention — same lock, same ordering (structural
  serialization; not directly pinned by a test — see SIR-PS4-004).

## 11. Runtime configuration composition

Authoritative operator config after PS-4 = `~/.config/pi-shuttle/
runtime.json` (the single composition document; written only by add/remove
via the PS-2 transactional writer; read by list/doctor/start; passed
verbatim to the Gateway CLI).

- **Adding B does not erase A** — concurrent different-project add test
  (both registrations survive); sequential adds append.
- **Removing A does not alter B** — two-project remove test asserts the
  remaining surface is intact.
- **Deterministic ordering** — registry appends in add order;
  `list` renders sorted by surfaceId (code-unit order, locale-independent);
  serialization is deterministic (fixed key order, 2-space indent).
- **Gateway-derived `configurationIdentity` preserved unchanged** —
  serialize writes the stored value verbatim; surfaceEqual enforces exact
  equality on re-add.
- **No stale-snapshot overwrite** — decode runs under the runtime lock;
  transition input is always current state.
- **Foreign/malformed current config fails closed** — decode→null →
  `ERR-PS2-CONFIG-INCOMPATIBLE`; never silently replaced (unit tests).
- **Exact no-op replay is idempotent** — `surfaceEqual` → `changed:
  false` → no rewrite (writeFileAtomic identical-content no-op) → report
  "already registered".

## 12. `project add` idempotence / re-add

- **Exact re-add:** same canonical root → same identity → same locator →
  Gateway bootstrap replay (verb's committed replay semantics) → no
  duplicate surface (surfaceEqual no-op) → no new store identity →
  coherent runtime config (unit test + EXP5b, store metadata
  byte-identical across remove/re-add).
- **Remove then re-add:** deregistration only; store survives (EXP5a
  sentinels: `store-v1/metadata.json`, project `MARKER.txt`, `.git`,
  `artifacts/` all present after remove); exact re-add reports
  `state: verification-replay`, same locator, same identity.
- All verified on filesystem evidence in isolated fixtures, not
  implementation assertions.

## 13. `project list`

- Empty state: `no registered projects`, exit 0 (unit test + EXP).
- Deterministic multi-project ordering: sorted by surfaceId (unit test).
- No mutation: read-only, no writer path reachable.
- No Gateway subprocess required: test with `PATH=''` proves it.
- Output does not imply health: registry membership vs. doctor findings
  are separate surfaces; list prints facts only (workspaceId, canonical
  root, surface id, locator).
- Stdout/stderr contract: facts on stdout, typed errors on stderr, exit
  1 on invalid document (`ERR-PS4-LIST-INVALID`).

## 14. `project remove` — deregister-only — HIGH PRIORITY

Every mutation traced: the ONLY filesystem mutation is
`mutateDocumentAtomically` over `runtime.json` (registry entry removal).
Search results:
- `rmSync`/`rmdir`/recursive removal: **absent** from the entire
  lifecycle (`src/lifecycle/**`); `rmSync` exists only in PS-3 installer
  rollback/reservation boundaries.
- `unlinkSync`: only `unlinkIfPresent` on pi-shuttle's own state-dir
  probe files in `addProject`; the remove path never unlinks anything.
- Gateway destructive commands: none (no subprocess at all in remove).
- Store/audit/history/artifacts/pi-guard state: never referenced for
  deletion (grep; the model holds only the opaque `locator` string).

Filesystem sentinels verified after remove (EXP5a + unit tests): store
metadata, project `MARKER.txt`, `.git`, `artifacts/` all survive; the
command prints `trusted store preserved at <locator>`. Unknown target →
`ERR-PS2-REG-NOT-FOUND`, exit 1, nothing changed. After successful
remove, store survival is directly demonstrated (sentinels + byte-identical
re-add in EXP5b).

## 15. SIR-PS2-009 black-box conformance closure — HIGH PRIORITY

Inspected `tests/unit/gateway-conformance.test.ts` independently and ran
it: **3 pass / 0 skip** on this machine.

- **Exact pinned Gateway boundary used:** the real Gateway PS-1 CLI
  (`/home/chef/Documents/Project_Gateway_MCP/dist/runtime/mcp/cli.js`,
  HEAD `7f3b4af…`, invoked in place so ESM imports resolve; never copied,
  never modified; configurable via `PI_SHUTTLE_TEST_GATEWAY_CLI`; skips
  truthfully when absent). No private imports — the test spawns the CLI.
- **pi-shuttle-generated persisted runtime config** is produced through
  the FULL production composition path (`project add` against the real
  `bootstrap` verb, real store initialization, real git 2.45.4 lane, real
  node 22.23.2) and handed to the real Gateway startup boundary
  (`--config <runtime.json>`).
- **Valid composed config accepted:** probe stays alive past a bounded
  window AND shuts down cleanly on stdin EOF (exit 0).
- **Deliberately drifted/invalid rejected:** foreign field → exit 1;
  missing `configurationIdentity` → exit 1 (Gateway's strict runtime
  profile).
- **Not a fake loader, no duplicated pi-shuttle validation:** the
  acceptance probe is the Gateway's own loader/composer/server; pi-shuttle
  validation plays no role in the probe outcome.
- **Alive-window + clean-EOF proof is genuine:** Gateway startup order is
  load → compose (store verification) → serve. Rejection exits 1 with a
  diagnostic in milliseconds; survival past the window plus a clean
  exit-0 on EOF proves the server entered its normal stdio runtime (the
  SDK shutdown path is only reachable from a connected server). Test
  robustness nit (no hard timeout on the post-EOF close, a hung child
  would hang the test) is test-only — SIR-PS4-005.

**SIR-PS2-009 — VERIFIED CLOSED BY PS-4.**

## 16. Git discovery and isolation

- PATH-based resolution (`resolveExecutable('git')`), never
  `/usr/bin/git`; the explicit discovered absolute path is written into
  the bootstrap input and runtime config (`gitPath`), overriding the
  Gateway's compile-time default per contract.
- Version parsing truthful: `/^git version (\S+)/` on actual probe output;
  2.45.4 → `supported`; other → `unsupported`; unparseable → `installed
  but unverified` (presence ≠ lane evidence, kept distinct).
- No Git mutation commands anywhere in pi-shuttle (`rev-parse --git-dir`
  is the only git invocation; the Gateway owns its read-only Git lane
  later).
- `gitHome`/`gitTmpdir` pi-shuttle-owned, 0700, empty, outside workspace
  roots (doctor checks all four conditions; add creates them).
- Operator Git config leakage: the Gateway launches its controlled Git
  child with the isolated HOME/TMPDIR from the runtime config (Gateway
  WP-7 lane semantics — outside pi-shuttle's code, but the config fields
  are correlated and the conformance test exercises the real lane);
  pi-shuttle does not pass the operator's `~/.gitconfig` anywhere.

## 17. Doctor — truthfulness over convenience

Every check reviewed; the closed vocabulary is exactly
`supported | unsupported | installed but unverified | missing | partial
installation` (pinned constant + test; no other public status appears).

| Check | Verdict sources (observed) | Truthful? |
|---|---|---|
| platform | manifest lanes; Linux x64 `supported`; darwin-arm64 gated `unsupported` (PS-6, not claimed); other `unsupported` | ✓ |
| node | running interpreter `--version` == 22.23.2 else `unsupported` | ✓ |
| git | PATH discovery; exact 2.45.4 `supported`; other `unsupported`; unparseable `installed but unverified`; absent `missing` | ✓ |
| pi | presence + version; 0.83.0 `supported`; 0.84.x `unsupported` (contract refusal policy); absent `missing`; unreadable `installed but unverified` | ✓ (EXP8: 0.84.1 → exit 2, never claimed) |
| installation receipt | absent `missing`; invalid → fail closed exit 1; PARTIAL → `partial installation` naming omitted components; COMPLETE → `supported` (mode folded in; unsafe mode → `installed but unverified`) | ✓ |
| gateway component | receipt + package identity (name/version vs manifest) + bin regular-file + bounded `--help` smoke; missing deps → `installed but unverified`; package-without-receipt → `installed but unverified` | ✓ (receipt claim alone insufficient — verified in adversarial run: drifted package name detected) |
| pi-guard | receipt + read-only `pi list` exact-source confirmation; unconfirmable → `installed but unverified`; no enforcement claim anywhere (only source confirmation) | ✓ |
| runtime config | absent `missing`; malformed/foreign → fail closed exit 1; valid → `supported` (+ mode) | ✓ |
| registered projects | per surface: root resolves (canonicalize), locator present, `store-v1` present, locator 0700; missing fact named exactly | ✓ (missing root → `missing` finding) |
| git isolation | exists, directory, no group/world bits, outside roots, empty | ✓ |
| coordination locks | present → `installed but unverified` ("artifact present, liveness unconfirmable") with never-auto-steal guidance; absent → `supported` | ✓ (EXP7b/7c: detected, exit 1, not deleted) |
| tunnel/ChatGPT | note only: not locally observable, PS-7 deferred — never fabricated green | ✓ |

Notes (never verdicts): trusted-store limitation, PS-7 deferral, layout —
all phrased as notes.

## 18. Doctor trusted-store limitation

The implementation **does not** run a bootstrap replay from doctor, and
the output says so plainly: "trusted-store integrity verification is
available only through the Gateway operator bootstrap replay (`pi-shuttle
project add <path>`); doctor performs read-only local observation and
never invokes bootstrap or mutates state." Doctor reports locator/`store-v1`
presence + mode only, never "verified".

This is the **correct** choice: invoking bootstrap from doctor could
provision an absent store (mutation), violating doctor's read-only
discipline (operator-cli-contract §2). The limitation wording is truthful,
not a disguised claim. No trusted-storage private imports (static guard +
grep).

## 19. Doctor locks

Detected set: `<runtime.json>.lock`, `install.lock`, `project.lock` —
the minimum contract set. Presence is classified as `installed but
unverified` with the exact phrasing "a pi-shuttle operation may be running
or the lock is stale"; no PID/time-based staleness inference; no automatic
removal (EXP7c: lock artifact untouched by doctor); recovery guidance is
safe-first ("verify no operation is running, then remove the stale file").
Present lock → finding → exit 1 (EXP7b). `install.json.lock` (receipt
sibling) is not in the candidate set — it is held only during installer
writes and is not a contract-listed artifact; not a finding.

## 20. Doctor exit semantics

Independently tested (real CLI, isolated HOME fixtures):
- healthy supported local state → **exit 0** (EXP7a; every check
  `supported`);
- findings → **exit 1** (EXP7b lock-present; receipt missing/partial,
  gateway missing, root missing, isolation missing — unit tests);
- unsupported platform → **exit 2** (unit tests: darwin-arm64 gated,
  win32);
- precedence: any `unsupported` → 2 before findings (EXP8: Pi 0.84.x →
  exit 2 even though config/gateway checks would otherwise be findings;
  structural: `anyUnsupported ? 2 : anyFinding ? 1 : 0`);
- combination coverage: unsupported+missing config (2), partial receipt
  (1), non-baseline Pi (2), healthy config + lock (1) — all verified.
- No path prints findings and exits 0 (classification is over the whole
  check set; malformed receipt/config aborts with exit 1).

## 21. `start` preflight

`runStartCommand` order: platform gate (exit 2) → node lane → receipt
gate (usable verified Gateway; never inferred from disk) → runtime config
(absent/empty → `no registered projects — run pi-shuttle project add
<path>`, exit 1; malformed/foreign → fail closed) → ≥1 registered surface
→ per-surface locator parent presence (read-only) → exact installed bin
re-verified as regular file → spawn.

MUST-NOTs verified: no bootstrap (test: fixture rejects bootstrap argv in
start mode), no repair, no registration, no config modification, no
install. Malformed config prevents child spawn — proven with a spy/fake
Gateway whose marker `MUST-NOT-APPEAR` never appears on stdout, both for
malformed JSON (unit test) and foreign-field config (adversarial EXP9).
Store pre-check depth: locator parent only, not `store-v1` — recorded as
SIR-PS4-002 (fail-closed preserved: the Gateway itself rejects a missing
store at startup).

## 22. `start` stdio protocol safety — HIGH PRIORITY

- No pi-shuttle banner on stdout; no diagnostic text on stdout before the
  child (all pre-start errors → stderr via the outcome path; `start`'s own
  stdout is empty on success and on every preflight failure — asserted in
  every test).
- Child stdin/stdout/stderr inherited intentionally (`stdio: 'inherit'` —
  the single sanctioned inherited-stdio spawn).
- Pre-start errors → stderr; after spawn, the Gateway owns all three
  streams; child stderr passes through unmodified (appropriate: Gateway
  diagnostics remain visible to the operator).
- **Byte-level proof:** adversarial EXP6 ran `pi-shuttle start` against a
  fixture Gateway emitting raw binary bytes (`\x01MCP-PROTOCOL-BYTES\x02\n`);
  captured stdout was **byte-identical** (cmp against the expected byte
  sequence), stderr empty, child exit 7 propagated. No buffering or
  transcoding layer touches the protocol stream.

## 23. `start` signal and exit propagation

- Child exit code propagated as-is; signaled child → 128+N
  (SIGTERM→143 verified end-to-end via real CLI: the test signals the
  pi-shuttle process, which forwards to the child).
- SIGINT/SIGTERM/SIGHUP forwarded on the real CLI path
  (`forwardSignals: true` in `cli.ts` only; direct-call tests disable it
  so the test runner is unaffected).
- SIGHUP forwarding is intentional (documented in the listener set).
- Listeners are not removed after child exit — in the real CLI the
  process exits immediately after propagation, so no accumulation in
  production; repeated `runStartCommand` calls in one process only occur
  in direct-call tests, which use `forwardSignals: false`. Recorded as
  SIR-PS4-003 (optional hardening).
- No double-resolution race: the child promise resolves once via
  `error`/`close` (Promise ignores later settles; the `error` path covers
  spawn failure where `close` is not emitted); the parent does not swallow
  signals indefinitely (one-shot command).
- SIR-PS3-012 not reopened: the inherited-stdio path has no pipes, so the
  grandchild-pipe hang mode cannot arise; `runProcess` semantics for
  probes/bootstrap are unchanged from PS-3.

## 24. `start` executable confinement

- The Gateway executable path comes from the closed receipt
  (`binPath`, written by the PS-3 installer from the digest-verified
  pinned artifact's package `bin` mapping) — package identity already
  validated at install; re-verified as a regular file before every start.
- `isRegularFile` uses `statSync` (follows symlinks): a same-user
  replacement of the bin after install with another regular file would
  execute as the operator — same-user attack surface only; the doctor
  detects package identity drift (`installed but unverified`). Recorded
  as SIR-PS4-008 (optional hardening; the threat model is the operator's
  own account).
- No artifact-controlled `../../` escape: the bin path is written by the
  installer from the pinned artifact, never derived from artifact
  contents at start time.

## 25. Residual and recovery semantics

Typed messages reviewed for truthfulness:
- bootstrap-ok / registration-failed → states the store was
  initialized/replay-verified and is PRESERVED, never deleted to roll
  back pi-shuttle metadata; re-run guidance (EXP2);
- lock BUSY → names the lock, bounded-wait fact, stale guidance
  (EXP3/EXP4);
- foreign runtime config → `ERR-PS2-CONFIG-INCOMPATIBLE`, no overwrite;
- malformed Gateway output → `ERR-PS4-BOOTSTRAP-OUTPUT` with residual
  store note;
- missing project root → `ERR-PS4-ROOT-UNRESOLVABLE`;
- preserved store after remove → printed explicitly;
- start preflight failure → typed code + `run pi-shuttle project add`
  / installer guidance.
No message claims rollback of Gateway state; recovery guidance prefers
safe re-run/inspection over deletion everywhere (only stale lock files are
ever suggested for manual removal, after verifying no operation is
running).

## 26. Process/environment contamination

- Gateway bootstrap / start: argv-only invocation; the operator
  environment (PATH et al.) passes through unchanged; **no project-
  controlled environment variables are injected** — project metadata
  enters only as argv operands and config-file content.
- Git/Pi probes: PATH-resolved executables, argv-only, bounded.
- No shell anywhere; no `NODE_OPTIONS` or similar is introduced from
  project metadata (the operator's own env, including any NODE_OPTIONS,
  is inherited as-is — operator-owned, not pi-shuttle-owned; the Gateway
  and pi-shuttle run as the same operator, so no boundary crossing).
- Material code-execution inheritance risk from pi-shuttle-owned inputs:
  none identified. (Residual: the operator's own environment is passed to
  the Gateway child unmodified — intentional stdio/env passthrough per
  contract, not a pi-shuttle defect.)

## 27. Static security guards

The PS-4 static-guard additions pin real invariants (reviewed, not
brittle):
- one shared bounded process boundary (`node:child_process` /
  `spawn(` / `exec(` confined to `src/process/runner.ts`);
- only the start path may inherited-stdio spawn (`stdio: 'inherit'` and
  `spawnGatewayForStart` confined);
- no network (forbidden vocabulary: `node:net/http/https/tls`, `fetch(`,
  WebSocket, oauth);
- no shell (`shell: true` absent);
- no Gateway private imports / no trusted-authority vocabulary
  (`initializeTrustedStore`, provenance, capability, grant, receipt
  authority — all forbidden and absent);
- bootstrap only via installed CLI (`'bootstrap'` and `'--config'` argv
  confined to the lifecycle boundary/runner);
- `process.env` confined to the host seam + runner;
- `node:fs` per-module allowlists incl. lifecycle modules; mutation
  vocabulary confined to writer/lock/installer/lifecycle-directory
  boundary;
- project remove has no destructive store capability (no `rmSync` in
  lifecycle);
- CLI grammar unchanged (`src/command/parse.ts` untouched);
- installer behavior from PS-3 still present (shim + unchanged suites);
- zero runtime dependencies (package.json pin).

## 28. Regression of PS-3 installer

- Runner move: byte-identical (verified by diff).
- Archive scanner, installer attempt lock (`install.lock`), Pi rollback
  truthfulness (SIR-PS3-002 pre-list discipline), exact artifact naming,
  root refusal (`checkNotRoot`), receipt digest trust, installer
  subprocess safety — all unchanged (installer sources untouched except
  the process re-export shim; installer test suites untouched and green
  within 179/179).
- No PS-3 architecture regression found; no reopening of closed PS-3
  findings absent evidence.

## 29. Tests / evidence

**`npm test`:** 179 run / 179 pass / 0 fail / 0 skip (node v22.23.2 —
the validated lane — verified twice, once with the full suite and once
isolating `gateway-conformance` 3/3).
**`npm run typecheck`:** clean. **`npm ci --dry-run`:** green.
**`git diff --check`:** clean.

Genuine integration-path coverage (not helper-only):
- real CLI subprocess path: `runCli` spawns `dist/cli.js` for add/list/
  remove/start/doctor across many tests;
- actual operation lock: concurrent same-project add (real CLI, slow
  bootstrap → one BUSY, one success, exactly one registration);
  concurrent different-project add (both succeed, both registrations
  survive);
- fake Gateway malformed-output cases: exit1 / no-output / malformed /
  mismatch / slow;
- bootstrap-success / persistence-failure residual: directory-at-path
  block → `ERR-PS4-REGISTER-FAILED`, store preserved;
- store preservation after remove: sentinels + byte-identical re-add;
- real Gateway black-box startup: 3/3 conformance (0 skip);
- doctor exit combinations: healthy 0 / findings 1 / unsupported 2 /
  lock 1 / non-baseline Pi 2;
- byte-clean stdio: raw binary marker passthrough (EXP6, byte-compare);
- signal forwarding: SIGTERM → 143 via real CLI.

Coverage gaps recorded (non-blocking): no direct concurrent add-vs-remove
contention test (structural serialization only); `pi-shuttle start`
→ real Gateway full-chain is not exercised (the real Gateway is probed
directly with the persisted config; the composed start path with the real
artifact is PS-5 Lane A evidence).

## 30. Documentation truthfulness

- README: status updated to PS-4 gate; operator CLI section describes
  add/list/remove/doctor/start accurately; no over-claims about store
  verification (bootstrap-replay-only phrasing), rollback, macOS, Pi
  0.84, tunnel/ChatGPT, project health, public release, or start
  readiness beyond local Gateway composition.
- Implementation report: claims cross-verified — 179/179 (✓),
  typecheck/ci/diff-check (✓), runner verbatim (✓), SIR-PS2-009 closure
  (✓ genuine black-box evidence), doctor limitation wording (✓ truthful),
  no over-claims found. Minor: §24's git-status block mislabels
  `tests/unit/doctor.test.ts` as untracked (`??`) when it is tracked and
  modified (` M`) — cosmetic (SIR-PS4-007).
- Prior-gate records: PS-2 senior review SIR-PS2-009 (MINOR ARCHITECTURE,
  deferred) is closed by genuine black-box evidence; PS-3 SIR-PS3-012
  (MODERATE OPTIONAL HARDENING) remains optional and unworsened.

---

## 31. Findings

### SIR-PS4-001 — MODERATE — PRODUCT — resolved `artifactLocation` is not correlated
- **Location:** `src/lifecycle/projects.ts`, `correlateResolvedSurface`
  (workspace checks omit `artifactLocation`).
- **Violated invariant:** gate §9 — output must correlate with the
  requested project on every operator-owned fact; `artifactLocation` is
  pi-shuttle-owned input (`prepareOperatorDirs` creates it) and is
  persisted verbatim from the Gateway-resolved workspace without
  comparison.
- **Consequence:** a faulty (or adversarially replaced — outside the
  pinned-artifact threat model) Gateway could resolve a different
  artifact location and have it persisted into the runtime config. Blast
  radius bounded: the Gateway's own Phase-1 validation requires a strict
  descendant of the canonical root (which IS correlated), so no
  cross-project/cross-root redirection is reachable.
- **Reproduction:** fixture Gateway returning `artifactLocation: root +
  '-other'` with exit 0 is accepted and registered.
- **Correction:** compare `workspace.artifactLocation` against
  `expected.artifactsDir` in `correlateResolvedSurface` (one line;
  artifactLocation may be absent in resolved output only when absent in
  input — pi-shuttle always supplies it). **Inside PS-4 envelope.**

### SIR-PS4-002 — MINOR — PRODUCT — `start` store pre-check observes only the locator parent
- **Location:** `src/lifecycle/start.ts` step 5 (`pathExists(surface.locator)`).
- **Violated invariant:** operator-cli-contract §6 "stores present/
  replay-verifiable" — a present locator parent with missing `store-v1`
  is not pre-detected.
- **Consequence:** degraded UX only: the Gateway itself fails closed at
  startup with its own diagnostic; no security impact, no spawn of a
  misconfigured runtime.
- **Correction:** also require `join(locator, 'store-v1')` presence
  (mirror the doctor probe). **Inside PS-4 envelope.**

### SIR-PS4-003 — MINOR — ARCHITECTURE — signal listeners not removed after child exit
- **Location:** `src/lifecycle/start.ts` (listener registration loop).
- **Consequence:** none in production (one-shot CLI exits immediately);
  direct-call contexts use `forwardSignals: false`. Optional hardening:
  remove the listeners in the `close` handler and register them before
  spawn (closes the tiny signal-loss window).
- **Correction:** small lifecycle cleanup; **inside PS-4 envelope.**

### SIR-PS4-004 — MINOR — TEST / EVIDENCE — no direct add-vs-remove contention test
- **Location:** `tests/unit/lifecycle.test.ts`.
- **Consequence:** the add-vs-remove interleaving is structurally
  serialized (same `project.lock`, same ordering) and EXP4 covered
  remove-under-held-runtime-lock, but no test pins add-vs-remove
  contention specifically.
- **Correction:** add one real-CLI contention test (slow-bootstrap add
  vs remove → BUSY or clean serialization, final state coherent).
  **Inside PS-4 envelope.**

### SIR-PS4-005 — MINOR — TEST / EVIDENCE — conformance probe lacks a hard timeout on post-EOF close
- **Location:** `tests/unit/gateway-conformance.test.ts`,
  `probeStartup` (post-timer path attaches a close listener with no
  timeout).
- **Consequence:** a Gateway child that hangs after stdin EOF would hang
  the test until the runner's own limits. Test-only; the acceptance
  proof itself (alive-window + clean exit 0) is genuine.
- **Correction:** bound the post-EOF close wait. **Inside PS-4
  envelope.**

### SIR-PS4-006 — MINOR — OPTIONAL HARDENING — operator-boundary mkdir follows pre-existing symlinks
- **Location:** `src/lifecycle/projects.ts`, `prepareOperatorDirs`.
- **Consequence:** a pre-existing same-user symlink at a target path
  (locator parent / git isolation dir) redirects creation into the link
  target. Same-operator-only (the attacker already owns the account);
  the Gateway's no-follow store verification is the second line for the
  store; no cross-boundary exploitation identified.
- **Correction (optional):** `lstatSync` existence check + reject
  symlinks at the operator boundary, or document the accepted
  same-user model. **Inside PS-4 envelope; not a blocker.**

### SIR-PS4-007 — MINOR — DOCUMENTATION — implementation report §24 git-status mislabels `tests/unit/doctor.test.ts`
- **Location:** `docs/reports/pi-shuttle-ps-4-...-implementation-report.md`
  §24 (lists `?? tests/unit/doctor.test.ts`; actual status is
  ` M`).
- **Correction:** fix the status line. **Inside PS-4 envelope.**

### SIR-PS4-008 — MINOR — OPTIONAL HARDENING — `start` re-verifies bin regular-file-ness but not package identity
- **Location:** `src/lifecycle/start.ts` (`isRegularFile` only).
- **Consequence:** a same-user foreign replacement of the installed bin
  between install and start is not detected at start time (doctor
  detects drift; `statSync` follows symlinks). Same-user threat model
  only.
- **Correction (optional):** reuse the package-identity check
  (name/version) in the start preflight, matching doctor. **Inside PS-4
  envelope; not a blocker.**

No CRITICAL or MAJOR findings. No finding requires a Gateway/pi-guard
change, new authority, destructive store behavior, identity-semantics
change, Git mutation, network behavior, macOS support, installer redesign,
or any material contract change.

## 32. Envelope exceptions

None required. All corrections above are inside the PS-4 envelope (no
Gateway source changes, no pi-guard source changes, no new trusted
authority, no destructive Gateway-store behavior, no identity-semantics
change, no Git mutation, no network/tunnel behavior, no macOS Gateway
support, no installer redesign, no material contract change).

## 33. Exact verification performed

- Baseline/tree identity: `git rev-parse` on all three repositories;
  remote inventory; full `git status --porcelain` inventory.
- Full contract set read: product-contract, component-boundaries,
  installation-contract, operator-cli-contract, platform-support-contract,
  test-and-release-plan, work-packages, ADR-001; PS-2/PS-3 implementation/
  senior-review/focused-rereview reports; PS-4 implementation report.
- Full source read of every PS-4 production module (runner, lifecycle ×3,
  doctor, projects, start, state) plus PS-2/PS-3 support modules
  (document, writer, lock, identity, model, preflight, parse, manifest,
  receipt, components, environment).
- Gateway PS-1 side read: `bootstrap/run.ts`, `runtime/mcp/config.ts`,
  `control-plane/storage-bootstrap-action.ts` (input/output contract,
  identity derivation, replay semantics).
- Diffs: runner-vs-PS-3 (byte-identical), all modified files reviewed.
- Static guards read in full and re-derived by grep (locks, rmSync,
  spawn, network, shell, vocabulary).
- Test suite: `npm test` (179/179), `npm run typecheck`, `npm ci
  --dry-run`, `git diff --check`; isolated `gateway-conformance` rerun
  (3/3, 0 skip).
- Independent identity recomputation (PS-2 formula) for a fixture root.
- Adversarial experiments (isolated throwaway HOME fixtures, removed
  afterward; no real Pi state touched):
  EXP1 wrong-root-with-exit-0 → fail closed, store preserved;
  EXP2 bootstrap-ok/persistence-fail → typed residual, store PRESERVED;
  EXP3 pre-held `project.lock` → BUSY, no mutation;
  EXP4 pre-held `runtime.json.lock` during remove → BUSY, registration
  intact;
  EXP5a remove → deregister only (store/.git/artifacts sentinels);
  EXP5b re-add → same locator, verification-replay, store byte-identical;
  EXP6 byte-clean `start` (raw binary passthrough, exit 7, empty stderr);
  EXP7a doctor healthy → 0; EXP7b lock present → 1; EXP7c lock never
  auto-deleted;
  EXP8 Pi 0.84.x → exit 2, never claimed;
  EXP9 `start` with foreign-field config → fail closed, no child, empty
  stdout.

## 34. Exact Git status (review end)

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
?? docs/reports/pi-shuttle-ps-4-project-lifecycle-doctor-start-implementation-report.md
?? src/lifecycle/projects.ts
?? src/lifecycle/start.ts
?? src/lifecycle/state.ts
?? src/process/runner.ts
?? tests/helpers/lifecycle-fixtures.ts
?? tests/unit/gateway-conformance.test.ts
?? tests/unit/lifecycle.test.ts
?? tests/unit/start.test.ts
```

plus the report created by this review
(`docs/reports/pi-shuttle-ps-4-project-lifecycle-doctor-start-senior-review.md`).
Baseline HEAD unchanged: `7622ad90da6a6b2772f1a19a56492c52f70b4881`.
Nothing staged, nothing committed, no remote configured or touched.

## 35. Final verdict

PS-4 delivers the operator lifecycle on the approved boundaries with
fail-closed discipline held at every adversarial probe I ran: the Gateway
bootstrap authority boundary is clean (no private imports, no duplicated
authority, no identity recomputation), the operation-wide lock graph is
acyclic and behaviorally coherent, residual store semantics are truthful
(never rolled back, never deleted), `remove` is deregister-only with
direct filesystem evidence, `start` is byte-clean on the MCP stream with
truthful exit/signal propagation, doctor is honest about every limitation
it cannot observe, and SIR-PS2-009 is genuinely closed by real black-box
evidence against the exact pinned Gateway. The eight findings are all
MINOR (one MODERATE, bounded, defense-in-depth) and each correction is
inside the PS-4 envelope; none blocks acceptance.

`PS-4 SENIOR REVIEW — ACCEPTED`
