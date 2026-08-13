# pi-shuttle PS-6R — runtime compatibility simplification senior review

Gate: `PS-6R — RUNTIME COMPATIBILITY SIMPLIFICATION SENIOR REVIEW`
(READ-ONLY review gate; no production code, test, contract, or pi-guard
modification; nothing staged/committed/pushed/tagged/published).

Reviewer-verified baselines (re-fetched during this gate):

| Repo | Local HEAD | Remote | Expected | Match |
|---|---|---|---|---|
| pi-shuttle | `2076575efb7e8d9d7aeaff8f4bfafb7df3e965e8` | `origin` HEAD + `refs/heads/master` == same SHA | `2076575efb7e8d9d7aeaff8f4bfafb7df3e965e8` | ✅ |
| Project_Gateway_MCP | `98d1b204a864596bda91bec1104b8a8d5e89e1cd` | `origin/main` == same SHA (`mfx-labs/project-gateway`) | `98d1b204a864596bda91bec1104b8a8d5e89e1cd` | ✅ |
| plan_spec_guard | `7a7580cc4cbd7926797564c72269394fc29a860a` = `v0.1.2` | `origin` HEAD == same SHA | `7a7580cc4cbd7926797564c72269394fc29a860a` / `v0.1.2` | ✅ |

pi-guard: tracked tree clean (`git diff HEAD` empty). The 8 untracked
files are pre-existing v0.1.1-era review/release docs (mtime Aug 3,
before this gate) — not PS-6R artifacts.

---

## 1. Baseline / scope integrity

### pi-shuttle uncommitted diff (18 paths)

Compatibility core:
- `src/compat/versions.ts` (new) — shared strict version parser/comparator;
- `src/compat/manifest.ts` — `*_RUNTIME_MINIMUM` constants added; exact
  baseline constants retained with baseline/requirement separation comment;
- `src/compat/pi-guard-probe.ts` (new) — committed pi-guard compatibility
  probe (module + CLI).

Installer integration:
- `src/installer/preflight.ts` — `classifyNodeRuntime`,
  `classifyPiVersion` (candidate/malformed lanes), `applyPiPolicy`,
  `PI_RUNTIME_POLICY`;
- `src/installer/components.ts` — probe hook before any `pi install`
  mutation;
- `src/installer/install.ts` — candidate loader resolution + probe
  plumbing + receipt note.

Doctor/runtime integration:
- `src/command/doctor.ts` — node/git/pi rows reclassified; injectable
  probe seam + default probe spawner.

Pi compatibility probe:
- `scripts/pi-extension-load-probe.mjs` — thin CI delegate to the
  compiled probe (single source of truth).

Test/evidence:
- `tests/unit/runtime-compat.test.ts` (new);
- `tests/unit/doctor.test.ts`, `tests/unit/installer-flow.test.ts`,
  `tests/unit/installer-preflight.test.ts`,
  `tests/unit/static-guard.test.ts` (updated).

Approved contract documentation:
- `docs/installation-contract.md`, `docs/operator-cli-contract.md`,
  `docs/platform-support-contract.md` (reviewed in §9).

Implementation report:
- `docs/reports/pi-shuttle-ps-6r-runtime-compatibility-implementation-report.md`;
- `docs/reports/pi-shuttle-ps-6r-runtime-compatibility-readiness-analysis.md`.

Nothing outside PS-6R scope: no workflow, identity, store, MCP, POUV2,
APFS-guard, remove-semantics, or authority-path changes.

### Gateway uncommitted diff (8 paths)

- `src/git/host-lane.ts` — the ONLY production change: version gate
  `includes('2.45.4')` → `parseGitVersion` + `satisfiesGitMinimum`
  (`>= 2.30.0`); descriptor `version` records the detected triple.
- `tests/wp7/git/git.test.ts` — 3 added PS-6R version-policy tests.
- Pre-existing WP-13D debris preserved separately and untouched:
  `src/retrospective/`, `tests/unit/wp13d-*.test.ts`,
  `docs/reports/wp-13d-retrospective-facts-and-closure-implementation-report.md`,
  `docs/reports/project-gateway-public-history-and-license-focused-rereview.md`,
  `docs/reports/project-gateway-github-publication-record.md`
  (mtime Aug 11/13, pre-gate).

---

## 2. Human-approved policy fidelity

| Dimension | Approved | Implemented | Fidelity |
|---|---|---|---|
| Node minimum | `>=22.19.0` | `NODE_RUNTIME_MINIMUM = '22.19.0'`, one shared classifier | ✅ |
| Node 22.23.2 | CI baseline only | reporting strings only; no equality gate anywhere in `src` (grep-verified) | ✅ |
| darwin-arm64 | native arm64 required | doctor arch assertion applies to ANY version-compatible node; Rosetta/x64 → `unsupported` | ✅ |
| Git minimum | `>=2.30.0` | `GIT_RUNTIME_MINIMUM = '2.30.0'` (pi-shuttle doctor); Gateway `GIT_MINIMUM_VERSION = '2.30.0'` | ✅ |
| Git 2.45.4 | CI baseline only | reporting only in pi-shuttle; Gateway descriptor records detected version | ✅ |
| Git executable safety | unchanged | fingerprint/owner/mode/env/preflight invariants byte-identical (see §7) | ✅ |
| Pi minimum | `>=0.83.0` candidate | `PI_RUNTIME_MINIMUM = '0.83.0'` | ✅ |
| Pi 0.83.0 | known-good | `supported` lane, probe never needed | ✅ |
| Other candidates | committed probe PASS required | install + doctor both gate on probe PASS | ✅ |
| TrustedHostLane | `*-node22` frozen | strings byte-identical both repos; mapping pure platform+arch | ✅ |

No additional compatibility policy was introduced (no blanket future-Pi
acceptance, no automatic future-Node acceptance, no lane redefinition,
no OS/arch matrix change, no executable-safety weakening).

---

## 3. Shared version parser — `src/compat/versions.ts`

Strict grammar `/^(\d+)\.(\d+)\.(\d+)$/` after `trim()`; all-numeric;
no prerelease/build suffixes; no `v` prefix; partial triples rejected.
Comparisons are component-wise numeric (`compareVersionTriples`) — no
lexicographic comparison, correct across major boundaries
(independent checks: `23.0.0` ≥ `22.19.0`; `9.9.9` < `10.0.0`;
`3.0.0` > `2.99.99`). Malformed input and malformed minimum constants
fail closed (`classifyAgainstMinimum` returns `malformed`).

Independent boundary matrix (run against the compiled module): rejects
`v22.23.2`, `22`, `22.19`, `22.19.0.1`, `22.19.0-rc.1`, `22.19.0+build`,
`22.19.x`, `0x10.1.1`, `1e2.1.1`, `22..0`, `+22.19.0`, `--22.19.0`,
embedded newline, empty, whitespace-only, non-ASCII digits. Accepts
`0.0.0` … `999.999.999`. Whitespace trimming is deliberate and documented
(unit suite pins it). Very large digit strings parse to a float
(`1e20`) — comparison stays total and consistent; no NaN, no crash; no
real version approaches 2^53. Not a finding.

**Version-source boundary extraction (callers):**

| Source | Extraction | Verdict |
|---|---|---|
| Node (install/add/start) | `process.version.replace(/^v/,'')` → strict parse | ✅ `v22.23.2` → `22.23.2` |
| Node (doctor) | `node --version` stdout: `trim().replace(/^v/,'')` | ✅ |
| Git (doctor) | `/^git version (\S+)/` — first token only; vendor text `(Apple Git-145)` excluded | ✅ |
| Git (Gateway) | `/^git version (\d+)\.(\d+)\.(\d+)/` — prefix-anchored, trailing text ignored | ⚠️ see SIR-PS6R-007 |
| Pi (doctor/installer) | first whitespace token of `pi --version` (real output verified: `0.84.1`) | ✅ |

No silent grammar broadening on the pi-shuttle side; the Gateway's
prefix grammar is justified by real vendor output forms
(`git version 2.39.3 (Apple Git-145)`) but also admits 4-part
versions (`2.45.4.windows.1`) — see finding.

---

## 4. Node policy

Former exact-equality gates removed from all runtime behavior.
Verified against the compiled product:

| Case | Install | Add | Start | Doctor |
|---|---|---|---|---|
| 22.18.x | refuse | refuse | refuse | `unsupported` (exit 2) |
| 22.19.0 | accept | accept | accept | `supported` |
| 22.23.2 | accept (baseline reported) | same | same | `supported` + baseline fact |
| newer 22.x | accept | accept | accept | `supported` |
| newer major (24/25/…) | accept (semver-valid) | same | same | `supported` |
| malformed/unreadable | refuse | refuse | refuse | `installed but unverified` (exit 1) |
| darwin-arm64 Rosetta/x64 | n/a (no arch gate at install — pre-existing contract §3.9 pins arch enforcement to doctor/CI) | n/a | n/a | `unsupported` |

The four boundaries share ONE classifier (`checkNodeLane` /
`classifyNodeRuntime`); call sites in `install.ts:166`, `projects.ts:241`,
`start.ts:50` are unchanged in shape. No hidden `=== 22.23.2` /
`!== 22.23.2` runtime equality remains in `src` (grep + structural
regression test). CI exact pins are exempt and untouched.

---

## 5. Frozen TrustedHostLane

Byte-for-byte unchanged in both repos:
`linux-x86_64-posix-utf8-node22`, `darwin-arm64-posix-utf8-node22`
(pi-shuttle `src/host/environment.ts:106-107`; Gateway
`src/trusted/host-lane.ts:25-26`).

- No Node version observation feeds `hostLane()` (pure platform+arch
  mapping; regression test asserts no `process.version` /
  `NODE_LANE_VERSION` reference in the mapping).
- No node24/node25 lane exists or is generated.
- Configuration identity projection (`src/trusted/identity.ts`,
  Gateway) untouched — the Gateway diff does not touch `trusted/`,
  `pointofuse-v2/`, or any store path. POUV2/conformance/identity
  suites unaffected at source level (implementation-reported
  232/0, 17/0, 576/0; not rerun per gate §19 — no affected paths).
- No store migration semantics introduced.

**Explicit answer:** a compatible Node 24 runtime on darwin-arm64
resolves to the same existing trusted lane identifier
(`darwin-arm64-posix-utf8-node22`) with unchanged configuration
identity — YES.

---

## 6. Git compatibility — pi-shuttle doctor

- `>= 2.30.0` → `supported` (detail reports actual version + minimum +
  validated baseline); `2.29.x` → `unsupported`; malformed version
  output → `installed but unverified`; missing git → `missing`
  (unchanged). Verified: `2.29.9` reject, `2.30.0` accept, `2.45.4`
  accept, `2.50.1` accept, `git version 2.39.3 (Apple Git-145)` parses
  (first-token extraction).
- No exact-2.45.4 runtime gate remains in pi-shuttle (grep-verified;
  `2.45.4` appears only in reporting strings/tests).
- Presence + read-only `rev-parse --git-dir` capability probe
  (project add) unchanged; install/start never gated git version
  (pre-existing; Gateway is the runtime authority).

---

## 7. Git compatibility — Gateway security boundary (HIGH PRIORITY)

Full read of `src/git/host-lane.ts`: the ONLY relaxation is the version
predicate (exact `includes('2.45.4')` → strict triple parse + minimum
`>= 2.30.0`). Independently verified unchanged:

- canonical absolute-path validation (no `//`, `/./`, `/../`); ✅
- owner rule (root or effective uid); ✅
- mode rule (no group/world-writable; executable bit); ✅
- dev/ino/mode/size/mtime/SHA-256 fingerprint captured at init; ✅
- point-of-use revalidation (`revalidateGitHostLane`) before every
  launch (git/service.ts:219, git/wrapper.ts:109 — untouched); ✅
- sanitized child environment (`LC_ALL=C`, `LANG=C`, `PATH=''`,
  execFile — no shell); ✅
- repository preflight / read-only command set — untouched (diff
  scope: host-lane.ts only). ✅
- Descriptor `version` now records the DETECTED triple (truthful),
  not the old constant; consumers carry it for reporting only. ✅

Focused tests executed (41/41 git + 39/39 security):
- `2.29.9` → `wrong-version`; `2.30.0`/`2.45.4`/`2.50.1` accepted;
  malformed → `wrong-version`; ✅
- newer version (2.50.1) + mutated bytes → fingerprint revalidation
  FAILS; ✅
- newer version (2.50.1) + world-writable mode → `world-writable`
  rejected. ✅

A newer Git with an unsafe/world-writable binary still fails; a newer
Git binary replaced after initialization still fails. Verified.

---

## 8. Git minimum evidence

Readiness analysis §5 inventory vs `>=2.30.0`:

| Command/flag relied upon | Feature floor (authoritative) |
|---|---|
| `status --porcelain=v1 -z` | v1 + `-z` since 1.7.0 |
| `diff --no-color --no-ext-diff --no-textconv` | 1.5.5 / 1.6.1 |
| `log`/`show --no-color --date=iso-strict --format=%H%x00…%aI%x00%cI%x00` | `--date=iso-strict`, `%aI`, `%cI` since 2.2.0 |
| global prefix `--no-pager --no-optional-locks --no-replace-objects -c …` | `--no-optional-locks` since **2.15.0** (binding floor) |
| `--version` | ancient |

No relied-upon feature was introduced after 2.15; 2.30 (2019) is a
conservative floor above the demonstrated 2.15 binding floor. Output
parsing consumes only stable NUL-delimited/`iso-strict` formats (no
free-text parsing). No post-2.30 command is in the inventory. **2.30
is justified by the complete command set** — no finding.

---

## 9. Pi candidate classification

`classifyPiVersion`: `<0.83.0` → `not-supported-lane`; exactly
`0.83.0` → `supported` (known-good); `>0.83.0` semver-valid →
`candidate`; malformed → `malformed` (fail closed); `null`/empty →
`missing`. Production policy `PI_RUNTIME_POLICY = 'probe-candidates'`.

The old `allow-unverified` policy is REMOVED — no path exists where an
unprobed candidate is accepted. A candidate is accepted only via the
probe in both acceptance boundaries (install, doctor). An unprobed
candidate can never become healthy merely for being newer: doctor
classifies it `installed but unverified` (probe infrastructure
unavailable, exit 1) or `unsupported` (probe FAIL, exit 2); install
REFUSES/FAILs.

---

## 10. Pi compatibility probe — semantic sufficiency (HIGH PRIORITY)

Traced against the ACTUAL pi-guard v0.1.2 implementation
(`plan_spec_guard/src/index.ts` at `7a7580c`):

**pi-guard's real dependencies, by phase:**
- Load/import: `CONFIG_DIR_NAME` (runtime import from
  `@earendil-works/pi-coding-agent`), `StringEnum` (runtime import from
  `@earendil-works/pi-ai`) — resolved through pi's loader jiti aliases;
- Factory: `pi.registerCommand('guard')`, `pi.on` for exactly
  `session_start` / `session_shutdown` / `before_agent_start` /
  `tool_call`; `GuardController` constructed with captured
  `pi.getAllTools`/`getActiveTools`/`setActiveTools` closures
  (NOT invoked at load);
- session_start (runtime): `pi.getAllTools()`, possibly
  `pi.registerTool(gitInspectTool)` (the lazy git_inspect ownership
  path), `loadGuardConfig({cwd, isProjectTrusted})`, ui notify/footer;
- tool_call (runtime): `pi.getAllTools()`, controller decision,
  `{block: true, reason}` return contract;
- before_agent_start (runtime): `{systemPrompt}` return contract.

**Probe coverage (verified empirically):**
- loads pi-guard through pi's OWN loader with zero load errors — covers
  the jiti/alias import surface incl. `CONFIG_DIR_NAME`/`StringEnum`; ✅
- extension factory executes — covers `registerCommand` + `on`
  presence (a missing method throws at factory → load error); ✅
- `guard` command registered; ✅
- all four required event handlers registered (presence of exactly the
  enforcement hooks pi-guard needs); ✅
- load-time tool registry reported (0 by design — lazy registration
  documented, never a failure); ✅

**Live verification (isolated HOME, no Pi-state mutation):** the
compiled probe against real pi 0.84.1's own loader + real pi-guard
v0.1.2 entry → `PASS — guard command + required events (session_start,
session_shutdown, before_agent_start, tool_call) verified through pi's
own loader; tools at load: 0`, exit 0.

**The boundary:** I attempted to exercise the session-time surface
in-process (invoking the registered `session_start` handler with a
synthetic context through pi 0.84.1's loader). pi's runtime rejects it:
`Error: Extension runtime not initialized. Action methods cannot be
called during extension loading.` — pi actively blocks
`registerTool`/`getAllTools`-class calls outside a live session.
Therefore NO isolated loader probe can verify the session-time
enforcement surface (tool registry APIs, event delivery, block-return
contracts). This is an inherent isolation boundary, not an
implementation omission — the probe is the strongest verification
possible without a live pi session.

**Explicit answer:** probe PASS establishes the minimum LOAD-TIME Pi
API surface required for pi-guard activation and hook registration —
substantially more than "the extension can load" (loader mechanics,
factory, command, exact event surface). It does NOT establish the
session-time enforcement mechanics (registerTool/getAllTools/
setActiveTools, tool_call block-return, before_agent_start prompt
contract). The lazy git_inspect registration path is enforcement-
critical and outside probe coverage: a candidate whose API regressed
ONLY there would pass the probe and fail open at first real session
(session_start throws → guard stays OFF, user-visible errors). Risk is
bounded: candidates are opt-in, 0.83.0 remains known-good, doctor
re-probes current state on every run. The probe definition matches the
human-approved policy (readiness §6/§13). Residual boundary should be
recorded explicitly — see SIR-PS6R-004.

---

## 11. Probe provenance / loader resolution

`resolvePiLoaderFromBin(piBin)`: `realpathSync` (symlink-resolved) →
`<pkg>/dist/cli.js` → package root → `<pkg>/dist/core/extensions/
loader.js`, `null` on any layout failure (fail closed). Verified
against the real pi 0.84.1 installation: exact match, and the derived
loader path exists.

- PATH confusion: `resolveExecutable('pi', pathEnv)` yields an
  absolute path; the loader is derived from THAT path's realpath —
  same installation. Symlink aliases converge via realpath.
- cwd/module-resolution influence: none (absolute paths only).
- Arbitrary package loading: the probe imports only the resolved
  loader path; `PI_BIN` fallback exists in the CLI but the product
  always passes `PI_LOADER` explicitly.
- Environment injection: probe env is the explicit host-seam env +
  the three probe variables; no ambient `PI_*` leakage is relied on.
- TOCTOU: a pi swap between version detection and loader probe could
  probe a different installation than the version string reports —
  but the probe then validates the ACTUAL loader+entry in place, so
  the authorization-relevant fact (does the current loader load
  pi-guard) is what is tested; the version string may be stale
  (reporting only). Fail-closed on any loader loss.
- A PASS from another Pi installation cannot authorize the selected
  candidate: loader and entry are both derived from the classified
  executable / the activated package dir.

---

## 12. Candidate install mutation ordering

Installer flow (`install.ts` → `components.ts`), verified by code
trace and executed tests:

1. pi classification + `resolvePiLoaderFromBin` at preflight — loader
   unresolved → **REFUSED before any mutation** (even before layout
   creation; test asserts `packagesDir` absent);
2. artifact verify → quarantine strip → extract → activate into
   `<packagesDir>/pi-guard@0.1.2` (rollback-tracked);
3. **compatibility probe runs against the ACTIVATED dir — BEFORE any
   `pi install` mutation**;
4. probe FAIL → `ERR-PS3-PIGUARD-PROBE` → `rollback(attempt)` removes
   the activated dir; `piGuardPiState` stays `none` → no residual Pi
   state; no receipt; result `FAILED` — never `COMPLETE`;
5. only on PASS: read-only `pi list` pre-inspection → `pi install`
   (if not pre-existing) → exact-source post-verification.

Executed tests confirm: probe FAIL → activated dir removed, no receipt,
no Pi mutation; probe PASS → `COMPLETE` + receipt note recording the
candidate probe PASS. Failure paths inspected directly (not only
happy-path tests). No false COMPLETE receipt, no stale active package
state granting partial success.

---

## 13. Point-of-use Pi drift (HIGH PRIORITY — mandatory question)

Scenario: install with pi 0.84.1 (probe PASS, receipt note recorded) →
later pi upgraded/replaced → user runs `project add` / `doctor` /
`start`.

- **`start`**: composes ONLY the Gateway MCP process
  (`spawnGatewayForStart`). It has no Pi usage, no pi gate, no pi
  dependency — pre-existing structure (operator-cli-contract §6),
  unchanged by PS-6R. `start` cannot "use" any pi, probed or not.
- **`project add`**: platform + node gates only; no pi usage
  (pre-existing).
- **`doctor`**: re-observes pi `--version` and re-runs the probe
  against the CURRENT pi executable + CURRENT pi-guard dir on every
  invocation. Doctor evidence is never stale by construction.
- **Install receipt**: the probe result is an informational note; no
  persisted authorization is consumed by any later boundary.
- **Pi sessions** (the actual pi-guard enforcement point of use): the
  extension loads from pi's package store under whatever pi version
  the user launches; if incompatible, pi-guard fails visibly at
  session_start and the next doctor run flags the candidate.

**Explicit answer: NO** — Pi cannot change after installation in a way
that allows `start` to use an unprobed candidate while doctor/install
evidence remains stale: `start` has no Pi usage at all, doctor
re-validates current state on every run (no stale evidence is
authoritative), and no persisted probe result authorizes later
behavior. No immutable-binding gap exists because no Pi binding is
consumed at start. The product's Pi point-of-use boundary is doctor
(install-time is install), and both re-observe current facts.

---

## 14. Cross-boundary consistency

- **Node**: all four boundaries consume the one shared classifier;
  `start`/`project add` re-check node at point of use
  (`checkNodeLane`), so a post-install node downgrade below 22.19.0 is
  refused at start — no install-accepted/doctor-healthy/start-refused
  divergence is possible (structural + behavioral tests pin this).
- **Pi**: install and doctor apply identical classification + probe
  semantics. The only asymmetry is taxonomy: install treats probe-
  infrastructure-unavailable as REFUSED/FAILED (it cannot truthfully
  install), doctor reports `installed but unverified` (exit 1) — both
  fail closed; neither accepts. `start`/`project add` do not gate pi
  (pre-existing; no acceptance claim to diverge).
- No boundary produces "historical install PASS → current doctor
  failure → start proceeds anyway" for any component start actually
  validates. For pi, start's non-gating is unchanged from the prior
  policy (the old regime also let start proceed with pi 0.84.x while
  doctor exited 2).

---

## 15. Doctor taxonomy

Verified taxonomy (unit + live):

| Case | Verdict | Exit |
|---|---|---|
| Node newer-compatible | `supported` | 0 |
| Node below minimum | `unsupported` | 2 |
| Git newer-compatible | `supported` | 0 |
| Git below minimum | `unsupported` | 2 |
| Pi candidate + probe PASS | `supported` | 0 |
| Pi candidate + probe FAIL | `unsupported` | 2 |
| Pi candidate + probe infrastructure unavailable | `installed but unverified` | 1 |
| Pi below minimum / malformed | `unsupported` / `installed but unverified` | 2 / 1 |

**Critical product question — can `start` proceed while doctor returns
`installed but unverified` for Pi?** YES — but `start` does not execute,
launch, or depend on Pi in any way (Gateway-only composition). The
"unverified" Pi verdict concerns pi-guard enforcement inside pi
sessions, whose point-of-use validation is doctor (re-probed every
run). The set of Pi states in which `start` proceeds is IDENTICAL to
the pre-PS-6R policy (start was never pi-gated). Therefore the approved
fail-closed policy is not violated: no new fail-open path was
introduced, and no pi acceptance claim is made at start. Doctor's exit
1 is not "harmless" in the sense of being ignorable — it is the
product's truthful, current-state finding, and any operator acting on
it gets exactly the pre-existing contract behavior. A doc-level
clarification is included in SIR-PS6R-003/004 recommendations.

---

## 16. CI baseline separation

Workflows untouched (`.github/workflows/` not in the diff; no diff
against HEAD). Lane A/B remain exactly pinned: Node 22.23.2
SHA-256-pinned from nodejs.org (both lanes, arch-asserted), Git 2.45.4
digest-pinned kernel.org source build with `git --version` assertion,
isolated Pi 0.83.0 lane. No `latest`, no minimum, no floating pins
introduced. Baseline constants are reporting/evidence facts only (no
hidden equality gate — §4/§6 greps).

---

## 17. Contract diff

Modified normative docs contain only the human-approved policy:
- `installation-contract.md` §4: Node minimum 22.19.0 (22.23.2
  baseline, reported); Git minimum 2.30.0 + Gateway fail-closed
  reference; Pi 0.83.0 known-good + probe-gated candidates; fail-closed
  conditions. No blanket future-version acceptance language.
- `operator-cli-contract.md` §2: vocabulary unchanged; doctor checks
  table minimum-based; unsupported examples updated.
- `platform-support-contract.md` §3.8/§3.9: Git/Node on macOS
  minimum+baseline; native-arm64 requirement and `/usr/bin/git`
  prohibition preserved.

**Flagged (finding SIR-PS6R-002):** the SAME two docs retain stale
exact-pin text elsewhere — `installation-contract.md` §3 ("Component
versions are exact: node 22.23.2, git 2.45.4 … No ranges") and
`platform-support-contract.md` §1 ("Node: 22.23.2 … Git: 2.45.4 pinned
binary") — now self-contradicting the modified sections. No accidental
new semantic was introduced in any touched doc.

---

## 18. Identity / authority regression

- Trusted configuration identity: untouched (Gateway diff excludes
  `trusted/`, `pointofuse-v2/`; pi-shuttle diff excludes
  `host/environment.ts` identity material).
- Host-lane strings: byte-identical (§5).
- POUV2 identities/oracles: no affected path; implementation-reported
  232/0 plus source-level non-interference (no import of the changed
  module in those trees) accepted per gate §19.
- Cross-lane replay behavior, APFS dev+ino duplicate guard: untouched.
- MCP 9-tool surface: untouched (no `mcp/` diff).
- Authority boundaries / project remove semantics: untouched.
- Compatibility changes feed no identity projection: `classify*`
  functions consume versions only; `hostLane()` never receives version
  input (regression test asserts this).

---

## 19. Focused independent verification (executed)

pi-shuttle:
- version parser boundary matrix (independent script, §3) — passed;
- node/git/pi classification boundaries — `tests/unit/runtime-compat.test.ts`
  + `installer-preflight.test.ts` — passed;
- candidate probe PASS/FAIL/unrunnable doctor taxonomy — passed;
- install rollback / no-Pi-mutation / probe-note tests — passed;
- static guards (fs allowlist, env confinement, exec confinement) — passed;
- `tsc --noEmit` clean; `git diff --check` clean;
- full suite: **227 tests, 224 pass, 0 fail, 3 truthful darwin-only skips**;
- live probe in isolated HOME against REAL pi 0.84.1 loader + REAL
  pi-guard v0.1.2 entry: **PASS** (no real Pi state touched);
- real `doctor` run on this host: node/git rows `supported`; pi 0.84.1
  candidate with missing pi-guard dir → `installed but unverified`
  (infrastructure path, fail closed as designed).

Gateway (focused, per gate §19):
- `dist-test/tests/wp7/git/git.test.js` + `wp7/security/security.test.js`:
  **80/80 pass** (incl. minimum-version block, same-version fingerprint
  mutation, newer-version unsafe binary);
- `tsc --noEmit` clean; `git diff --check` clean;
- **FAIL — `scripts/run-wp7-tests.mjs` count manifest** (SIR-PS6R-001).

Gateway broad-suite note: one full `npm test` run executed 2378 tests
→ 2375 pass / 3 fail; of these, one is identified from retained logs
(`F8: real Pi 0.83.0 path supplied explicitly is accepted` — the
pre-existing local-lane harness test hard-asserts the host's real pi
== 0.83.0 while this host runs 0.84.1; file untouched by PS-6R,
environment drift, not a PS-6R defect); the other two TAP failures are
not identifiable from the retained (truncated) log; the WP-7 runner
stage additionally fails (SIR-PS6R-001). The broad run is NOT used as
acceptance evidence. POUV2/conformance/identity were not rerun
(unchanged paths; implementation results + source-level non-
interference accepted per gate §19).

---

## 20. Findings

### SIR-PS6R-001 — MAJOR — TEST/EVIDENCE
- **Location:** `Project_Gateway_MCP/scripts/run-wp7-tests.mjs`
  (`EXPECTED_COUNTS`, header comment) vs `tests/wp7/git/git.test.ts`.
- **Invariant violated:** the repository's validated WP-7 runner
  enforces an accepted test-count manifest ("fail nonzero on …
  missing/added tests"). The PS-6R change added 3 tests (38 → 41)
  without updating the manifest.
- **Reproduction/evidence:** `node scripts/run-wp7-tests.mjs` →
  `[wp7-runner] FAIL: [git] expected 38 executed tests, summary reports
  41`; the `npm test` pipeline fails at this stage. Implementation
  report §9 reports only the file-level 41/41 and does not disclose
  the broken gate.
- **Smallest correction:** set `EXPECTED_COUNTS.git = 41` and update
  the header count note (38→41, total 165→168).
- **Inside approved PS-6R policy?** Yes — bookkeeping for the tests the
  change itself added (the runner explicitly anticipates authorized
  count updates).
- **Contract escalation required?** No.

### SIR-PS6R-002 — MODERATE — DOCUMENTATION
- **Location:** `docs/installation-contract.md` §3 ("Component versions
  are exact: node `22.23.2`, git `2.45.4` … No `latest`, no ranges");
  `docs/platform-support-contract.md` §1 ("Node: `22.23.2` … Git:
  `2.45.4` pinned binary").
- **Invariant violated:** modified normative docs are internally
  contradictory: §3/§1 still state the removed exact-pin policy while
  §4/§3.8/§3.9 (also modified) state the approved minimum+baseline
  policy.
- **Reproduction/evidence:** grep of both files (text above); no
  reviewer interpretation needed.
- **Smallest correction:** rewrite the two lists to
  minimum-runtime + validated-baseline wording (mirroring the already-
  approved §4/§3.8 text); keep the "never `/usr/bin/git`", native-
  arm64, and no-arbitrary-install rules.
- **Inside approved PS-6R policy?** Yes — same policy, applied
  consistently.
- **Contract escalation required?** No.

### SIR-PS6R-003 — MINOR — DOCUMENTATION
- **Location:** `src/command/doctor.ts` module header (lines 14–18).
- **Invariant violated:** header still describes the removed policy:
  "the exact evidence lane is 2.45.4 — presence ≠ lane evidence; Pi
  0.83.0 is the baseline; 0.84.x is NOT a claimed lane and is reported
  `unsupported` per installation-contract §4 (the PS-3 normative
  refusal policy is unchanged)".
- **Smallest correction:** replace with minimum+baseline wording
  matching the implemented rows.
- **Inside policy / escalation:** Yes / No.

### SIR-PS6R-004 — MODERATE — SECURITY (residual-risk recording)
- **Location:** `src/compat/pi-guard-probe.ts` (probe contract);
  approved policy (readiness §6/§13).
- **Invariant violated:** none against the approved policy — but the
  probe's coverage boundary is security-relevant and currently only
  implied: PASS covers the load/factory/registration surface; the
  session-time enforcement surface (`registerTool`/`getAllTools`/
  `getActiveTools`/`setActiveTools`, `tool_call` block-return,
  `before_agent_start` prompt contract) is NOT covered and CANNOT be
  covered by any isolated loader probe — demonstrated empirically: pi
  0.84.1 rejects action-method calls outside a live session
  ("Extension runtime not initialized. Action methods cannot be called
  during extension loading."). A candidate regressing only the
  session-time surface would pass the probe and fail open at first
  real session (guard stays OFF).
- **Reproduction/evidence:** in-process handler invocation test (this
  review, §10) + probe live PASS for the covered surface.
- **Smallest correction:** record the boundary explicitly in the
  probe contract/policy (what the probe verifies AND what it cannot);
  optionally note that release-evidence lanes keep the exact 0.83.0
  baseline for full-session enforcement evidence.
- **Inside approved PS-6R policy?** The probe definition matches the
  approved policy; the correction (documentation of the boundary) is
  inside policy. A live-session smoke probe would be OUTSIDE approved
  scope.
- **Contract escalation required?** No for acceptance (implementation
  is policy-faithful); yes only if session-time coverage is ever
  desired.

### SIR-PS6R-005 — MINOR — OPTIONAL HARDENING
- **Location:** `src/compat/pi-guard-probe.ts` CLI main.
- **Invariant violated:** loader-import failures (missing file,
  non-loader file) surface as uncaught exceptions → exit 1, which
  doctor maps to integration FAIL (`unsupported`) instead of
  infrastructure (`installed but unverified`); verified exit codes:
  missing loader = 1, bad loader = 1, missing env = 2. Fail-closed in
  both cases; taxonomy imprecise for the narrow loader-loss window
  (TOCTOU between `resolvePiLoaderFromBin` and the probe import).
- **Smallest correction:** wrap the CLI main in try/catch mapping
  import/TypeError failures to exit 2 with a bounded message.
- **Inside policy / escalation:** Yes / No.

### SIR-PS6R-006 — MINOR — OPTIONAL HARDENING
- **Location:** doctor `defaultPiGuardProbe` and installer probe
  closure pass `HOME = env.home` (real user home).
- **Invariant violated:** the probe's documented contract says
  "isolated HOME"; product paths run the probe with the real HOME.
  Verified inert on pi 0.84.1 (its loader performs no writes and does
  not reference `home`; no new home entries observed), so no current
  mutation — but the contract text is not honored by the product
  paths, and a future pi whose loader uses `home` for caches would
  write into the user's real home during doctor.
- **Smallest correction:** pass a probe-scoped temp HOME (e.g., under
  `layout.stateDir`) or amend the contract text to describe the
  product paths.
- **Inside policy / escalation:** Yes / No.

### SIR-PS6R-007 — MINOR — OPTIONAL HARDENING
- **Location:** `Project_Gateway_MCP/src/git/host-lane.ts`
  `GIT_VERSION_RE` (unanchored prefix regex).
- **Invariant violated:** none functionally — but the Gateway grammar
  admits 4-part versions (`git version 2.45.4.windows.1` → 2.45.4)
  while pi-shuttle's strict parser classifies the same string
  malformed (`installed but unverified`). Grammar divergence between
  the two parsers; each fails closed for its own purpose; Windows is
  unsupported. Real vendor trailing text (`(Apple Git-145)`) justifies
  trailing-text tolerance, not a fourth numeric component.
- **Smallest correction:** anchor the regex after the triple while
  allowing non-numeric trailing text (e.g., `(?![.\d])`), and/or
  document the divergence.
- **Inside policy / escalation:** Yes / No.

Non-findings recorded for transparency: parser float-acceptance of
absurd digit counts (§3); real-HOME probe env (SIR-PS6R-006); Gateway
broad-suite F8 failure (pre-existing host drift, untouched file);
installer has no darwin arch gate (pre-existing; contract §3.9 pins
arch enforcement to doctor/CI).

---

## 21. Mandatory conclusions

1. **Exact Node 22.23.2 runtime equality fully removed?** YES — no
   equality gate remains in `src` (grep + structural tests); CI pins
   exempt.
2. **Node >=22.19.0 implemented consistently?** YES — one shared
   classifier across install/add/start/doctor; boundary matrix
   verified independently.
3. **Darwin native-arm64 requirement preserved?** YES — applies to any
   version-compatible node; Rosetta/x64 rejected.
4. **TrustedHostLane strings and identity unchanged?** YES —
   byte-identical; pure mapping; identity/store paths untouched.
5. **Exact Git 2.45.4 runtime equality removed?** YES — pi-shuttle
   and Gateway both minimum-based; baseline is reporting only.
6. **Git >=2.30 justified by the complete command inventory?** YES —
   binding floor is 2.15 (`--no-optional-locks`); 2.30 conservative;
   no relied-upon feature post-2.30.
7. **Gateway Git safety/fingerprint behavior unchanged?** YES — only
   the version predicate relaxed; all invariants verified; unsafe
   newer binary and post-init replacement both fail (tests 80/80).
8. **Pi 0.83.0 remains known-good rather than sole allowed?** YES.
9. **Every non-baseline Pi candidate requires probe PASS before
   acceptance?** YES — install and doctor; `allow-unverified` removed.
10. **Probe checks the actual required pi-guard enforcement API
    surface?** PARTIAL — the full load/factory/registration surface
    (more than "can load"), through pi's own loader, with zero errors;
    the session-time enforcement surface is not and cannot be covered
    by an isolated probe (empirically demonstrated) — SIR-PS6R-004.
11. **Probe bound to the selected Pi executable/loader?** YES —
    realpath-derived loader from the classified executable; verified
    against the real layout; no cross-installation authorization.
12. **Candidate probe failure cannot mutate real Pi state?** YES —
    probe precedes any `pi install`; FAIL → rollback, no receipt, no
    Pi-side state (code + tests).
13. **Pi runtime drift after installation cannot bypass compatibility
    validation at start/use time?** NO (safe) — `start` has no Pi
    usage; doctor re-observes and re-probes current state every run;
    no persisted probe authorization exists.
14. **install/add/doctor/start acceptance semantics mutually
    consistent?** YES — Node fully shared; Pi consistent between
    install and doctor; start/add pi-non-gating pre-existing and
    unchanged.
15. **A Pi candidate doctor cannot verify cannot start as healthy?**
    N/A-turned-NO — `start` does not evaluate Pi (no Pi usage); doctor
    returns exit 1 (`installed but unverified`), never healthy; no
    new fail-open introduced.
16. **Exact CI baselines remain unchanged?** YES — workflows untouched,
    exact pins (22.23.2 SHA-pinned, 2.45.4 digest-pinned, 0.83.0
    isolated).
17. **No compatibility change affects trusted identity/store
    semantics?** YES — zero affected paths.
18. **Gateway 9-tool surface unchanged?** YES — no `mcp/` diff.
19. **macOS Intel remains unsupported?** YES — matrix unchanged.
20. **pi-guard source unchanged?** YES — HEAD == remote == v0.1.2,
    tracked tree clean.

---

## 22. Senior-review report (this document) — summary

Independent verification: pi-shuttle full suite 227/224/0 (3 truthful
skips), typecheck + diff-check clean, live isolated probe PASS on real
pi 0.84.1 + pi-guard v0.1.2, parser boundary matrix passed, real
doctor run matches taxonomy. Gateway: focused git+security 80/80,
typecheck + diff-check clean, full host-lane.ts invariant read.

Findings: 1 MAJOR (SIR-PS6R-001 WP-7 count manifest), 1 MODERATE
DOCUMENTATION (SIR-PS6R-002 stale contract sections), 1 MODERATE
SECURITY (SIR-PS6R-004 probe session-time boundary — policy-faithful,
record residual risk), 4 MINOR (SIR-PS6R-003 stale doctor header,
-005 probe exit taxonomy, -006 real-HOME env, -007 parser grammar
divergence). No CRITICAL.

Smallest focused correction set:
1. `run-wp7-tests.mjs`: `EXPECTED_COUNTS.git` 38 → 41 (+ header note).
2. Align `installation-contract.md` §3 and
   `platform-support-contract.md` §1 with the approved minimum+baseline
   wording.
3. Update the stale `doctor.ts` header; optionally SIR-PS6R-004/-005/
   -006/-007 as documented.

### Exact Git status (at review close)

pi-shuttle (`2076575efb7e8d9d7aeaff8f4bfafb7df3e965e8`, local == remote):
- Modified: `docs/installation-contract.md`, `docs/operator-cli-contract.md`,
  `docs/platform-support-contract.md`, `scripts/pi-extension-load-probe.mjs`,
  `src/command/doctor.ts`, `src/compat/manifest.ts`,
  `src/installer/components.ts`, `src/installer/install.ts`,
  `src/installer/preflight.ts`, `tests/unit/doctor.test.ts`,
  `tests/unit/installer-flow.test.ts`, `tests/unit/installer-preflight.test.ts`,
  `tests/unit/static-guard.test.ts`;
- Untracked: `src/compat/pi-guard-probe.ts`, `src/compat/versions.ts`,
  `tests/unit/runtime-compat.test.ts`, the readiness analysis, the
  implementation report, and **this senior review** (all uncommitted,
  unstaged).

Gateway (`98d1b204a864596bda91bec1104b8a8d5e89e1cd`, local == public):
- Modified: `src/git/host-lane.ts`, `tests/wp7/git/git.test.ts`;
- Untracked (pre-existing WP-13D debris, untouched): `src/retrospective/`,
  `tests/unit/wp13d-retrospective.test.ts`,
  `tests/unit/wp13d-static-guard.test.ts`,
  `docs/reports/wp-13d-retrospective-facts-and-closure-implementation-report.md`,
  `docs/reports/project-gateway-public-history-and-license-focused-rereview.md`,
  `docs/reports/project-gateway-github-publication-record.md`.

pi-guard (`7a7580cc4cbd7926797564c72269394fc29a860a` = `v0.1.2`, local ==
remote, tracked tree clean; 8 pre-existing untracked v0.1.1-era docs).

No commit/stage/push/tag/release/publication/deployment performed in
this gate. The review report is left uncommitted and unstaged.

`PS-6R SENIOR REVIEW — CORRECTIONS REQUIRED`
