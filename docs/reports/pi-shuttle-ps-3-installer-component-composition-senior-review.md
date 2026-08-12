# PS-3 — pi-shuttle Installer + Component Composition — Senior Review

**Reviewer:** senior security / architecture reviewer (read-only,
adversarial gate). **Verdict:** CORRECTIONS REQUIRED (see §20, §24).
No production code, tests, contracts, or tooling modified; nothing staged,
committed, pushed, tagged, or published. Adversarial fixtures were created
only under `/tmp` and removed; no external component repository was
modified; no persistent mutation of the real Pi state was performed.

---

## 1. Baseline / reviewed tree

| Item | Value |
|---|---|
| Repository | `/home/chef/Documents/pi-shuttle`, branch `master` |
| Baseline HEAD (expected/observed) | `838b9a05c390f8179650cfcad2953639e332b6d2` — `feat: establish pi-shuttle PS-2 CLI config model` — **unchanged** |
| PS-3 implementation state | uncommitted, unstaged (see §23) |
| Gateway | `/home/chef/Documents/Project_Gateway_MCP` HEAD `7f3b4afdb43704e7dac82da7b086d8367347c641` (verified; untouched) |
| pi-guard | `/home/chef/Documents/plan_spec_guard` `v0.1.2` / `7a7580cc4cbd7926797564c72269394fc29a860a` (verified; untouched) |
| Reviewed files | `install.sh`; `src/installer/{main,install,selection,preflight,artifact,components,process,receipt}.ts`; `tests/helpers/installer-fixtures.ts`; 4 new test suites; extended `tests/unit/static-guard.test.ts`; README delta; implementation report |

PS-2 baseline primitives reused by PS-3 were re-inspected: the PS-2 writer
was corrected per SIR-PS2-001/002 (sibling `.lock` via O_EXCL, bounded
retry, decode-under-lock, publish-under-lock, read-back verification,
never-steal stale locks) and `mutateDocumentAtomically` is the receipt
writer. The corrections are real and tested (lock release, BUSY
contention, multi-process serialization tests present).

## 2. Scope assessment (Area A) — PASS

- No project add/remove lifecycle, no Gateway bootstrap invocation, no MCP
  start, no full PS-4 doctor, no ChatGPT/tunnel behavior, no macOS
  implementation, no Gateway/pi-guard source modification, no auto-update,
  no daemon/service, no generic command runner, no generic remote
  acquisition (zero network imports in `src/`; guard-pinned and
  independently grepped).
- Prompt 5 ("configure a project now?") prints only
  `PROJECT_ONBOARDING_DEFERRED` guidance (`pi-shuttle project add <path>`
  is PS-4-owned) and performs no onboarding mutation — verified in
  `main.ts`/`selection.ts` and by a subprocess test.
- The installer is a separate operator surface with its own closed
  grammar; the `pi-shuttle` operational CLI (doctor/project/start/
  `--help`/`--version`) is byte-unchanged.
- **One scope defect**: the contract-mandated root/sudo refusal
  (installation-contract §4 "The installer refuses to run with
  sudo/root") is **not implemented** — no uid check anywhere
  (SIR-PS3-007).

## 3. Shell / process boundary (Areas B, C)

**install.sh** — verified adversarially: fixed exec shim; `exec "$NODE_BIN"
"$SCRIPT_DIR/dist/installer/main.js" "$@"`; argv passed verbatim (quoted);
no `eval`; no string-built command; no command substitution involving
operands; correct quoting for spaces/metacharacters; no remote download;
no sudo; cannot recurse (exec replaces the process; the only scripted
branch is a missing-build error). `NODE_BIN` is a single quoted word — an
interpreter override that cannot smuggle extra arguments; it is
installer-local, documented in the file header and the report, and is the
standard npm-style operator override (an operator who can set `NODE_BIN`
can already execute anything as themselves; no privilege is added).
Assessment: acceptable intentional local-operator override.

**process.ts** — one production subprocess boundary (guard-enforced:
`node:child_process`/`spawn(`/`exec(` absent from all other `src/`);
argv-array only, `shell: false` implied (spawn without shell); executable
resolution bounded and deterministic (`resolveExecutable`: rejects
slash-containing names, walks PATH with `X_OK`, skips empty entries —
safer than POSIX cwd semantics); no operator-controlled command name
reaches a generic runner (executable names are fixed constants; paths and
versions are argv elements — hostile-argv test present); 64 KiB output
caps with truncation markers (test-pinned); exit/signal/timedOut mapping
truthful; missing-executable and nonzero-exit paths deterministic.
Weaknesses: the timeout kills only the direct child (SIGKILL, no process
group) and the promise resolves on `close` — a subprocess that leaves a
grandchild holding the stdio pipes can defeat both the timeout and the
resolve (SIR-PS3-012).

## 4. Archive extraction confinement (Area D) — MAJOR

`extractArtifact` (`src/installer/components.ts`) runs
`tar -xzf <artifact> -C <extractDir>` — confinement is delegated entirely
to the external `tar` binary's version-dependent protections; pi-shuttle
performs **no member pre-scan, no member-type policy, and no structural
verification of its own**. Adversarial fixtures (built under `/tmp` with
Python `tarfile`, extracted with the installer's exact argv) against GNU
tar 1.35 (this host, the only currently claimed lane):

| Vector | Result on GNU tar 1.35 |
|---|---|
| `../` member | refused — "Member name contains '..'", exit 2 |
| absolute member (`/tmp/...`) | leading `/` stripped, stays inside (exit 0) |
| pax long name with `..` | refused, exit 2 |
| symlink `-> ..`, then file through it | refused, exit 2 |
| symlink `-> ../..` (deep escape) then file | refused, exit 2 |
| symlink `-> absolute outside path` then file | refused, exit 2 |
| hardlink to `/etc/passwd` | refused (leading `/` stripped + target absent), exit 2 |
| hardlink with `..` target | refused, exit 2 |
| device member (as non-root) | refused (mknod EPERM), exit 1 |
| **FIFO member** | **extracts cleanly, exit 0** |

So on GNU tar 1.35 all tested *write-escape* vectors fail closed — but two
findings follow:

1. **FIFO members are accepted** (exit 0), and a FIFO at
   `package/package.json` causes a **confirmed unbounded hang** of the
   installer: `findPackageRoot`/`readPackageIdentity` use synchronous
   `readFileSync`, which blocks forever opening a FIFO (open O_RDONLY
   waits for a writer); no timeout exists on this path. Reproduced:
   `timeout 5 node …` → exit 124 (hang). An untrusted local-lane artifact
   can hang the installer indefinitely.
2. The required invariant — "NO archive member may cause filesystem
   mutation outside the attempt-owned staging root" — is not
   **structurally** proven: it holds only because the PATH-found tar
   happens to be a GNU tar with the 1.34/1.35-era protections. Any other
   tar (older GNU, busybox, bsdtar) is an unverified variable, and the
   artifact is untrusted in the default local lane (see §5), so a
   traversal-capable member could write arbitrary user-writable files
   (e.g. `~/.bashrc`, `~/.ssh/authorized_keys`, `~/.local/bin/*`) in the
   operator's context. Extraction also cannot mutate project dirs, the
   Gateway/pi-guard repos, or receipt paths *through staging* — but an
   escaped write can reach any user-writable path by construction.

Severity: MAJOR (the write-escape is version-dependent and was not
reproducible on the current host's tar; the FIFO hang is reproduced).
Correction (inside envelope): pre-extraction member scan (`tar -tvzf` or
a minimal built-in reader — the pilot Gateway artifact contains **only
regular files**, 503/503, so rejecting all non-regular/non-directory
members breaks nothing real) rejecting absolute names, any `..`
component, and all symlink/hardlink/device/FIFO members; refuse the
archive before any extraction. See SIR-PS3-001.

## 5. Artifact integrity and trust model (Area E) — MODERATE finding

`verifyArtifactFile` streams SHA-256 correctly and compares against
`--expect-*-sha256` (mismatch → `ERR-PS3-ARTIFACT-DIGEST-MISMATCH` before
any activation; test-pinned). The local lane correctly distinguishes
"expected digest" from "observed digest" **in code**
(`digestVerifiedAgainstExpectation`), and the report phrases it truthfully.
However:

- Without expectations, the installer computes the digest of an
  **untrusted** artifact, installs it, and can emit a **production-shaped
  `COMPLETE`** result; the receipt records `artifactSha256` but **no
  field or note records whether the digest was verified against an
  expectation** — a local-lane receipt is byte-indistinguishable, in its
  digest field, from a digest-verified install (`commitVerified` covers
  only the commit claim). The review's requirement — "receipt wording
  makes the trust level unmistakable" — is not met (SIR-PS3-006).
- This is explicitly the local/pilot lane and is documented; the
  distinction is present in code but not in the persisted truth document.
- Package name/version identity checks are independent and exact
  (test-pinned: wrong version fails closed).

## 6. Artifact filename and package identity consistency (Area F) — MAJOR

Verified against reality:

| Component | Installer expects (`components.ts`) | Real packaging (verified) |
|---|---|---|
| Gateway | `project-gateway-artifact-core@0.1.0.tgz` | **`project-gateway-artifact-core-0.1.0.tgz`** — the actual pilot artifact present in the clean reference repo, and the contract's own name (product-contract §6) |
| pi-guard | `pi-guard@0.1.2.tgz` | **`pi-guard-0.1.2.tgz`** — `npm pack --dry-run` in the pi-guard repo (name `pi-guard` v0.1.2, files `src`,`extensions`) |

npm-pack convention (and the contract's artifact name) is the **hyphen**
form; the installer expects the **`@`** form, which is the contract's
*package-directory* form (installation-contract §5.4). With the real
artifacts in `--artifact-dir`, the installer REFUSES
(`ERR-PS3-ARTIFACT-UNAVAILABLE`) — the intended install path only works
after manual renaming. The report's §20 manual smoke used the hyphen-named
pilot artifact, implying an undisclosed rename; §9's "matching the
contract's tarball naming" is wrong; the test fixtures bake the `@` form
in, hiding the mismatch. This breaks the intended install path with real
artifacts → SIR-PS3-004.

## 7. Gateway component composition (Area G) — PASS with one release dependency

- Exact pin `0.1.0` + PS-1 baseline commit consumed from the manifest;
  identity verified inside the artifact (name/version; real pilot
  package.json declares `bin: {"project-gateway-mcp":
  "./dist/runtime/mcp/cli.js"}` — the installer's bin check would pass).
- No private-source import, no bootstrap invocation, no MCP start; the
  only execution is the bounded 10 s `node <bin> --help` smoke.
- Missing-dependency failure (ERR_MODULE_NOT_FOUND) → `installed-
  unverified` with a truthful note; any other smoke failure → component
  FAILED; **COMPLETE is unreachable with a failed smoke** (COMPLETE ⇔ all
  selected `installed-verified`). An activated but dependency-incomplete
  Gateway is honestly PARTIAL — acceptable under the approved installer
  contract.
- Dependency materialization (pinned `npm install` of the three deps,
  installation-contract §5.4) is deferred as a release dependency. This is
  an acceptable envelope resolution (PS-3's approval criteria do not
  require it; registry access is not authorized in this gate; classification
  is truthful) — but it is a hard dependency of the PS-5 Lane A gate and
  must not silently become a permanent state.
- One sharpening needed: the smoke bin path comes from the artifact's
  `bin` map and is used unvalidated — `join(targetDir, binRelative)` with
  a `../../…` value executes a file outside the package (SIR-PS3-003).

## 8. Activation no-clobber / concurrency (Area H) — MODERATE finding

`activatePackageRoot` = `renameSync(packageRoot, targetDir)`:

- Non-empty foreign dir → `ENOTEMPTY` → idempotent-verify path (identity
  check; foreign identity fails closed). Foreign file → `EEXIST`/`ENOTDIR`
  → same. These are structural (POSIX rename semantics), not
  check-then-rename.
- **Residual clobber**: POSIX rename silently replaces an existing
  **empty** directory. Reproduced: a pre-existing foreign empty dir at
  the target was destroyed and replaced, `created: true` reported. The
  rollback-candidate bookkeeping (registered `preExisting` before
  activation) then leaves the attempt-created content in place after a
  failed install. → SIR-PS3-010.
- Same-selection concurrency is coherent: two concurrent installers both
  reached COMPLETE with correct final packages, receipt, and an idempotent
  double `pi install` of the same source (experiment, §22). The receipt
  write itself is race-safe (PS-2 lock; foreign receipt → typed failure;
  prior receipt preserved).
- Different-selection concurrency is NOT coherent at the receipt level
  (SIR-PS3-009).

## 9. Bin-link safety (Area I) — PASS with one MINOR

- Foreign **file** at `~/.local/bin/pi-shuttle` → `symlinkSync` EEXIST →
  FAILED; foreign file preserved (proven in the post-pi-install failure
  experiment: content intact after rollback).
- Foreign symlink with a different target → REFUSED (readlink compare).
- Same-target symlink → idempotent skip. Creation is race-safe
  (`symlinkSync` is atomic; EEXIST fails closed — no check-then-act).
- Rollback removes the link **without re-reading it** — if a foreign
  process replaced our link between creation and rollback, the foreign
  link would be deleted (SIR-PS3-011, narrow race).
- Relative/canonical ambiguity: the comparison is exact-string against
  the absolute own-CLI path; no relative-target confusion is possible
  (readlink returns the stored string; we compare verbatim).

## 10. pi-guard install side effects (Area J) — MAJOR

`pi install <targetDir>` mutates Pi's package store — **outside
pi-shuttle staging**. Verified facts:

- The installer does **not** record whether pi-guard was already installed
  in Pi before the attempt.
- Rollback (`rollback()` in `install.ts`) covers staging, attempt-created
  component dirs, and the bin link — **not** the external Pi install.
- Reproduced end-to-end (isolated HOME + fake pi): a failure injected at
  the bin-link stage *after* `pi install` succeeded produced
  `FAILED … rollback: rolled back (prior installation state preserved)`
  **while the pi install was recorded** — pi-guard remains installed in
  the Pi store. The report's claim "a failing fresh install leaves nothing
  behind" (§16) is false for failures after the `pi install` step.
- Rollback never removes a pre-existing pi-guard install (good) and never
  touches unrelated extensions (good) — but it also cannot distinguish or
  remove the attempt-installed pi-guard; per the review guidance, no
  destructive Pi removal command was invented (correct), so the honest
  outcome is **PARTIAL ROLLBACK with a residual side effect**, which the
  implementation does not report.
- The confirmed-safe parts: packages dir rolled back, foreign bin entry
  preserved, no receipt written.

→ SIR-PS3-002 (MAJOR).

## 11. pi-guard verification (Area K) — MODERATE finding

- The exact source `targetDir` (`packages/pi-guard@0.1.2`) is passed to
  `pi install`; verification is `pi list` output
  `includes(targetDir) || includes('pi-guard')`.
- Real `pi list` output inspected read-only on this host (source line +
  indented path line; relative sources echo as given, so an absolute
  source should echo absolute): the exact-path match is sound **if** pi
  echoes the source verbatim (not verified without mutating real Pi state
  — correctly avoided).
- The **`includes('pi-guard')` name-substring fallback** can be satisfied
  by any unrelated package/path containing the substring (e.g.
  `pi-guard-extra`), yielding `installed-verified` without the pinned
  version or source — an ambiguous false positive (SIR-PS3-008).
- Pre-existing different pi-guard versions: a prior `pi-guard` of a
  different version in the list would also satisfy the substring.
- The installer never claims guard enforcement ACTIVE because the package
  appears in the list — the status is only `installed-verified` vs
  `installed-unverified` (verifiedBy), which is truthful.

## 12. Pi compatibility policy reconciliation (Area L) — PASS

The HUMAN-APPROVED contract is **normative and unambiguous**:
installation-contract §4 states "Pi 0.84.1 → **refuse** with explanation
('0.83.0 is the verified baseline; 0.84.x is not a claimed lane'), not
silent acceptance". The production constant
`PI_NON_BASELINE_POLICY = 'refuse-non-baseline'` matches the contract
exactly (message reproduced verbatim in code and test). The pending
"HUMAN DECISION REQUIRED" is correctly framed as a **future policy-change
question** (whether 0.84.x may become `installed but unverified` after its
own evidence gate), implemented as a one-line seam with both policies
pure-tested — not a current implementation blocker and not a contradiction
in the approved contract. No Pi 0.84.x support claim exists anywhere
(host runs 0.84.1; pi-guard selection on this host correctly REFUSES).

## 13. Preflight (Area M) — PASS

- Platform: Linux x86_64 only; darwin-arm64 REFUSED with the gating
  explanation; macOS Intel/Windows UNSUPPORTED (test-pinned).
- Node: exact validated lane 22.23.2 enforced via the running
  interpreter; other versions REFUSED with the contract's
  runtime-compatible-but-not-validated explanation (distinct from the
  `>=22.0.0` package floor, which is unchanged and not a support claim).
- tar: required only when components are selected; refused when absent.
- pi: presence + version classification only when pi-guard selected.
- Layout: dirs created 0700 only **after** all policy checks (platform,
  node, receipt, artifact source, tar, pi) — verified ordering in
  `install.ts`; mutation is attempt-owned/idempotent and fails closed on
  unwritable parents (test-pinned).
- Existing receipt: foreign/invalid → REFUSED (preserved, test-pinned);
  different pi-shuttle version → REFUSED.
- Git probe correctly omitted (no git-based acquisition; PS-4 doctor
  probe).
- Gap: no root/uid refusal (SIR-PS3-007).

## 14. Receipt (Area N) — PASS

- Closed/versioned (`receiptVersion: 1`), unknown-field rejection at
  top/surface/component levels, deterministic key-ordered serialization
  (byte-stable parse→serialize, test-pinned), 0600 (test-pinned),
  written LAST and only for finalized COMPLETE/PARTIAL states.
- Written via `mutateDocumentAtomically` (PS-2 lock primitive):
  decode-under-lock (foreign → typed `ERR-PS2-CONFIG-INCOMPATIBLE`,
  preserved), transition under lock, publish under lock, read-back
  verification. Concurrent receipt writers serialize; the check-then-
  rename race from SIR-PS2-001 is closed for the receipt path.
- Failed attempts never replace a prior valid receipt (test-pinned).
- `installedAt` ISO timestamp — truthful; byte identity across runs is
  not required (contract-approved).
- `commitVerified: false` — truthful: manifest commit claims are recorded
  as claims, never as artifact-verified provenance.
- No secrets/authority/provenance serialized (test-pinned).
- Gap: no digest-trust-level field (SIR-PS3-006).

## 15. Result taxonomy (Area O) — PASS (wording issue only)

Independently reconstructed from `install.ts`:

- COMPLETE ⇔ no omissions AND every selected component
  `installed-verified`. (Both components selected is required for the
  full stack; both declined yields PARTIAL per contract §7.)
- PARTIAL ⇔ (omitted.length > 0) OR (any selected component
  `installed-unverified`). Opt-outs exit 1 (truthful, not an error);
  unverified-but-installed components are named in notes.
- FAILED ⇔ any selected component install/verification failure → rollback,
  no receipt.
- REFUSED / UNSUPPORTED → no mutation of prior state (platform, policy,
  foreign state).
- Exit codes 0/1/2 closed and documented in `main.ts`.
- The report's wording "PARTIAL ⇔ any selected component is declined" is
  inaccurate (a declined component is *unselected*; the implementation is
  the correct omitted/unverified disjunction) — documentation finding
  (SIR-PS3-014).

## 16. Rollback state machine (Area P) — MAJOR gap at the Pi boundary

| Mutation | Pre-existing? | Created by attempt? | Rollback owner | Rollback op | Post-failure state |
|---|---|---|---|---|---|
| layout dirs (0700) | maybe | n/a | — | left (idempotent, pi-shuttle-owned) | benign |
| staging dir | no | yes | attempt | rm -rf (best-effort) | removed |
| gateway package dir | recorded pre-activation | tracked | attempt (only if not pre-existing) | rm -rf | removed if created |
| pi-guard package dir | recorded pre-activation | tracked | attempt (only if not pre-existing) | rm -rf | removed if created |
| **Pi external install** | **not recorded** | **not tracked** | **none** | **none** | **RESIDUAL (pi-guard stays in Pi store)** |
| bin link | recorded (`binLinkCreated`) | tracked | attempt | rm (no identity re-check) | removed (SIR-PS3-011) |
| receipt | prior preserved | written last | never removed | — | prior intact; failed attempt writes none |

Rollback never removes pre-existing components, receipts, bin links,
stores, project dirs, Git repos, or unrelated Pi extensions — verified.
The gap is the Pi boundary: rollback registration for the external side
effect is absent, and the failure outcome can claim "rolled back" while
state remains (SIR-PS3-002). Rollback candidates ARE pre-registered before
their mutations (correct pattern) except the Pi install.

## 17. Installer concurrency (Area Q) — MODERATE finding

- Staging namespace: `ps3-<pid>-<ts>` — distinct across processes; safe.
- Component activation: same-selection concurrency coherent (proven:
  both COMPLETE, final packages correct, receipt correct; the loser
  idempotently verified the winner's dir).
- Receipt: serialized via lock (proven).
- Pi install: double execution of the same source — idempotent at the Pi
  level (same source path).
- **Different-selection concurrency**: the final receipt is the last
  finisher's and can disagree with the final state (proven: A=both +
  B=gateway-only; if B finalizes last, the receipt says
  PARTIAL/omitted:['pi-guard'] while pi-guard is installed). No
  attempt-spanning lock exists (SIR-PS3-009).

## 18. Static security boundaries (Area R) — PASS

The extended guards are meaningful, not superficial: per-module `node:fs`
named-import allowlists (writer, host seam, json intake, and the four
installer modules with exactly their declared primitives); filesystem
mutation vocabulary confined to the writer + installer boundary
(`renameSync`/`mkdirSync`/`unlinkSync`/`rmSync`/`symlinkSync` absent
elsewhere); subprocess confined to `process.ts`; `process.env` confined to
the host seam + process boundary; `node:crypto` confined to identity +
digest modules; network/tunnel/MCP vocabulary forbidden everywhere;
trusted-authority vocabulary absent; package surface (single `pi-shuttle`
bin, private, zero runtime dependencies) pinned. `install.sh` is the only
shell surface. Verified independently by grep over `src/` and compiled
`dist/`.

## 19. Test / evidence quality (Area S)

`npm test` → **99/99 pass** (verified: 10+8+7+4+18+6+7+6+4+15+6+8 across
12 suites), `npm run typecheck` clean, `npm ci --dry-run` green,
`git diff --check` clean — all re-run by this reviewer. Real-installer
subprocess tests cover: install.sh entrypoint, batch parser, interactive
piped prompts (incl. prompt-5 deferred guidance), COMPLETE/PARTIAL/
both-declined, digest mismatch, wrong version, corrupted artifact,
non-baseline Pi refusal, missing pi, rollback preserving prior state,
fresh-failure rollback, idempotent rerun, foreign receipt, unwritable
dir, process-boundary argv safety, output caps, timeouts, PATH
resolution, receipt closed-fields/determinism, preflight classifications,
and the extended static guards.

Evidence gaps (SIR-PS3-013): no adversarial archive tests (traversal,
symlink/hardlink/FIFO members, FIFO-at-package.json hang — all confirmed
live in this review); no bin-path-traversal test; no empty-dir activation
test; no post-pi-install failure test (the fresh-failure test injects
failure *at* `pi install`, not after its success); no concurrent
different-selection test; no real npm-pack naming test (fixtures bake the
`@` form); no root-refusal test; no digest-trust-level receipt test. The
fixtures' fake `pi` is compliant by construction and does not exercise
real `pi list` output matching (the loose substring match would not be
caught).

## 20. Documentation truthfulness (Area T)

README: truthful (PS-3 gate status, local installer section, Linux-only
claim, local-artifact lane, receipt location). Implementation report:
inaccurate on three points — (1) "a failing fresh install leaves nothing
behind" (§16) — disproven (SIR-PS3-002); (2) "PARTIAL ⇔ any selected
component is declined" (§5) — implementation is the omitted/unverified
disjunction; (3) §9 "matching the contract's tarball naming" — the
contract's *tarball* name is the hyphen form (product-contract §6); the
`@` form is the *directory* form; the §20 manual smoke must have renamed
the pilot artifact (undisclosed). No release evidence is presented as
local evidence — the report's local-vs-release distinction is otherwise
careful.

## 21. Findings

### SIR-PS3-001 — MAJOR — SECURITY — archive extraction confinement is not structural; FIFO member causes an unbounded installer hang

- **Location**: `src/installer/components.ts` `extractArtifact`
  (`tar -xzf <artifact> -C <dir>`); downstream `artifact.ts`
  `findPackageRoot`/`readPackageIdentity` (synchronous `readFileSync`).
- **Violated invariant**: "NO archive member may cause filesystem
  mutation outside the attempt-owned staging root" — required
  structurally; currently delegated to the PATH-found `tar` binary's
  version-dependent protections. Also: bounded/terminating installer
  behavior.
- **Consequence**: (a) confirmed — a FIFO member at `package/package.json`
  extracts cleanly (tar exit 0) and hangs the installer forever (no
  timeout on the blocking open); (b) on any tar without the 1.34/1.35-era
  protections, `..`/symlink/hardlink members can write arbitrary
  user-writable files in the operator's context (e.g. `~/.bashrc`,
  `~/.ssh/authorized_keys`, `~/.local/bin`). The default local lane
  installs untrusted artifacts (no digest expectation).
- **Reproduction**: hostile tarballs under `/tmp` (all escape vectors
  refused by GNU tar 1.35; FIFO accepted; `timeout 5` run of
  `findPackageRoot` → exit 124).
- **Smallest safe correction**: pre-extraction member scan (`tar -tvzf`
  or a minimal built-in reader) rejecting absolute names, any `..`
  component, and every non-regular/non-directory member (the real pilot
  Gateway artifact is 503/503 regular files — nothing legitimate is
  lost); refuse the archive before extraction. Optionally replace
  blocking `readFileSync` with `lstat`-guarded reads.
- **Envelope**: inside PS-3 (pi-shuttle's own extraction boundary).

### SIR-PS3-002 — MAJOR — PRODUCT — external `pi install` side effect is untracked; "rolled back" reported while pi-guard remains installed

- **Location**: `src/installer/install.ts` `rollback()` +
  `installPiGuardComponent` (`components.ts`); report §16 claim.
- **Violated invariant**: installation-contract §6 rollback truthfulness;
  "a failing fresh install leaves nothing behind" (report).
- **Consequence**: a failure after `pi install` succeeds (proven: bin-link
  EEXIST injection) leaves pi-guard installed in the Pi package store
  while the installer prints `rollback: rolled back (prior installation
  state preserved)` and exit 2. Pre-existing pi-guard state is also never
  recorded, so attempt-vs-preexisting cannot be distinguished later.
- **Reproduction**: isolated HOME + fake pi; failure injected at
  bin-link stage → 1 pi install recorded post-rollback.
- **Smallest safe correction**: (a) record Pi-side pre-existing state via
  a read-only `pi list` check before `pi install`; (b) when a later step
  fails after `pi install` succeeded, classify the outcome truthfully as
  `partial rollback (n/m …; pi-guard remains installed in the Pi package
  store — re-run the installer or remove manually)`; do not invent a
  destructive Pi removal command. Optionally reorder bin-link before the
  `pi install` step (narrows, does not close, the residual).
- **Envelope**: inside PS-3.

### SIR-PS3-003 — MODERATE — SECURITY — smoke bin path from untrusted artifact is not confined to the package root

- **Location**: `src/installer/components.ts` (bin surface check +
  smoke): `binRelative` from the artifact's `package.json` is used
  unvalidated as `join(root, binRelative)` (pre-activation read) and
  `join(targetDir, binRelative)` (executed by node in the smoke).
- **Violated invariant**: package-content confinement; a path derived
  from an untrusted artifact must not address files outside the package.
- **Consequence**: `bin: {"project-gateway-mcp":
  "../../../../tmp/evil.js"}` makes the installer's smoke execute an
  arbitrary file outside the installed package (node runs it in the
  operator's context). The artifact's own bin is executed by design, so
  this adds a *confusion* vector (executing a pre-existing unrelated
  file) rather than a new trust surface — still a real confinement gap.
- **Smallest safe correction**: reject absolute bin paths and any `..`
  component; require `path.resolve(binRelative)` to stay inside the
  package root before both checks.
- **Envelope**: inside PS-3.

### SIR-PS3-004 — MAJOR — PRODUCT — expected artifact filenames mismatch real npm-pack naming; intended install path broken with real artifacts

- **Location**: `src/installer/components.ts` (`GATEWAY_ARTIFACT_FILE`,
  `PI_GUARD_ARTIFACT_FILE`); report §9/§20; test fixtures.
- **Violated invariant**: the installer must install the actual pinned
  artifacts without manual renaming (installation-contract §5.4;
  product-contract §6 artifact identity).
- **Consequence**: with the real pilot Gateway tarball
  (`project-gateway-artifact-core-0.1.0.tgz`, present in the clean
  reference repo) and the real pi-guard pack output
  (`pi-guard-0.1.2.tgz`, verified via `npm pack --dry-run`) in
  `--artifact-dir`, the installer returns
  `ERR-PS3-ARTIFACT-UNAVAILABLE`/REFUSED. The report's manual smoke must
  have renamed the artifact; tests bake the `@` form in, hiding the
  break.
- **Smallest safe correction**: accept the hyphen form (npm-pack
  convention, contract-named); or accept both with the hyphen form
  preferred. Update fixtures to the real names and add a naming test.
- **Envelope**: inside PS-3.

### SIR-PS3-005 — MODERATE — PRODUCT — non-batch selection flags silently enable batch semantics with a silent pi-guard default

- **Location**: `src/installer/selection.ts` (`parseInstallerArgs`:
  `!batch && (gateway!==undefined || piGuard!==undefined) → batch=true`;
  `selections: { gateway: gateway ?? true, piGuard: piGuard ?? true }`).
- **Violated invariant**: installation-contract §2 — "no silent defaults
  in batch mode for components 1–2"; the usage text ("batch mode requires
  explicit --gateway and --pi-guard selections").
- **Consequence**: proven — `--gateway yes` alone (no `--batch`) installs
  BOTH components, pi-guard silently defaulted to yes (COMPLETE result,
  pi install recorded). An operator who declined nothing but asked only
  for the Gateway gets a full stack installed non-interactively.
- **Smallest safe correction**: when any selection flag is present
  without `--batch`, require BOTH selections explicitly (typed error
  naming the missing flag), or keep the unspecified component interactive.
- **Envelope**: inside PS-3.

### SIR-PS3-006 — MODERATE — PRODUCT — receipt/result do not record the digest trust level

- **Location**: `src/installer/install.ts` (receipt entries) /
  `src/installer/receipt.ts` (schema); `digestVerifiedAgainstExpectation`
  exists in `artifact.ts` but is dropped before the receipt.
- **Violated invariant**: "receipt wording makes the trust level
  unmistakable"; a locally observed digest must not be
  indistinguishable from a verified expected digest.
- **Consequence**: a COMPLETE result from an unauthenticated local-lane
  artifact and a COMPLETE result from a digest-verified artifact produce
  byte-equivalent receipt digest fields (`commitVerified` covers only the
  commit claim); downstream consumers (doctor/PS-4/release evidence)
  cannot tell them apart.
- **Smallest safe correction**: add `digestVerified: boolean` per
  component entry (or a notes line) and surface it in the COMPLETE
  report line when expectations were absent.
- **Envelope**: inside PS-3.

### SIR-PS3-007 — MODERATE — PRODUCT — contract-mandated root/sudo refusal not implemented

- **Location**: `src/installer/*` (no uid check anywhere).
- **Violated invariant**: installation-contract §4 — "The installer
  refuses to run with sudo/root for user-content installation (per-user
  layout, no privileged operations)".
- **Consequence**: run as root, the installer writes the per-user layout
  into `/root`, and tar device members (`mknod`) succeed — amplifying the
  extraction exposure; the product's per-user posture is silently
  violated.
- **Smallest safe correction**: `if (typeof process.getuid === 'function'
  && process.getuid() === 0) → REFUSED` with the contract message
  (preflight, before any mutation) + a test.
- **Envelope**: inside PS-3.

### SIR-PS3-008 — MODERATE — PRODUCT — `pi list` verification can false-positive on the bare name substring

- **Location**: `src/installer/components.ts` (`stdout.includes(targetDir)
  || stdout.includes('pi-guard')`).
- **Violated invariant**: verification must confirm the exact pinned
  source/version; an unrelated extension path/name must not satisfy it.
- **Consequence**: any pre-existing package whose source or path contains
  `pi-guard` (e.g. `pi-guard-extra`) yields `installed-verified`
  (`verifiedBy: pi-list`) without the pinned 0.1.2 source being installed.
  The exact-path arm is sound (real `pi list` echoes the given source;
  inspected read-only) but the OR-fallback defeats it.
- **Smallest safe correction**: parse `pi list` lines and require a line
  exactly equal to `targetDir` (or the exact `pi-guard@0.1.2` token);
  drop the loose substring.
- **Envelope**: inside PS-3.

### SIR-PS3-009 — MODERATE — PRODUCT — concurrent different-selection installers: final receipt can disagree with final state

- **Location**: `src/installer/install.ts` (no attempt-spanning lock;
  receipt is the last finisher's).
- **Violated invariant**: "every successful result must correspond to
  coherent final state" (review Area Q); the receipt is "the single
  source of truth" (installation-contract §5.8).
- **Consequence**: proven — A(both)+B(gateway-only) concurrent: if B
  finalizes last, the receipt says PARTIAL/omitted:['pi-guard'] while
  pi-guard IS installed (packages dir + Pi store). Same-selection
  concurrency is coherent (also proven).
- **Smallest safe correction**: reuse the lock primitive for an
  attempt-spanning install lock (`<stateDir>/install.lock`), or
  reconcile receipt content against the actual final component state
  before finalizing.
- **Envelope**: inside PS-3.

### SIR-PS3-010 — MODERATE — SECURITY — activation silently replaces a foreign EMPTY directory

- **Location**: `src/installer/components.ts` `activatePackageRoot`
  (plain `renameSync`).
- **Violated invariant**: "a pre-existing target with a foreign identity
  fails closed; foreign state is never overwritten" — an empty foreign
  dir is overwritten (POSIX rename replaces empty dirs).
- **Consequence**: proven — a pre-existing foreign empty dir at the
  target was destroyed and replaced, `created: true`. Interacts with
  rollback bookkeeping (`preExisting` was true, so the replaced content
  survives a later rollback).
- **Smallest safe correction**: `mkdirSync(targetDir, {mode:0o700})`
  first — atomic no-clobber (EEXIST → idempotent-verify path); then
  `renameSync` onto the directory this attempt itself created.
- **Envelope**: inside PS-3.

### SIR-PS3-011 — MINOR — PRODUCT — rollback removes the bin link without an identity re-check

- **Location**: `src/installer/install.ts` `rollback()`.
- **Consequence**: if the attempt-created link was replaced by a foreign
  link between creation and rollback (narrow race), rollback deletes the
  foreign link. Rollback "removes only a link created by this attempt" is
  not literally guaranteed.
- **Smallest safe correction**: `readlinkSync` the path and unlink only
  when it still equals the attempt's own target.
- **Envelope**: inside PS-3.

### SIR-PS3-012 — MODERATE — OPTIONAL HARDENING — runProcess can hang past its timeout when a subprocess leaves a grandchild on the pipes

- **Location**: `src/installer/process.ts` (resolve on `close`; timeout
  kills only the direct child with SIGKILL).
- **Consequence**: a subprocess that spawns a background grandchild
  inheriting stdout/stderr prevents the `close` event (pipes stay open)
  — the promise never resolves even after the timeout fired, so the
  60 s `pi install` bound and the 10 s smoke bound can silently become
  unbounded. The direct-child kill also leaves grandchildren running.
- **Smallest safe correction**: resolve on `exit` (destroying the
  streams) and/or spawn `detached` + kill the process group
  (`process.kill(-child.pid)`) on timeout.
- **Envelope**: inside PS-3.

### SIR-PS3-013 — MINOR — TEST / EVIDENCE — adversarial coverage gaps

- **Location**: `tests/unit/installer-{flow,process,receipt,preflight}.test.ts`,
  `tests/helpers/installer-fixtures.ts`.
- **Consequence**: the live findings above (FIFO hang, tar-version
  dependence, bin-path traversal, empty-dir clobber, post-pi-install
  rollback residual, concurrent different-selection receipt, real
  artifact naming, root refusal, digest-trust field) are all unpinned;
  the fixtures bake the `@`-form names and a compliant fake `pi`.
- **Smallest safe correction**: extend fixtures with hostile-member
  tarballs (Python-built or via a member-level builder), a
  post-pi-install failure injection, a concurrent different-selection
  test, and real-name artifact tests.
- **Envelope**: inside PS-3.

### SIR-PS3-014 — MINOR — DOCUMENTATION — implementation report over-claims

- **Location**: report §5 ("PARTIAL ⇔ any selected component is
  declined" — implementation is the omitted/unverified disjunction),
  §9 ("matching the contract's tarball naming" — the contract's tarball
  name is the hyphen form), §16 ("a failing fresh install leaves nothing
  behind" — disproven, SIR-PS3-002), §20 (manual smoke used the
  hyphen-named pilot artifact without disclosing the rename).
- **Smallest safe correction**: align the three claims with the verified
  implementation and disclose the artifact rename; no contract document
  change needed.
- **Envelope**: inside PS-3 (documentation only).

## 22. Envelope exceptions

**None.** Every correction is a pi-shuttle-side change inside the
HUMAN-APPROVED PS-3 envelope (pi-shuttle's own installer, extraction
boundary, receipt, and tests). No correction requires Gateway or pi-guard
source changes, PS-4 lifecycle work, macOS host-lane semantics, trusted
Gateway authority in pi-shuttle, a new privileged model, or public
release/network publication. The Gateway dependency-materialization
deferral is a recorded release dependency, not a PS-3 defect.

## 23. Exact focused verification performed

- Full read-through of all 8 installer source files, `install.sh`, 4 new
  test suites + fixtures, extended static guard, README delta, and the
  implementation report; PS-0 contracts re-read as normative authority;
  PS-2 writer re-inspected (SIR-PS2-001/002 corrections verified).
- `npm test` → **99/99 pass** (independently counted per suite);
  `npm run typecheck` clean; `npm ci --dry-run` green;
  `git diff --check` clean.
- **Adversarial tar fixtures** (Python-built, `/tmp`, removed): `..`
  members, absolute members, pax long `..` names, symlink-then-file
  (shallow, deep `../..`, absolute-target), hardlink escapes
  (`/etc/passwd`, `..`-target), device members, FIFO members — extracted
  with the installer's exact argv against GNU tar 1.35: all mutation
  escapes refused (exit ≥1); FIFO accepted (exit 0); **FIFO at
  `package/package.json` → confirmed unbounded hang** of
  `findPackageRoot` (timeout 5 → 124).
- **Real-component evidence (read-only)**: pilot Gateway tarball
  inspected — 503/503 regular members, real name
  `project-gateway-artifact-core-0.1.0.tgz`, package.json identity and
  `bin` verified; pi-guard `npm pack --dry-run` → `pi-guard-0.1.2.tgz`.
- **Real Pi inspection (read-only)**: `pi --version` → `0.84.1` (version
  parsing verified against the real shape); `pi list` output format
  inspected (source + path lines); `pi install --help` inspected. No
  real Pi state was modified.
- **Focused experiments** (isolated HOME + fake pi, `/tmp`, removed):
  (1) concurrent same-selection installers → both COMPLETE, coherent
  final state; (2) concurrent different-selection installers → final
  receipt racy; (3) failure injected at bin-link stage AFTER `pi install`
  → "rolled back" while 1 pi install remained; (4) `--gateway yes`
  without `--batch` → pi-guard silently installed, COMPLETE; (5) foreign
  empty dir at activation target → silently replaced; (6) foreign bin
  entry preserved under failure.
- No Gateway/pi-guard suites run; no external repo modified; no
  persistent Pi mutation.

## 24. Exact Git status

Baseline HEAD `838b9a05c390f8179650cfcad2953639e332b6d2` unchanged; no
remote configured; nothing staged; no commits created.

```
 M README.md
 M tests/unit/static-guard.test.ts
?? docs/reports/pi-shuttle-ps-3-installer-component-composition-implementation-report.md
?? install.sh
?? src/installer/
?? tests/helpers/
?? tests/unit/installer-flow.test.ts
?? tests/unit/installer-preflight.test.ts
?? tests/unit/installer-process.test.ts
?? tests/unit/installer-receipt.test.ts
```

(`dist/`, `dist-test/`, `node_modules/` gitignored.) The only file created
by this review is `docs/reports/pi-shuttle-ps-3-installer-component-
composition-senior-review.md`, left uncommitted and unstaged.

## 25. Final verdict

PS-3 is a well-structured installer with a truthful taxonomy, a genuinely
fixed shell shim, a clean argv-safe process boundary, a corrected
transactional receipt path, meaningful static guards, and a passing
99-test suite. But three MAJOR findings stand: archive extraction
confinement is not structural (confirmed FIFO hang; version-dependent
escape protection), rollback claims are false at the Pi boundary (a
"rolled back" failure can leave pi-guard installed in the Pi package
store), and the installer's expected artifact names do not match the real
npm-pack artifacts, breaking the intended install path with real
artifacts — plus the contract-mandated root refusal is missing. All
corrections are inside the PS-3 envelope.

`PS-3 SENIOR REVIEW — CORRECTIONS REQUIRED`
