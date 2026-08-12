# PS-3 — Installer / Component Composition — Focused Rereview

**Reviewer:** senior security / architecture reviewer (read-only focused
rereview of the SIR-PS3 correction gate).
**Scope:** SIR-PS3-001..011, 013, 014 only; SIR-PS3-012 confirmed
DEFERRED / OPTIONAL HARDENING. No reopening of clean PS-3 architecture
without evidence of a regression.
**Baseline:** `838b9a05c390f8179650cfcad2953639e332b6d2` (unchanged during
correction; commit follows this rereview per the gate authority).

---

## 1. Correction inventory

| Finding | Correction applied | Evidence |
|---|---|---|
| SIR-PS3-001 (MAJOR, archive confinement) | `src/installer/archive.ts`: pi-shuttle-owned Node-core gzip/tar scanner; closed member policy (regular files + directories only; absolute, `..`/`.`/empty components, symlink/hardlink/FIFO/device/socket/pax-global/meta types rejected BEFORE extraction; checksum-verified headers; block-aligned skipping incl. pax size overrides; GNU longname + pax path resolution identical to the extractor's; truncated archives fail closed; member/uncompressed limits). Defense in depth: `regularFileOrNull`/`readJsonFileIfRegular` lstat-before-read everywhere (package.json + bin). | tests `installer-archive` (11), hostile-flow test; FIFO-at-package.json no-hang probe; real pilot artifact scanned clean |
| SIR-PS3-002 (MAJOR, Pi residual) | Read-only `pi list` pre-inspection records pre-existing state; `piMutated`/`piPreExisting` tracked; rollback reports PARTIAL ROLLBACK with the explicit Pi-store residual when this attempt performed `pi install`; bin-link step moved before the Pi mutation; pre-existing pi-guard never removed or claimed | tests: post-pi failure, pre-existing pi-guard, rollback-preserve |
| SIR-PS3-003 (MODERATE, bin confinement) | `validateBinPath`: relative-only (single leading `./` normalized per npm convention), no `..`/`.`/empty components, strict resolve-inside-package check, lstat regular-file required before read AND before smoke execution (both staging and activated paths) | test: traversal fixture (unit + flow), replay 3 |
| SIR-PS3-004 (MAJOR, artifact names) | `GATEWAY_ARTIFACT_FILE = 'project-gateway-artifact-core-0.1.0.tgz'`, `PI_GUARD_ARTIFACT_FILE = 'pi-guard-0.1.2.tgz'` (real npm-pack names, verified against the pilot tarball and `npm pack --dry-run`); fixtures renamed; @-form rejected | tests 61, archive-pilot test, replay 4 |
| SIR-PS3-005 (MODERATE, selection) | Any explicit selection flag without `--batch` requires BOTH `--gateway` and `--pi-guard` (typed error naming the missing one); `--batch` unchanged | test: single-flag invocations, replay 5 |
| SIR-PS3-006 (MODERATE, digest trust) | Receipt schema `digestVerified: boolean` (true only on explicit expected-digest match), serializer/parser/validation updated, install composition + result notes surface locally-observed digests; `commitVerified` untouched | tests: digest-trust flow, receipt schema cases |
| SIR-PS3-007 (MODERATE, root) | `checkNotRoot` (injectable uid seam; default `process.getuid()`); REFUSED before any mutation (before stateDir creation) | test 63, preflight unit, replay 10 |
| SIR-PS3-008 (MODERATE, pi verification) | `piListConfirmsSource`: exact line match on the pinned source only; loose substring removed | tests 65 + fixture NO_RECORD mode, replay 7 |
| SIR-PS3-009 (MODERATE, concurrency) | Attempt-spanning `install.lock` (shared PS-2 O_EXCL lock extracted to `src/persistence/lock.ts`; bounded wait, deterministic BUSY, never steals); held through staging → activation → Pi mutation → bin link → receipt → rollback; receipt records ACTUAL final component state (unselected-but-installed components re-verified and recorded; unrecognized existing state fails closed) | test 70 (both BUSY and serialized paths), replay 9 ×4 |
| SIR-PS3-010 (MODERATE, activation) | `mkdirSync` reservation (atomic no-clobber) + lstat-verify + rename into the attempt's own empty reservation; foreign empty dir/file/non-empty dir all refused; crash-residue fails closed (documented) | tests 68/69, replay 8 |
| SIR-PS3-011 (MINOR, bin-link rollback) | Rollback re-reads the link and unlinks only while it still equals the attempt's target; foreign replacement preserved + reported | test 71 (unit on exported rollback) |
| SIR-PS3-013 (MINOR, evidence) | 11 new adversarial archive tests + 7 new flow tests; fixtures extended (hyphen names, hostile tar builder, fake-pi controls: NO_RECORD, LIST_EXTRA, CHMOD injections) | suite totals below |
| SIR-PS3-014 (MINOR, docs) | Implementation report corrected: PARTIAL = omitted/unverified terminology; hyphen artifact vs @ directory names; false "leaves nothing behind" claim replaced with truthful PARTIAL ROLLBACK semantics; manual smoke rename disclosed; Pi policy reframed (contract-mandated refusal; future policy option recorded, not a blocker) | report diff |
| SIR-PS3-012 | **DEFERRED / OPTIONAL HARDENING** — bounded direct-child timeouts preserved; no process-group supervision or generic child-tree management introduced. Recorded in report §23. | — |

## 2. Mandatory rereview questions

1. **Can any accepted member be a symlink/hardlink/FIFO/device/special file or escape staging?** NO. The scanner rejects every non-regular/non-directory member and every absolute/`..`/`.`/empty-component name before tar runs; the extractor only ever sees approved member sets. Empirically: hostile archives (`..`, absolute, symlink-then-file, hardlink, FIFO, pax traversal, GNU longname traversal, truncation) all fail closed with the scan; a FIFO at `package/package.json` is rejected before any read — the installer cannot block on a special file (lstat-before-read defense additionally proven by a subprocess probe against a real extracted FIFO). The real pilot Gateway artifact (503 regular members) scans clean.
2. **Can the installer ever print FULL ROLLBACK after an attempt-created `pi install` remains?** NO. `piGuardPiState === 'attempt-installed'` forces the rollback report to `partial rollback` with the explicit "pi-guard remains installed in the Pi package store" residual and recovery guidance. Proven by the post-pi-install failure test and replay 6.
3. **Do real npm-pack artifacts install without manual renaming?** YES. Hyphen-form names are the only accepted artifact names (verified against the pilot tarball and pi-guard `npm pack --dry-run`); the @-form is rejected (tested).
4. **Can artifact metadata select a smoke executable outside the package?** NO. `validateBinPath` (relative, `./`-normalized, no traversal/dot/empty components, strict resolve-inside-package) runs before the staging bin check AND before the smoke against the activated bin; both paths require lstat regular files. Proven by the `../../evil.js` fixture (unit + flow) and replay 3.
5. **Can one explicit component flag silently default another?** NO. Any explicit selection flag requires both; the missing one is named in a deterministic invocation error (test + replay 5). Interactive mode (no flags) retains the approved defaults.
6. **Can a local observed-only digest be distinguished in the receipt from expected-digest verification?** YES. `digestVerified` is true only on an explicit expected-digest match; observed-only digests are `false` and additionally surfaced in result notes; the field is closed-schema validated (missing/wrong-type rejected).
7. **Can root/sudo reach the first installation mutation?** NO. The uid seam refuses (`ERR-PS3-ROOT-REFUSED`) before stateDir creation or any layout/staging/receipt mutation (test asserts no layout dirs exist after refusal; replay 10).
8. **Can `pi-guard-extra` satisfy verification?** NO. Verification is an exact line match on the pinned source path; lookalikes (name substring, other versions, unrelated paths) leave the component `installed-unverified` (test 65 + fixture NO_RECORD mode; replay 7).
9. **Can two different-selection successful attempts leave receipt and component state inconsistent?** NO. The attempt-spanning lock serializes installers (bounded wait then deterministic BUSY), and the receipt records the ACTUAL final component state (unselected-but-installed components are re-verified and recorded; unrecognized existing state fails closed). Both the BUSY and the serialized-after paths were exercised (test 70; replay 9 ×4 runs — receipt entries always matched the packages dir and COMPLETE was reported exactly when both components were present).
10. **Can a pre-existing foreign empty directory be replaced?** NO. Activation reserves the target with `mkdirSync` (O_EXCL semantics); a pre-existing empty dir (or file, or non-empty dir) takes the identity-verify path and is refused when foreign — never replaced (tests 68/69; replay 8). A crash after reservation leaves an empty dir that the next attempt refuses (fail closed, documented).
11. **Can a foreign replacement bin link be deleted by rollback?** NO. Rollback re-reads the link and unlinks only while it still points at the attempt's target; a replaced link is preserved and reported (test 71).

## 3. Focused verification performed (this rereview)

- Full read-through of the corrected modules: `src/installer/archive.ts`
  (scanner, policy, defense-in-depth helpers), `components.ts`
  (scan-before-extract, bin confinement, mkdir-reservation activation,
  exact pi-list verification, pre-existing tracking, actual-state
  inspection), `install.ts` (install-wide lock, root refusal, reordered
  bin link, rollback truthfulness, receipt reconciliation), `receipt.ts`
  (`digestVerified`), `selection.ts` (both-selection rule),
  `preflight.ts` (`checkNotRoot`), `src/persistence/lock.ts` (shared
  lock; writer.ts behavior unchanged), extended static guards.
- `npm test` → **125/125 pass, 0 fail, 0 skip** (99 pre-correction;
  +11 archive, +7 flow, +1 receipt, +1 preflight, +6 guard/fixture
  adjustments — no brittle count pins added).
- `npm run typecheck` clean; `npm ci --dry-run` green;
  `git diff --check` clean.
- Adversarial replays (10 scenarios from the correction gate, run ×4):
  FIFO rejection without hang; traversal rejection before extraction;
  bin traversal refusal; real hyphen artifacts; single-flag invocation
  failure; post-pi failure → PARTIAL ROLLBACK + residual; `pi-guard-extra`
  not verified; foreign empty target preserved; concurrent different
  selections coherent (both BUSY and serialized orderings); root refusal
  before mutation. All passed in every run.
- Read-only external checks: pilot Gateway tarball scanned with the
  production policy; pi-guard `npm pack --dry-run` naming; no real Pi
  state mutated; Gateway/pi-guard repos untouched.
- No PS-0 contract document modified.

## 4. Verdict

Every mandatory rereview question is answered safely. The corrections are
inside the PS-3 envelope (pi-shuttle's own installer, extraction boundary,
receipt, tests, and the narrowly extracted shared lock; no Gateway or
pi-guard change; no network; no new dependencies; no privileged model).
SIR-PS3-012 remains DEFERRED / OPTIONAL HARDENING with bounded direct-child
timeouts preserved.

`PS-3 FOCUSED REREVIEW — ACCEPTED`
