# PS-3 — pi-shuttle Installer + Component Composition — Implementation Report

**Status:** Implementation complete; focused corrections (SIR-PS3-001..014)
applied per the senior review; uncommitted, unstaged, awaiting focused
rereview and the local baseline commit. No commit, no remote, no
publication in this gate.

## 1. Baseline SHA

- Baseline HEAD: `838b9a05c390f8179650cfcad2953639e332b6d2`
  (`feat: establish pi-shuttle PS-2 CLI config model`), verified unchanged.
- Gateway PS-1 baseline (external, untouched):
  `7f3b4afdb43704e7dac82da7b086d8367347c641`.
- pi-guard (external, untouched): `v0.1.2` / `7a7580cc4cbd7926797564c72269394fc29a860a`.

## 2. Objective

The smallest production installer that truthfully establishes a pi-shuttle
installation containing the operator-selected components (pi-shuttle,
Project Gateway MCP, pi-guard): select → preflight → verify exact artifacts
→ stage → activate → receipt → truthful COMPLETE/PARTIAL report. Project
onboarding is NOT implemented (PS-4-owned).

## 3. Exact installer entrypoint

- `install.sh` (repo root) — the ONLY shell surface in the product: a fixed
  exec shim that locates the pi-shuttle build and hands argv verbatim to
  the Node installer core (`dist/installer/main.js`). The future public
  one-liner may fetch this file once a release URL exists; in this gate it
  runs from the repository build. `NODE_BIN` overridable.
- The closed `pi-shuttle` operational CLI grammar (doctor / project /
  start / --help / --version) is UNCHANGED; the installer is a separate
  operator surface with its own closed argument grammar.

## 4. Interactive/batch UX

- Interactive (default): the five approved prompts (installation-contract
  §2) — Gateway? (default yes), pi-guard? (default yes), installation
  directory (default `~/.local/share/pi-shuttle`), bin directory (default
  `~/.local/bin`), configure a project now? (default no; an affirmative
  answer prints truthful deferred guidance — `pi-shuttle project add
  <path>` is PS-4-owned — and never implements onboarding).
- Batch: `--batch` REQUIRES explicit `--gateway yes|no` and
  `--pi-guard yes|no` (no silent defaults, installation-contract §2);
  any explicit component-selection flag WITHOUT `--batch` also requires
  BOTH selections (SIR-PS3-005 — a single flag can never silently default
  the other component); `--install-dir`, `--bin-dir`, `--artifact-dir`,
  `--expect-gateway-sha256`, `--expect-pi-guard-sha256`; `--help`.
  Unknown options/values fail closed with usage (exit 2).
- Prompting uses one readline line-iterator session (robust on pipes and
  TTYs; verified by subprocess tests with piped answers).

## 5. Component selection semantics

- COMPLETE ⇔ the ACTUAL final installation state has both components
  installed and `installed-verified` (components the operator did not
  select but that are already installed are re-verified and recorded —
  the receipt never disagrees with the final component state;
  SIR-PS3-009).
- PARTIAL ⇔ any component is missing (omitted) from the final state OR
  any present component ended `installed-unverified` (e.g. gateway bin
  smoke not runnable because dependency materialization is a release
  dependency; pi-guard not confirmed via `pi list`).
- FAILED ⇔ any selected component install/verification fails → rollback.
- UNSUPPORTED (platform) / REFUSED (preflight/policy/foreign state/
  concurrent-installer BUSY).
- Exit codes (closed, documented): 0 COMPLETE; 1 PARTIAL; 2 FAILED /
  UNSUPPORTED / REFUSED / malformed invocation.
- Both components declined on a machine where neither is installed is
  PARTIAL (a complete installation requires both components per
  installation-contract §7); declining components that are already
  installed cannot make an existing complete installation "partial" —
  the receipt reports actual state.

## 6. Filesystem layout

Reuses the PS-2 layout model (`resolveLayout` + optional `--install-dir` /
`--bin-dir` overrides for the share and bin dirs; state/config stay
home-derived): `~/.local/share/pi-shuttle` (packages, stores, git-home,
git-tmp, manifests), `~/.local/state/pi-shuttle` (receipt, staging, logs),
`~/.config/pi-shuttle`, `~/.local/bin`. Dirs 0700; receipt and documents
0600. No hard-coded `/home/chef`, `/usr/bin/git`, `/usr/local`; no
privileged operation; no project-directory modification; no Gateway
trusted-store initialization.

## 7. Prerequisite model (installer preflight ≠ PS-4 doctor)

- Platform/architecture: Linux x86_64 (the only supported lane); macOS
  arm64 → REFUSED with "gated pending PS-6 evidence"; anything else →
  UNSUPPORTED.
- Node: the running interpreter IS the installer's node; exact validated
  lane 22.23.2 required (others REFUSED with the contract's
  runtime-compatible-but-not-validated explanation, installation-contract
  §4).
- tar: required for artifact extraction (refused when absent).
- pi: presence + version classification required only when pi-guard is
  selected (see §18); pi presence is also used (read-only `pi list`) to
  reconcile an already-installed pi-guard into the receipt.
- **Root/sudo (SIR-PS3-007)**: the installer REFUSES before any mutation
  when running with root privileges (`process.getuid() === 0`) with the
  per-user-installation explanation; injectable UID seam for tests.
- Writable layout: layout dirs created 0700, fail closed when unwritable.
- Existing receipt state: foreign/invalid receipt or a different
  pi-shuttle version → REFUSED (never overwritten).
- Git probe is NOT performed: no git-based acquisition exists in PS-3
  (contract ties git to "if required by actual component acquisition");
  git is a PS-4 doctor probe.

## 8. Exact component pins

All consumed from the PS-2 compatibility manifest (`src/compat/manifest.ts`
— no duplicated constants): pi-shuttle 0.1.0; gateway 0.1.0 at commit
`7f3b4afdb43704e7dac82da7b086d8367347c641`; pi-guard 0.1.2 at commit
`7a7580cc4cbd7926797564c72269394fc29a860a`; Pi baseline 0.83.0; node lane
22.23.2; git lane 2.45.4 (recorded, not probed — see §7). No `latest`, no
floating branches, no ranges.

## 9. Artifact integrity model

- Local-file artifact source (`--artifact-dir`); expected file names are
  the REAL npm-pack artifact names (hyphen form, SIR-PS3-004):
  `project-gateway-artifact-core-0.1.0.tgz` and `pi-guard-0.1.2.tgz`
  (verified against the actual pilot Gateway tarball and the pi-guard
  `npm pack --dry-run` output). The `@` form is the installed
  package-DIRECTORY name (`packages/project-gateway-artifact-core@0.1.0/`,
  installation-contract §5.4) — it is NOT an artifact file name and is
  NOT accepted as one.
- SHA-256 computed for every artifact; when `--expect-*-sha256` is given,
  mismatch → `ERR-PS3-ARTIFACT-DIGEST-MISMATCH` (fail closed before any
  activation). When no expectation exists, the digest is computed and
  recorded in the receipt as an observed digest with
  `digestVerified: false` — explicitly NOT release digest verification
  (the manifest's `null` release digests remain `null`; no fabricated
  values; SIR-PS3-006).
- Package identity (name/version) verified inside the artifact after
  extraction; the declared Gateway bin path is treated as untrusted
  content (relative, traversal-free, resolved strictly inside the package
  root, regular file by lstat — SIR-PS3-003); corrupted or hostile
  archives fail closed at the structural pre-scan (SIR-PS3-001).
- A remote/public acquisition seam is intentionally NOT implemented (no
  release URL exists, no publication authorized); the release dependency
  (official artifacts + digests + dependency materialization) is recorded
  in §23.

## 10. Gateway installation composition

- Extract the verified artifact into
  `<shareDir>/packages/project-gateway-artifact-core@0.1.0/` (contract
  layout form), verify package identity + bin file, then run a bounded
  `node <bin> --help` smoke (10 s).
- Smoke classification: exit 0 → `installed-verified`; missing-dependencies
  failure (ERR_MODULE_NOT_FOUND / Cannot find module) →
  `installed-unverified` with the truthful note that dependency
  materialization (`npm install` of the three pinned deps) is a release
  dependency; any other failure → component FAILED.
- Structural archive confinement (SIR-PS3-001): every artifact is scanned
  member-by-member BEFORE extraction (pi-shuttle-owned policy, Node core
  parser) — only regular files and directories with safe relative names
  are accepted; symlinks, hardlinks, FIFOs, devices, absolute names, and
  `..`/`.`/empty path components are rejected before tar runs; malformed
  or truncated archives fail closed. A FIFO at `package/package.json` is
  rejected before any read — the installer can never block on a special
  file (defense in depth: lstat-before-read on package.json and the bin).
- Never imports Gateway private source, never runs project bootstrap,
  never starts a long-running MCP service.

## 11. pi-guard installation composition

- Extract the verified artifact into
  `<shareDir>/packages/pi-guard@0.1.2/` and install it through Pi's
  supported package mechanism: `pi install <source>` (local path source —
  the same mechanism pi-guard v0.1.2 is installed by on this host; verified
  against the live `pi install --help` surface). Verification (SIR-PS3-008)
  requires an EXACT `pi list` line matching the pinned source
  `<shareDir>/packages/pi-guard@0.1.2` → `installed-verified`
  (`verifiedBy: pi-list`); lookalikes (`pi-guard-extra`, other versions,
  paths merely containing `pi-guard`) never satisfy verification.
  Pre-existing state (SIR-PS3-002): a read-only `pi list` inspection
  BEFORE the install records whether the exact source is already present;
  when present the install is skipped and the attempt never claims
  ownership of the Pi-side entry.
- No pi-guard source import; no arbitrary newer version; no modification
  of the pi-guard repository. The exact `pi install` acceptance on the
  0.83.0 lane is validated at the PS-5 Lane A gate.

## 12. Process/network boundaries

- ONE process boundary: `src/installer/process.ts` (runProcess +
  resolveExecutable). argv arrays only; no shell strings; no `shell: true`
  (install.sh is the fixed exec-shim exception, documented in the file);
  bounded output (64 KiB caps with truncation markers); bounded timeouts
  (default 30 s; smoke 10 s; pi install 60 s); deterministic exit/signal
  handling; explicit executable resolution through PATH; no generic exec
  API; component paths/versions are argv elements only (injection-proof —
  tested with hostile argv values).
- ZERO network: no http(s)/net/tls/dgram imports anywhere in src
  (guard-pinned); no speculative remote endpoints; remote acquisition is
  disabled until official artifacts/URLs exist.

## 13. Staging/activation algorithm

install-wide lock (`<stateDir>/install.lock`, shared PS-2 O_EXCL
semantics) → preflight → staging (`<stateDir>/staging/ps3-<pid>-<ts>`,
0700) → acquire artifacts → structural archive scan → digest/identity
verify → extract to staging → bounded smoke → activate (mkdir
reservation + rename) → bin link → pi-guard (tracked external Pi
mutation) → receipt (LAST) → staging cleanup.

- **Install-wide concurrency boundary (SIR-PS3-009):** ONE attempt-
  spanning lock (the same PS-2 O_EXCL bounded-retry lock, extracted to
  `src/persistence/lock.ts`) is acquired before the first mutation and
  held through staging, activation, the external Pi mutation, the bin
  link, the final receipt, and rollback. A concurrent installer waits
  boundedly (≈500 ms) then fails closed with ERR-PS2-CONFIG-BUSY;
  stale locks are never auto-stolen (documented recovery guidance). A
  success whose receipt disagrees with the final component state is
  impossible; the receipt additionally records ACTUAL final state for
  unselected-but-present components.
- Activation is **atomic no-clobber by reservation (SIR-PS3-010)**: the
  target directory is reserved with `mkdirSync` (O_EXCL semantics); a
  pre-existing target (idempotent rerun) is identity-verified and
  reused, never overwritten — including a pre-existing EMPTY directory,
  which is refused (foreign state) rather than replaced; the verified
  extracted package root is renamed only into the attempt's own empty
  reservation. A crash after reservation leaves an empty directory that
  the next attempt refuses (fail closed; documented).
- **Structural archive confinement (SIR-PS3-001):** every artifact is
  scanned member-by-member BEFORE extraction by pi-shuttle's own Node
  core parser (see §10); external tar only ever sees already-approved
  member sets.
- Deterministic order: gateway → bin link → pi-guard → receipt (the bin
  link is created BEFORE the external Pi mutation to remove one avoidable
  post-Pi failure point).
- No partial component is ever presented as active; the receipt is written
  only for finalized COMPLETE/PARTIAL states.
- pi-shuttle bin link: `~/.local/bin/pi-shuttle` → the package this
  installer runs from (local lane); an existing link with a different
  target → REFUSED (foreign state); rollback removes the link only while
  it still points at this attempt's target (SIR-PS3-011).

## 14. Receipt model

`~/.local/state/pi-shuttle/install.json` — closed/versioned
(`receiptVersion: 1`), deterministic field order, mode 0600, atomically
persisted and concurrency-safe through the PS-2 transactional writer
(`mutateDocumentAtomically`). Records: pi-shuttle version, installedAt
ISO timestamp, platform lane, COMPLETE/PARTIAL result, install/bin dirs,
per-component entries (status installed-verified/unverified/failed,
version, manifest commit claim + `commitVerified: false` for local
artifacts, **`digestVerified`** — true only when the observed SHA-256
matched an explicitly supplied expected digest, false for locally
observed digests (SIR-PS3-006) — verified artifact SHA-256, install
paths, smoke/pi verification facts, pi version), omitted components,
bounded notes. Never serializes provenance, approval authority,
grant/receipt authority objects, secrets, or credentials (test-pinned).

## 15. Idempotence

Rerun with the same selections/versions: artifacts re-verified (digest +
identity), existing component dirs identity-verified and skipped
(no churn — test-pinned), receipt re-written consistently (fresh
timestamp). Partial → completion: rerunning with the omitted component
selected completes it. Incompatible/foreign prior state (receipt or
component identity) fails closed. Unselected-but-installed components are
re-verified (bounded, read-only) and recorded in the receipt so the
receipt always describes the ACTUAL final component state (SIR-PS3-009).

## 16. Rollback

Limited to THIS attempt's mutations: staging dir, component dirs the
attempt created (tracked via pre-registered rollback candidates — a
candidate is removed only if it did not pre-exist), and the bin link if
created AND still pointing at this attempt's target (a foreign
replacement is preserved and reported — SIR-PS3-011). Prior receipt and
prior component installs are always preserved (test-pinned: a failing
rerun after a COMPLETE install leaves every component and the receipt
intact).

**Pi external side effect (SIR-PS3-002):** `pi install <source>` is an
EXTERNAL mutation outside pi-shuttle staging. A read-only `pi list`
inspection BEFORE the install records whether the exact source was
pre-existing; the attempt's own Pi mutation is tracked. When a later
step fails after an attempt-performed `pi install` succeeded, the
installer reports **PARTIAL ROLLBACK** and states explicitly that
pi-guard remains installed in the Pi package store (no supported removal
mechanism in v0.1.0) with re-run/manual-recovery guidance — full rollback
is never claimed while the attempt-created Pi install remains. A
pre-existing pi-guard is never removed and never claimed as an
attempt-created residual. Rollback never deletes trusted stores, project
directories, Git repos, or unrelated Pi extensions. The rollback result
is reported truthfully ("rolled back" vs "partial rollback (n/m …)").

**Correction note (SIR-PS3-014):** the earlier claim that "a failing
fresh install leaves nothing behind" was false for failures AFTER a
successful `pi install`; it is replaced by the truthful PARTIAL ROLLBACK
semantics above. A failing fresh install leaves nothing behind ONLY when
no external Pi mutation was performed.

## 17. COMPLETE/PARTIAL semantics

See §5. Opt-outs are reported as PARTIAL with the omitted components
named (a user opt-out is not an error — exit 1, not 2 — but is not a full
pi-shuttle stack).

## 18. Pi compatibility-policy handling

- Approved fact (normative, installation-contract §4): Pi 0.83.0 is the
  compatibility baseline (`pi-0.83.0-extension-api-v1`); non-baseline Pi
  versions (e.g. 0.84.x) are REFUSED with the contract's explanation —
  "0.83.0 is the verified baseline; 0.84.x is not a claimed lane" — not
  silently accepted. The production constant
  `PI_NON_BASELINE_POLICY = 'refuse-non-baseline'` implements exactly
  this approved policy (SIR-PS3-014: the previous "HUMAN DECISION
  REQUIRED" framing is corrected — the approved contract is normative
  and unambiguous; there is no current implementation blocker).
- **Future policy option (recorded, not a PS-3 item):** after a dedicated
  evidence/human gate, a later release MAY choose `installed but
  unverified` for non-baseline Pi. The pure classification layer
  implements both policies so that decision stays a one-line production
  constant; v0.1.0 refuses per the approved contract. No Pi 0.84.x
  support claim exists anywhere.

## 19. Platform-support handling

Linux x86_64 only (`linux-x86_64-posix-utf8-node22`); macOS arm64 gated
(PS-6), never claimed — the installer refuses with the gating explanation;
macOS Intel and Windows → UNSUPPORTED. No Gateway host-lane semantics
implemented. Installer code stays portable (PATH-based resolution, no
Linux-only assumptions) for later PS-6 work.

## 20. Tests and exact totals

**125 tests run / 125 pass / 0 fail / 0 skip** (`npm test`, Node v22.23.2,
TypeScript 7.0.2) — post-correction totals (99 before the focused
correction gate). New PS-3 suites: `installer-archive` (11 adversarial
archive tests: valid npm-pack shape, `..`, absolute, symlink,
symlink-then-file, hardlink, FIFO incl. the FIFO-at-package.json no-hang
probe, pax traversal, GNU longname, truncated archive, not-a-gzip,
member-name policy, real pilot artifact scan, hostile-archive flow
rejection), `installer-flow` (25 incl. the correction evidence: real
hyphen names, missing selection, root refusal, digest trust, pi-list
exact verification, post-pi PARTIAL ROLLBACK, pre-existing pi-guard,
foreign empty/file targets, concurrent different selections, bin-link
rollback identity, bin-path traversal), `installer-process` (7),
`installer-receipt` (6), `installer-preflight` (6); static guard
extended to the installer boundary (subprocess/env/crypto localization,
fs allowlists incl. the shared lock and the archive scanner,
mutation-boundary confinement). `npm run typecheck` clean;
`npm ci --dry-run` green; `git diff --check` clean.

Bounded real-component smoke (manual, not a committed test): the actual
pilot Gateway tarball (`project-gateway-artifact-core-0.1.0.tgz` from the
clean closure reference, read-only) — supplied to the installer under its
REAL hyphen name (no renaming; SIR-PS3-004) — identity verified,
extracted to packages/, bin present at `dist/runtime/mcp/cli.js`, smoke
correctly classified `installed-unverified` (ERR_MODULE_NOT_FOUND —
dependency materialization pending release), receipt truthful. The
Gateway repository was not modified.

## 21. Files changed

**New production (10):** `src/installer/{process,preflight,selection,
artifact,archive,components,receipt,install,main}.ts`; `install.sh`.
**Shared persistence/lock (narrow):** `src/persistence/lock.ts` — the
PS-2 O_EXCL lock semantics extracted for reuse by the install-wide lock
(SIR-PS3-009); `src/persistence/writer.ts` imports it (no behavior
change).

**New tests (6):** `tests/unit/installer-{process,preflight,receipt,flow,
archive}.test.ts`, `tests/helpers/installer-fixtures.ts`;
`tests/unit/static-guard.test.ts` extended.

**Docs:** `README.md` (status + local-installer section). No PS-0 contract
document modified; no new ADR (all decisions are mechanical resolutions
inside the approved envelope, recorded here).

## 22. Deviations from contract

None material. Resolutions inside the envelope:

1. Artifact acquisition is local-file only (release artifacts/URLs do not
   exist; publication not authorized) — the approved "local fixture/
   component lane now, record the release dependency" option.
2. Gateway dependency materialization deferred to release (needs npm
   registry access; not authorized in this gate) — classified truthfully
   as `installed-unverified` with a note.
3. Git preflight probe omitted (no git-based acquisition in PS-3; contract
   ties the probe to acquisition needs); git remains a PS-4 doctor probe.
4. Installer exit codes 0/1/2 defined (contract left them unspecified).
5. Post-activation verification runs BEFORE receipt finalization, so a
   failed attempt rolls back and preserves the prior receipt rather than
   marking a live receipt partial (installation-contract §5.7's
   partial-mark path is superseded by verify-before-finalize; the
   truthful outcome is identical).

## 21a. Focused-correction gate (SIR-PS3-001..014)

Closed by the focused correction + focused rereview (see
`pi-shuttle-ps-3-installer-component-composition-focused-rereview.md`):
structural archive confinement owned by pi-shuttle (Node-core scanner),
bin-path confinement, real npm-pack artifact names, no silent selection
defaults, `digestVerified` in the receipt, root refusal, exact pi-list
verification, truthful Pi-residual rollback, install-wide lock + actual-
state receipt reconciliation, mkdir-reservation activation, bin-link
rollback identity, adversarial test coverage, and report corrections.
SIR-PS3-012 is DEFERRED / OPTIONAL HARDENING (direct-child bounded
timeouts preserved; no process-group supervision in this gate).

## 23. Open risks / dependencies

- **PS-3 → PS-4**: `project add/list/remove`, `start`, full doctor remain
  PS-4-owned and deferred (unchanged, fail closed). Prompt 5 routes to
  deferred guidance only.
- **Release dependency**: official Gateway/pi-guard artifacts, release
  digests, public installer URL, and Gateway dependency materialization
  all require the external publication gate (test-and-release-plan §3).
  The receipt's `commitVerified: false` for local artifacts becomes true
  for release-built artifacts by construction.
- **PS-5 Lane A**: validate `pi install` acceptance of the local source
  path on the 0.83.0 lane and the ADR-037 predicate verification
  (pi-guard E2E).
- **PS-6**: macOS arm64 gated lane + Gateway host-lane change.
- **SIR-PS3-012 (DEFERRED / OPTIONAL HARDENING)**: runProcess resolves on
  `close` and the timeout kills only the direct child; a subprocess that
  leaves a grandchild holding the stdio pipes could delay resolution.
  Process-group supervision is explicitly NOT implemented in this gate
  (no generic child-tree management); revisit if a real subprocess
  exhibits the behavior.
- Stale `ps3-*.tmp` / interrupted-attempt staging remnants and a stale
  `install.lock` after a crash are fail-closed residuals: the next
  attempt refuses with documented recovery guidance (never auto-steals).
  A crash mid-attempt can leave a staging dir (documented; harmless; no
  partial state is ever active).

## 24. Git status (at correction-gate completion)

```
 M README.md
 M tests/unit/static-guard.test.ts
?? install.sh
?? src/installer/
?? src/persistence/lock.ts
?? tests/helpers/
?? tests/unit/installer-process.test.ts
?? tests/unit/installer-preflight.test.ts
?? tests/unit/installer-receipt.test.ts
?? tests/unit/installer-flow.test.ts
?? tests/unit/installer-archive.test.ts
?? docs/reports/pi-shuttle-ps-3-installer-component-composition-implementation-report.md
?? docs/reports/pi-shuttle-ps-3-installer-component-composition-senior-review.md
?? docs/reports/pi-shuttle-ps-3-installer-component-composition-focused-rereview.md
```

All PS-3 changes uncommitted and unstaged; baseline HEAD unchanged; no
remote configured; no Gateway/pi-guard modification; no push/tag/publish/
deploy. The focused rereview and the local baseline commit follow this
gate.

## 25. Readiness verdict

PS-3 delivers the smallest truthful installer: exact-pinned, digest-
verified component composition (Gateway + pi-guard) through a localized
argv-safe process boundary, pi-shuttle-owned structural archive
confinement, reservation-based atomic no-clobber activation, an
install-wide concurrency lock with actual-state receipt reconciliation,
rollback of attempt-owned mutations with truthful Pi-residual reporting,
a closed concurrency-safe 0600 receipt with explicit digest-trust facts,
truthful COMPLETE/PARTIAL/FAILED/UNSUPPORTED/REFUSED classification,
contract-mandated Pi-policy handling, root refusal, Linux-only claims,
zero network, zero new dependencies, and 125/125 focused tests — with
PS-4 ownership, release dependencies, and the deferred SIR-PS3-012
hardening documented. Ready for the focused rereview and local baseline
commit.
