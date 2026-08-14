# PS-8A — v0.1.0 Release Distribution — Independent Senior Review

**Date:** 2026-08-14
**Reviewer role:** independent senior review (no file modifications, no
commit, no push/tag/release/upload performed during this review).
**Scope:** the uncommitted PS-8A release-distribution implementation and
directly affected installer behavior only. No broad Gateway regressions,
no unrelated pi-shuttle suites were rerun.
**Final classification:** `PS-8A SENIOR REVIEW — CORRECTIONS REQUIRED`
(mechanical findings only; all remain within the approved distribution
architecture — no contract escalation required).

---

## 1. Exact review scope (verified from the repository, not the report)

| Check | Result |
|---|---|
| HEAD | `59b092ae9800f65fc1492b8bd7d4138960a0b756` ✓ (matches baseline) |
| origin/master | `b178169a45f6c26758c9bda077c40eba4789d389`; merge-base == origin/master; local master is exactly one commit ahead (the PS-7R docs commit `59b092a`); no divergence ✓ |
| Working tree | exactly 7 modified tracked files + the reported new paths; no unexplained tracked mutations ✓ |
| Gateway pin | `55f764290a4567a20557f1db19d2a6fb97572a97` in `src/compat/manifest.ts` (GATEWAY_PS1_BASELINE_COMMIT) ✓ |
| pi-guard pin | `7a7580cc4cbd7926797564c72269394fc29a860a` @ tag `v0.1.2` (`PI_GUARD_COMMIT` + new `PI_GUARD_TAG = 'v0.1.2'`) ✓ |

### Changed/new path classification

| Path | Classification |
|---|---|
| `src/compat/manifest.ts` (+PI_GUARD_TAG) | release distribution (pin binding) |
| `scripts/build-release.mjs` | release distribution (builder) |
| `scripts/install-release.template.sh` | release distribution (bootstrap) |
| `src/installer/release/{envelope,acquire,bootstrap}.ts` | release distribution (acquisition boundary) |
| `src/installer/install.ts`, `main.ts`, `selection.ts`, `components.ts` | directly affected installer core (release-lane self-activation, shared prompt path, symlink-safe entry guard) |
| `tests/unit/static-guard.test.ts` | tests/static guards (PS-8A carve-outs) |
| `tests/unit/release-{envelope,acquire,bootstrap,core-install}.test.ts` | tests (focused release suites) |
| `README.md` | documentation |
| `docs/reports/pi-shuttle-ps-8a-release-distribution-implementation.md` | documentation/report (implementation report, not modified) |
| `dist-release/v0.1.0/` | generated release assets (untracked by design) |
| `docs/reports/pi-shuttle-ps-6i-reattach-publication-blocked.md`, `.DS_Store` files | pre-existing untracked files (dated 2026-08-13); outside PS-8A scope |

**No unexplained production mutation exists.** Every changed/new path is
PS-8A-attributable.

---

## 2. Bootstrap trust model (highest-priority area)

Verified chain from source (`scripts/install-release.template.sh`,
`scripts/build-release.mjs`, `src/installer/release/*.ts`):

```
version-specific GitHub Release install.sh        (authenticity: HTTPS + GitHub + pinned URL)
  └─ embeds ENVELOPE_SHA256 + PI_SHUTTLE_TGZ_SHA256 (integrity of downloaded bytes)
  └─ shell verifies both digests before extraction/execution
  └─ node release entry: closed-schema envelope + exact compiled-in pins
  └─ per-component acquisition, digest-verified, handed to unchanged core
  └─ activation / receipt-last
```

The critical distinction is handled correctly by the implementation:

- **(A) Trust in `install.sh` itself** is HTTPS + TLS + GitHub + the
  version-specific URL. Nothing in the design claims otherwise in the
  report: §4 of the implementation report states the trust root exactly
  as "pinned URL + HTTPS + embedded digests (no floating `latest`
  endpoint)".
- **(B) Integrity of downloaded assets** is cryptographically bound to
  the embedded digests.

The report does **not** overstate this as end-to-end cryptographic
bootstrap pinning. The only wording defect is in the generated
`install.sh` header comment: *"the SHA-256 digests below … are the trust
root for this installer"* — the digests are the **asset-integrity** root,
not the **authenticity** root of `install.sh` itself (see F-03).

**Determination:** correct and acceptable under the current release
contract. No signing requirement is invented; no contract escalation.
Documentation wording correction only (F-03).

---

## 3. Shell bootstrap security review (`install-release.template.sh`)

Every item of the checklist verified in code:

| Property | Result |
|---|---|
| Shell injection / eval / source | none; no eval, no source; every expansion quoted; args forwarded verbatim as `"$@"`; filenames are embedded constants |
| Argument forwarding | correct; `--help` handled; `--artifact-dir`/`--expect-*` refused with a clear `die` before anything runs |
| Unsafe PATH dependency | node/tar/shasum resolved from PATH — inherent to a bash installer; Node lane version check downstream mitigates; INFO |
| Temp paths | `mktemp -d` (0700, O_EXCL) under `$TMPDIR`; owner-only |
| Symlink behavior | realpath-based direct-execution guard in both installer entries (main.ts and bootstrap.ts) — closes the symlinked-TMPDIR silent no-op |
| Trap/cleanup | `trap 'rm -rf "$WORK"' EXIT`; node runs as the **last command** (no `exec`), so the trap fires after the installer exits and the exit code is preserved |
| Signal/exit-code | EXIT trap fires on normal and signal-induced exits (SIGKILL excepted, inherent); `die` uses exit 2; installer outcomes map 0/1/2 |
| HTTPS enforcement | `curl --proto '=https' --tlsv1.2 --max-redirs 5` (applies to redirects) / `wget --https-only --max-redirect=5` |
| Redirect behavior | bounded at 5 hops; shell redirect targets are digest-gated (any HTTPS host — the embedded digests are the protection) |
| Download truncation | curl fails on partial transfer (exit 18) with `-f`; wget fails likewise; Node layer additionally enforces content-length |
| Digest comparison | exact 64-hex string equality, before any extraction |
| Extraction/execution before verification | never — envelope and package digests verified before `tar -xzf` and before `node` |
| Archive path traversal (shell layer) | bytes are digest-bound to the trusted release before the shell tar runs; core re-scans before its own extraction |
| Temp byte permissions | 0700 dirs, 0600 files (Node `wx` + mode 0600), unverified bytes removed on any failure |
| TOCTOU hash→exec | verified bytes live in owner-only dirs; single-attempt; the core re-hashes/re-scans the same paths |

**Implementation-gate fixes confirmed closed in code:**
1. tar payload 512-padding — fixed in the builder's ustar writer; the
   generated Gateway artifact extracts cleanly and passes the
   installer's own scan (2022 members).
2. dangling bin link — core-side self-activation into
   `packages/pi-shuttle@0.1.0/` (release lane never links into the
   ephemeral extraction).
3. symlinked-TMPDIR direct-execution guard — realpath comparison in
   both entries.
4. shell EXIT-trap cleanup — last-command `node`, trap fires, exit code
   preserved.

One minor shell edge: the QA override `PI_SHUTTLE_BASE_URL` is not
validated in the shell before use; a value beginning with `-` is parsed
by curl/wget as an option (F-07).

---

## 4. Node release acquisition boundary

| Requirement | Result |
|---|---|
| Closed envelope schema | ✓ `closedObject` rejects unknown keys at every level; all values type-checked |
| Duplicate-key handling | ✓ `parseJsonRejectingDuplicates` |
| Unknown-field refusal | ✓ |
| Exact version/source/tag/policy pin matching | ✓ equality against compiled-in constants (version, gateway commit, pi-guard commit+tag, dependency set, lanes, policy facts) |
| Filename grammar / traversal | ✓ `^[A-Za-z0-9][A-Za-z0-9._-]*$` enforced before any path join |
| HTTPS only | ✓ protocol re-parsed and re-validated on **every** hop |
| Redirect allowlist | bounded (5) and host-constrained — but see F-04 (two entries unnecessary) |
| Redirect protocol revalidation | ✓ per hop |
| Content-length / truncation | ✓ byte-count vs header; body `end` required; 1 GiB cap |
| Partial-byte cleanup | ✓ removed on write failure, body failure, truncation, digest mismatch |
| Digest verification before handoff | ✓ `hashFile` vs expected, before returning the path |
| Owner-only storage | ✓ 0700 staging dirs, 0600 `wx` files |
| No generic download facility | ✓ `acquire.ts` is imported only by `bootstrap.ts` (verified by grep); not reachable from any operator command |
| QA override cannot weaken trust | ✓ `PI_SHUTTLE_BASE_URL` is HTTPS-enforced in Node; digests still gate bytes; envelope can never name a host (file names only) |
| Credential logging | ✓ no credentials anywhere; messages print hosts, not query strings (one malformed-URL message could print an operator-supplied QA URL verbatim — trivial) |

Minor resource note: redirect/non-200 response bodies are not consumed
or destroyed before the next hop (socket hygiene) — F-08.

---

## 5. Envelope / manifest separation

The digest cycle is closed by construction, verified from the builder:

- runtime compatibility manifest (`src/compat/manifest.ts`) is frozen
  source embedded in the product; the envelope is a release asset
  carrying distribution facts — they remain distinct;
- envelope carries pi-shuttle + Gateway + pi-guard digests; the
  envelope's own digest is embedded in `install.sh`;
- `SHA256SUMS` is written **last** and covers `install.sh` itself;
- nothing stores its own digest inside its own bytes; the builder never
  rewrites the runtime manifest; no hidden self-reference through
  generated package bytes or compiled manifest values.

The runtime manifest is **not** misrepresented as the distribution
trust root anywhere in the docs.

---

## 6. Component provenance (builder fail-closed behavior)

- Gateway: exact commit equality (`git rev-parse HEAD` == pin), clean
  tracked tree; commit pin only (tag n/a — matches the approved pin
  contract).
- pi-guard: exact commit equality **and** a real tag assertion —
  `git describe --tags --exact-match <commit>` must equal `v0.1.2`
  (not merely commit equality).
- No floating resolution, no `latest`, no semver ranges anywhere;
  lockfiles are the exact pinned-checkout lockfiles (`npm ci` in a
  clean `git clone --no-local`).
- Source checkouts are not git-mutated: the Gateway checkout is only
  read (clone + rev-parse + status); `npm ci`/`npm run build` run in
  the clone. pi-guard is packed in place read-only w.r.t. git.
- **Gap:** the builder never verifies the component `package.json`
  identity (name/version) against the envelope pins at build time; a
  drifted version would produce a candidate whose installs always fail
  (fail-closed only at install time, in the unchanged core) — F-02.

---

## 7. Gateway dependency materialization

Verified against the generated artifact (extracted and inspected):

- Materialized tree is exactly the production closure from the exact
  lockfile (`npm ci --omit=dev --ignore-scripts`): `@modelcontextprotocol/server@2.0.0`
  (+ `@modelcontextprotocol/core`), `ajv@8.20.0` (+ fast-deep-equal,
  fast-uri, json-schema-traverse, require-from-string), `zod@4.4.3` —
  nothing else (the `@types/`/`@typescript/` scope dirs are **empty**).
- No unexpected mutable execution hooks: the installer never runs npm
  on the materialized tree (extract + `node cli --help` smoke only);
  the Gateway's only subprocess use is `execFile` on git (its own
  approved architecture, unchanged).
- `.bin` and `.package-lock.json` stripping is runtime-safe: no
  `node_modules/.bin` reference exists anywhere in `package/dist`
  (grep-verified; matches were `.bindDescriptor` false positives).
- Archive is structurally clean: 1859 regular files + 163 directories
  only — no symlinks, no special files, no setuid, all 0644/0755;
  passes the installer's own scan (2022 members).
- Deterministic retar is structurally correct: ustar, sorted members,
  mtime 0, gzip level 9, checksums verified by both system tar and the
  installer scanner.
- Runtime expectations satisfied: identity `@project-gateway/artifact-core@0.1.0`,
  `bin: {"project-gateway-mcp": "./dist/runtime/mcp/cli.js"}`,
  `node dist/runtime/mcp/cli.js --help` exits 0 against the
  materialized artifact (the `installed-verified` bar).
- Licenses preserved: LICENSE texts ship inside every bundled package
  (ajv, zod, fast-deep-equal, fast-uri [BSD-3-Clause], json-schema-
  traverse, require-from-string [`license` file],
  @modelcontextprotocol/server, @modelcontextprotocol/core) plus
  package-level LICENSE — see §12.

---

## 8. Installer-core changes (directly affected paths)

- **Self-activation**: scan → extract → `findPackageRoot`/identity →
  bin confinement (`validateBinPath`) → atomic no-clobber activation
  into `packages/pi-shuttle@0.1.0/` → rollback-tracked; identical
  discipline to the component paths (SIR-PS3-001/003/010).
- **Persistent bin target**: `binLinkTarget = packages/pi-shuttle@0.1.0/<bin>`
  in release mode (never the ephemeral extraction); local lane
  unchanged (`ownCliPath()`).
- **Activation ordering**: release package → gateway → bin link →
  pi-guard → receipt; rollback on any later failure removes the
  attempt-created shuttle package (rollback candidate, `preExisting`
  recorded).
- **Prior healthy installation preservation**: rerun hits the
  idempotent-verify path (existing identity must match exactly;
  `created:false`), and the bin-link foreign-entry check is
  target-string equality → rerun no-op, foreign links refused.
- **Receipt-last**: unchanged; receipt written only for finalized
  states; rollback truthfulness unchanged (SIR-PS3-002 pi-state note
  preserved).
- **Release vs local lane separation**: shell refuses
  `--artifact-dir`/`--expect-*` in release mode; but the Node entry
  parses-and-silently-drops them (F-05).
- **Interactive behavior equivalence**: shared `promptInteractive`
  (readline moved to selection.ts); behavior identical when stdin is a
  terminal — but see F-01 for the documented `curl | bash` shape.
- **Root/sudo refusal unchanged** (core `checkNotRoot` + shell
  `id -u`); **candidate Pi compatibility unchanged** (preflight
  untouched; only the `needsTar` widening is new).
- pi-shuttle self-activation does **not** make pi-shuttle a third
  authority-bearing component: identity is digest- and pin-bound, the
  receipt records no new authority facts (same `piShuttleVersion`
  field), trusted-store semantics untouched.

---

## 9. Static-guard carve-outs

- Network exemption: exactly one file
  (`src/installer/release/acquire.ts`); the guard additionally asserts
  that file uses `node:https` and never `node:http`; all other files
  still fail on any network vocabulary.
- `process.env` exemption: exactly `bootstrap.ts` (its own
  direct-execution CLI boundary, symmetric with the pi-guard
  compatibility probe precedent).
- fs allowlists: exact per-module lists for acquire.ts, bootstrap.ts,
  main.ts; the enforcement test fails any fs import outside the
  allowlist and any fs-importing module not listed — new code cannot
  gain fs access silently.
- The exemptions are semantic (a named module is the boundary) rather
  than vocabulary suppression; every architectural invariant remains
  asserted for all other modules. **No broad exemption found.**

---

## 10. Generated release assets (recomputed, not trusted from the report)

`dist-release/v0.1.0/` contains exactly the 6 expected files; no
`.git`, no source-repository debris, no HOME/user state, no credentials
(grep-verified across text assets), no logs.

| Asset | Size | SHA-256 (recomputed) |
|---|---|---|
| install.sh | 4698 | `a45cea43d83a11e04b2e53d90327783365564b6c47d00abba3b13674eefb097b` |
| pi-shuttle-0.1.0.json | 1302 | `7943bd0462f92c06b02c59e4305feeba4ad9ae53d51a8d7e5ab13673e6804815` |
| pi-shuttle-0.1.0.tgz | 90766 | `869e34167419b4c13bf5e28525e83803f1b83f779cf401a754397f4dcb942650` |
| project-gateway-artifact-core-0.1.0.tgz | 3551096 | `ab765e043ce2892788fb0d9282e57e143ae99c12ab50328363add8459baacde9` |
| pi-guard-0.1.2.tgz | 24785 | `057f1b636328e8c77857a4b590d051fcc52c0c9b015ca5dd1a773c21d7d24d01` |

- `SHA256SUMS` matches the actual bytes exactly (verified by
  recomputation of every asset).
- `install.sh` embedded digests == recomputed envelope/package digests;
  generated install.sh == template after substitution (diff-verified);
  `bash -n` clean.
- Envelope pins == manifest pins (version, commits, tag, dependency
  set, lanes, policy).
- All three tgz artifacts pass the installer's own archive scan
  (66 / 2022 / 12 members); packaged pi-shuttle CLI runs (`--version`,
  `--help` exit 0); packaged dist == working-tree dist byte-for-byte;
  Gateway identity + materialized closure + smoke verified (§7);
  pi-guard identity `pi-guard@0.1.2` MIT.
- The implementation report's §5 table lists a stale install.sh row
  (4550 B / `c267cb01…` vs the actual 4698 B / `a45cea43…`); the other
  four rows match — F-06. The builder could not be re-executed on this
  host (the pinned git checkouts are absent — only zip extracts exist);
  the candidate was therefore validated directly (F-11).

---

## 11. Focused verification run

| Suite | Result |
|---|---|
| release-envelope / release-acquire / release-bootstrap / release-core-install | 48 pass / 0 fail |
| static-guard | 10 pass / 0 fail |
| installer-flow + installer-preflight (directly affected core) | 40 pass / 0 fail |
| `git diff --check` | clean |
| `bash -n` on generated install.sh | clean |
| Builder execution | not possible (pinned component git checkouts absent on this host) — see F-11 |

The full 273-test suite was **not** rerun (out of scope per the review
brief). No missing invariant was found that requires a new test beyond
the corrections specified in the findings (F-02, F-05).

---

## 12. Licensing and notices (reported separately from code correctness)

Confirmed state:

- pi-shuttle `package.json`: `private: true`, `license: UNLICENSED`;
  no root LICENSE file exists; no human-approved license decision in
  repository evidence.
- Gateway: `MIT` (package.json); pi-guard: `MIT` (package.json).
- Bundled dependency licenses are identifiable and **preserved inside
  the generated Gateway artifact** (per-package LICENSE texts ship in
  the tar; see §7), which satisfies the MIT/BSD-3-Clause
  redistribution obligations for the artifact itself. A consolidated
  `THIRD-PARTY-NOTICES` is therefore **not strictly required** for the
  generated artifact; it is optional polish and should be folded into
  the license decision.

**`V0.1.0 LICENSE DECISION REQUIRED`** remains a release blocker for
**public distribution** only — it is not an implementation defect;
nothing in the release code falsely claims a license.

---

## 13. Documentation accuracy

- README does **not** claim the v0.1.0 release exists, the installer
  URL is live, GitHub Release assets are hosted, or that a live
  ChatGPT E2E passed. The version-specific URL shape is documented with
  an explicit **"This URL is not live yet"** marker — acceptable.
- The implementation report accurately distinguishes the local QA HTTPS
  smoke (§12) from the future official publication (§14).
- The report's §7 claim that the release installer "provides the same
  interactive experience" is inaccurate under the documented
  `curl … | bash` invocation (F-01).

---

## 14. Findings

### F-01 — MODERATE — silent interactive defaults under `curl | bash`
- **Path:** `scripts/install-release.template.sh`, README "Official
  release", implementation report §7.
- **Invariant/risk:** the documented invocation
  `curl -fsSL <url> | bash` gives the installer a stdin pipe at EOF;
  `promptInteractive`'s `ask()` therefore returns the default on every
  prompt (`next.done ? '' : …`), so "interactive" mode installs
  Gateway + pi-guard into default directories with **no prompts shown
  and no confirmation** — the claimed "same interactive experience"
  does not hold in the primary documented path.
- **Evidence:** usage text in the generated install.sh; `promptInteractive`
  in `src/installer/selection.ts`; report §7 claim; the README
  one-liner shape.
- **Required correction (mechanical):** document that a piped
  invocation applies the interactive defaults without prompting and
  recommend `--batch` with explicit selections (or `bash <(curl …)`)
  for non-default choices; optionally have the shell/Node open
  `/dev/tty` for prompts when stdin is not a TTY.
- **Contract escalation:** no — interactive defaults (yes/yes) are the
  already-approved contract defaults; only the presentation/UX promise
  is corrected.

### F-02 — MODERATE — builder does not verify component package identity at build time
- **Path:** `scripts/build-release.mjs`.
- **Invariant/risk:** the review brief requires the builder to check
  Gateway/pi-guard package identity/version. The builder verifies
  commit, tag (pi-guard), and tracked cleanliness, but never reads the
  component `package.json`; a version drift at the pinned commit would
  still produce a release candidate whose every install fails
  (fail-closed only downstream, in the unchanged core's identity
  check).
- **Evidence:** `verifyCheckout` performs no `package.json` read; the
  envelope's `packageVersion` fields are taken from the pi-shuttle
  manifest without cross-checking the packed artifacts.
- **Required correction:** after packing, read each artifact's identity
  (`name`/`version`) and assert equality with the envelope pins before
  writing `SHA256SUMS`; add one builder assertion test.
- **Contract escalation:** no.

### F-03 — MINOR — "trust root" wording in the generated install.sh header
- **Path:** `scripts/install-release.template.sh` (header comment).
- **Invariant/risk:** the comment "the SHA-256 digests … are the trust
  root for this installer" is imprecise: the digests are the
  asset-*integrity* root; the *authenticity* root of install.sh itself
  is the version-pinned HTTPS URL + GitHub/TLS. The implementation
  report states this correctly; the shipped artifact wording should
  match.
- **Required correction:** reword the comment to distinguish
  bootstrap authenticity (HTTPS + pinned URL) from downloaded-asset
  integrity (embedded digests).
- **Contract escalation:** no.

### F-04 — MINOR — unnecessary redirect-allowlist entries
- **Path:** `src/installer/release/acquire.ts`.
- **Invariant/risk:** the allowlist is the trust-expansion surface of
  the acquisition client. The current asset flow (release download
  URLs) redirects only to `release-assets.githubusercontent.com` /
  `objects.githubusercontent.com`; `codeload.github.com` (archive
  downloads) and `www.github.com` are not reachable by any current
  request. Not exploitable (digests still gate bytes), but unnecessary
  trust expansion per the review brief.
- **Required correction:** remove `codeload.github.com` and
  `www.github.com` (and update the allowlist test), or document the
  future flow that justifies each entry.
- **Contract escalation:** no.

### F-05 — MINOR — Node release entry silently ignores `--artifact-dir`/`--expect-*`
- **Path:** `src/installer/release/bootstrap.ts`.
- **Invariant/risk:** the shell refuses these flags, but the Node entry
  parses them and silently drops them (they are not forwarded). The
  report claims they "are refused in release mode" — true only at the
  shell layer; the QA/direct-invocation path would accept them with no
  effect and no notice. No security impact (nothing is weakened), but
  the release entry should be fail-closed like the shell.
- **Required correction:** in `runReleaseBootstrap`, refuse when
  `parsed.options.artifactDir` or either `expect*` is set; extend the
  argument-forwarding test.
- **Contract escalation:** no.

### F-06 — MINOR — implementation report §5 install.sh row is stale
- **Path:** `docs/reports/pi-shuttle-ps-8a-release-distribution-implementation.md`.
- **Invariant/risk:** the report's inventory lists install.sh as 4550 B
  / `c267cb01…`; the current candidate is 4698 B / `a45cea43…` (all
  other four rows match). The "byte-identical SHA256SUMS" claim cannot
  be reconciled with the published table for install.sh, and §10 of
  this review shows the current candidate is internally consistent —
  the table predates the final template.
- **Required correction:** refresh the table (or annotate that the
  final build superseded it) when the implementation gate is finalized.
- **Contract escalation:** no.

### F-07 — MINOR — `PI_SHUTTLE_BASE_URL` option-injection edge in the shell
- **Path:** `scripts/install-release.template.sh`.
- **Invariant/risk:** the override is passed as the first argument to
  curl/wget; a value beginning with `-` (e.g. `-K <file>`) is parsed as
  a tool option, not a URL. Operator-controlled environment only
  (never attacker-controlled, never from untrusted content) and the
  embedded digests still gate which bytes are accepted — so the worst
  case is a confused/failed install, not an integrity break.
- **Required correction:** one shell guard: refuse the override unless
  it starts with `https://` (the Node layer already validates
  protocol).
- **Contract escalation:** no.

### F-08 — MINOR — unconsumed redirect/error response bodies
- **Path:** `src/installer/release/acquire.ts`.
- **Invariant/risk:** on redirects and non-200 statuses the response
  body is neither consumed nor destroyed; sockets linger in the agent
  pool until the server closes them. Bounded (≤ 5 hops, 60 s timeout),
  no correctness impact.
- **Required correction:** `response.resume()`/`destroy()` on
  non-200 paths (one line).
- **Contract escalation:** no.

### F-09 — INFO — empty scope dirs in the Gateway artifact
- **Path:** `project-gateway-artifact-core-0.1.0.tgz`
  (`package/node_modules/@types/`, `@typescript/`).
- Empty directories carried from the npm install tree; harmless to the
  scanner and runtime; cosmetic.
- **Required correction:** none (optional prune in the builder).

### F-10 — INFO — pi-guard is packed in place; untracked files tolerated
- **Path:** `scripts/build-release.mjs` (verifyCheckout filters
  untracked; pi-guard pack runs in the checkout).
- Untracked files in the pi-guard checkout could theoretically match
  its npm pack include rules and ship; for the Gateway this is
  impossible (clean clone). Build-time identity check (F-02) plus the
  install-time scan bound the impact.
- **Required correction:** none required; optionally pack pi-guard from
  a clean clone too.

### F-11 — INFO — builder not re-executable on this host
- The pinned component git checkouts are absent (only zip extracts at
  `/Users/serene/Documents/project-gateway`, `/Users/serene/Documents/pi-guard`);
  the builder's own fail-closed pin checks make a re-run impossible
  here. The candidate was validated directly instead (§10) — digest,
  identity, scan, smoke, and template-equality all verified.

### F-12 — INFO — consolidated third-party notices optional
- Per-package LICENSE texts ship inside the Gateway artifact,
  satisfying MIT/BSD-3-Clause redistribution obligations; a
  consolidated `THIRD-PARTY-NOTICES` is optional and belongs to the
  license decision gate (§12).

### F-13 — INFO — pi-shuttle candidate tree is not self-anchored by the builder
- The builder does not assert pi-shuttle HEAD/cleanliness (it builds
  from the working tree by design — PS-8A is uncommitted). The release
  authority for the pi-shuttle tree is the human review of the
  candidate; component pins remain externally anchored.

---

## 15. Final verdict

**`PS-8A SENIOR REVIEW — CORRECTIONS REQUIRED`**

No CRITICAL or MAJOR security defect exists. The bootstrap trust model
is correctly scoped (F-03 is wording only), the shell and Node
acquisition boundaries fail closed on every reviewed property, the
four implementation-gate fixes are genuinely closed in code, the
digest chain is acyclic, the Gateway materialization is exact and
runtime-safe, installer-core semantics are preserved, static-guard
carve-outs are minimal, and the generated candidate is internally
consistent (digests, pins, scans, smokes).

All correction-required findings (F-01…F-08) are mechanical
(documentation accuracy, builder/entry validation completeness,
allowlist hygiene, resource handling) and remain within the approved
distribution architecture. **No contract escalation is required.**

Standing gates recorded for the publication step (not implementation
defects): `V0.1.0 LICENSE DECISION REQUIRED` (public distribution
blocker, §12) and the separate human-authorized publication gate
(hosting, tag/release creation, making the version-specific URL live).

No files were modified, nothing was committed, and no push/tag/
release/upload was performed during this review.

---

# PS-8A — Focused Correction & Rereview (2026-08-14)

Correction pass applied after the original review; findings F-01..F-08
above remain on record unchanged. This section records resolution and
rereview conclusions only. No push/tag/release/upload/publication
occurred; no component repository was modified; the license decision
remains open (`V0.1.0 LICENSE DECISION REQUIRED`).

## Correction disposition

| Finding | Resolution | Verification |
|---|---|---|
| F-01 (piped EOF → silent defaults) | release install.sh binds the installer stdin to the controlling terminal (`</dev/tty`, probed with `exec 3<>/dev/tty`) when interactive prompts are needed and stdin is not a TTY; with no usable terminal it refuses with guidance. Node release entry additionally refuses interactive prompting on non-TTY stdin (`ERR-REL-INTERACTIVE-TTY`). EOF can never become affirmative answers. | `release-shell-input.test.ts` (6 pass + 1 conditional skip: piped refusal via setsid session, batch piped acceptance, both-selections bypass, --help under pipe, tty-binding path, adversarial/valid QA override); `release-bootstrap.test.ts` non-TTY refusal + batch acceptance + injected-prompt preservation. Local interactive execution unchanged (shared promptInteractive; existing installer-flow suites green). |
| F-02 (no build-time identity check) | builder now reads each packed artifact's `package/package.json` and fails closed unless pi-shuttle `pi-shuttle@0.1.0`, gateway `@project-gateway/artifact-core@0.1.0`, pi-guard `pi-guard@0.1.2`; missing/malformed metadata fails closed. Install-time checks unchanged. | `release-builder-identity.test.ts` (6 tests); final builder run printed all three identity verifications. |
| F-03 (trust wording) | install.sh header and implementation report §4 now state: install.sh authenticity = HTTPS/TLS + GitHub + version-specific URL; embedded digests = integrity root for downloaded assets, NOT authentication of install.sh. No signing mechanism invented. | Wording diff in `scripts/install-release.template.sh` + report §4. |
| F-04 (allowlist minimization) | allowlist reduced to `github.com` + `release-assets.githubusercontent.com`; `www.github.com`, `objects.githubusercontent.com`, `codeload.github.com` removed (observed-necessity basis: release downloads redirect only to release-assets.githubusercontent.com; archive flow unused). Redirect bound (5) and non-HTTPS refusal preserved. | `release-acquire.test.ts` (allowed accepted, removed hosts refused, F-08 disposal); empirical redirect observations recorded in the review session. |
| F-05 (local-only flags silently ignored) | release Node entry refuses `--artifact-dir`/`--expect-gateway-sha256`/`--expect-pi-guard-sha256` with `ERR-REL-ARGS`; developer entry unchanged. | 3 negative tests in `release-bootstrap.test.ts`; shell-layer refusal unchanged. |
| F-06 (stale digest evidence) | candidate rebuilt from exact clean checkouts (fresh clones of the authoritative repos at the pins; builder re-verified commit/tag/clean/identity). Report §5 holds FINAL values; every digest re-verified against actual bytes (SHA256SUMS + embedded digests). | see §"Final release-asset inventory" below. |
| F-07 (QA override option injection) | shell validates `PI_SHUTTLE_BASE_URL` as `https://` before use (refuses `--version`, `-K <file>`, `http://…` with exit 2 before any downloader runs); curl receives the URL via `--url` data operand. QA-only seam preserved. | adversarial + valid-override tests in `release-shell-input.test.ts`. |
| F-08 (redirect body lifecycle) | `downloadToFile` destroys the previous response body on redirect and on error responses before continuing/returning. | body-disposal test in `release-acquire.test.ts` (redirect hop + error response). |
| F-11 (INFO) | no correction manufactured; the builder was re-executed in this pass from fresh exact checkouts. | builder run log (§10.5 of the implementation report). |

## Rereview conclusions (F-01..F-08 + directly affected invariants)

- no EOF-driven silent interactive defaults — confirmed (shell fail-closed
  + terminal binding; node `ERR-REL-INTERACTIVE-TTY`; batch path accepted);
- build-time package identity verification exists and failed-closed during
  the final build for all three packages — confirmed;
- bootstrap trust wording is exact (authenticity vs integrity) — confirmed;
- redirect allowlist is minimal and observed-necessity-based — confirmed;
- release-only/local-only CLI surfaces are separated (refused, never
  ignored) — confirmed;
- final report digests equal actual generated bytes — confirmed (SHA256SUMS
  vs every asset; embedded digests vs envelope/package);
- QA override cannot become downloader options — confirmed (https://
  validation + `--url` operand; adversarial values refused before any
  download);
- redirect bodies are disposed correctly — confirmed (tested).
- Component pins unchanged (`55f764290a4567a20557f1db19d2a6fb97572a97`,
  `7a7580cc4cbd7926797564c72269394fc29a860a` @ `v0.1.2`); authority/security
  semantics unchanged; `private: true` unchanged; license remains
  unresolved and was not silently chosen; no push/tag/release/upload/
  publication occurred.

## Final release-asset inventory (corrected candidate, recomputed)

| Asset | Size | SHA-256 |
|---|---|---|
| install.sh | 6980 | `b2e6f2137fb707edb8e62973af7539ff841a866a50e2f2147854973fe71e7a6e` |
| pi-shuttle-0.1.0.json | 1302 | `de27dd310eb23618b93ee9e555aa014befa04f5fbe4725b24161f06bb7c94602` |
| pi-shuttle-0.1.0.tgz | 92043 | `fe504f2048cba8826220bb09ba15cd7888fc0619898238894373ab562877a42e` |
| project-gateway-artifact-core-0.1.0.tgz | 3551096 | `ab765e043ce2892788fb0d9282e57e143ae99c12ab50328363add8459baacde9` |
| pi-guard-0.1.2.tgz | 24785 | `057f1b636328e8c77857a4b590d051fcc52c0c9b015ca5dd1a773c21d7d24d01` |

Verified: SHA256SUMS matches every asset; embedded install.sh digests
match the envelope and pi-shuttle package; envelope digests and pins
match (package versions, gateway commit, pi-guard commit + tag); exact
6-file inventory; no secrets, no `.git`, no HOME/project data, no
unexpected files. Local HTTPS smoke (QA base URL, TLS on): batch
gateway-only install → truthful PARTIAL (exit 1), gateway
installed-verified, `digestVerified: true`, artifact SHA == envelope,
persistent bin link, idempotent rerun, temp cleanup, installed
`pi-shuttle --version` works. This is local QA only — no public GitHub
Release installation exists or is claimed.

## Focused test totals (correction pass)

- release-envelope 18 pass; release-acquire 12; release-bootstrap 18;
  release-shell-input 6 pass + 1 conditional skip; release-builder-
  identity 6; release-core-install 5 → **65 pass / 0 fail / 1 skip**.
- static-guard 10 pass; installer-flow + installer-preflight 40 pass.
- `git diff --check` clean; one full builder execution from exact clean
  checkouts (all pins + identities re-verified in-build).

## Rereview verdict

`PS-8A FOCUSED REREVIEW` — zero CRITICAL / zero MAJOR / zero MODERATE /
zero correction-required MINOR findings remain across F-01..F-08 and the
directly affected release invariants. The gate therefore proceeded to the
local baseline commit per gate instructions (§15): ONE local commit,
generated `dist-release/` excluded.

Remaining release blockers (unchanged, separate):
- `V0.1.0 LICENSE DECISION REQUIRED` (public distribution);
- PS-8B / final release-readiness evidence (publication gate, hosting,
  tag/release creation, making the version-specific URL live).

v0.1.0 is NOT released.
