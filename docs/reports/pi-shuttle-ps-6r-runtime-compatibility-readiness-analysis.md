# pi-shuttle PS-6R — runtime compatibility simplification readiness analysis

Gate: `PS-6R — RUNTIME COMPATIBILITY SIMPLIFICATION READINESS ANALYSIS`
(READ-ONLY; no production code, contract, or policy changes; nothing
committed or pushed).

Baselines verified at analysis start:

- pi-shuttle local == remote ==
  `2076575efb7e8d9d7aeaff8f4bfafb7df3e965e8` (clean tree).
- Gateway public == `98d1b204a864596bda91bec1104b8a8d5e89e1cd`.
- pi-guard public == `7a7580cc4cbd7926797564c72269394fc29a860a` = `v0.1.2`.
- Remote CI: `PS-6 REMOTE CI — ACCEPTED` (Lane A/B/C green; Lane B
  real-stack executed from public components).

Scope: Node, Git, Pi, trusted host-lane identity, doctor/start/install
gating. Excluded by the gate: authority model, MCP surface, artifact
schemas, storage architecture, APFS duplicate-object guard, remove
semantics, installer component ownership, Linux/macOS support claim,
macOS Intel.

---

## 1. Current exact-pin architecture (dependency graph)

### Node `22.23.2`

| Where | Role |
|---|---|
| `src/compat/manifest.ts` `NODE_LANE_VERSION` | single declaration; embedded in the CLI manifest; `package.json engines: >=22.0.0` (floor, explicitly "not a support claim") |
| `installer/preflight.ts` `checkNodeLane()` | **exact equality** → install REFUSED (`ERR-PS3-NODE-LANE`), `start` REFUSED (`ERR-PS4-PREFLIGHT-NODE`), `project add` REFUSED (projects.ts:241) |
| `command/doctor.ts` | exact → `supported`; anything else → `unsupported` (exit 2); darwin-arm64 additionally asserts `process.arch == arm64` (native requirement) |
| CI workflows | exact `22.23.2` darwin-arm64/linux binary provisioned, SHA-256-pinned, arch asserted (evidence lane) |
| Contracts | installation-contract §4 (exact lane, refuse others); platform-support-contract §3.9 (exact + native arm64 on darwin) |
| Trusted identity | **no effect** — Node version never enters any identity computation |

Mismatch consequences today: install refuses; `start` refuses; `project
add` refuses; doctor exit 2; trusted identity unchanged; CI unaffected
(provisions its own).

### Git `2.45.4`

| Where | Role |
|---|---|
| `src/compat/manifest.ts` `GIT_LANE_VERSION` | declaration |
| `command/doctor.ts` | PATH discovery; exact → `supported`; other → `unsupported` (exit 2); missing → `missing` |
| `lifecycle/projects.ts` | **no version gate** — only presence + `git rev-parse --git-dir` capability probe (any version accepted) |
| Installer | **no Git check at all** |
| Gateway `src/git/host-lane.ts` `initializeGitHostLane` | **hard version gate**: `git --version` must contain `2.45.4` → else `wrong-version` fail-closed, at per-workspace lane composition; PLUS binary fingerprint (dev/ino/mode/size/mtime/SHA-256) revalidated before every launch; PLUS path/owner/mode validation; PLUS sanitized env; PLUS repository preflight |
| Gateway runtime commands | `status --porcelain=v1 -z`; `diff --no-color --no-ext-diff --no-textconv [-- pathspecs]`; `log`/`show --no-color --date=iso-strict --format=%H%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00%B%x00%x00 -n<N>`; global prefix `--no-pager --no-optional-locks --no-replace-objects -c …` |
| CI | `scripts/ci-provision-git-2454.sh` — digest-pinned kernel.org source build, exact version asserted (evidence lane) |
| Contracts | installation-contract §4 (version probe); platform-support-contract §3.8 (operator-provided on macOS, never `/usr/bin/git` assumption) |

Mismatch consequences today: doctor exit 2; Gateway startup/`start`
fails closed (`wrong-version`); install and `project add` unaffected.

### Pi `0.83.0`

| Where | Role |
|---|---|
| `src/compat/manifest.ts` `PI_COMPATIBILITY_BASELINE`, `SUPPORTED_PI_LANE = 'pi-0.83.0-extension-api-v1'` | declarations |
| `installer/preflight.ts` `classifyPiVersion` + `applyPiPolicy` + `PI_NON_BASELINE_POLICY = 'refuse-non-baseline'` | install (pi-guard selected): `pi --version` probe; anything ≠ `0.83.0` → REFUSED (`ERR-PS3-PI-NOT-SUPPORTED-LANE`); missing → REFUSED. The alternative `allow-unverified` policy is already implemented at the pure layer, pending the recorded human decision |
| `command/doctor.ts` | exact → `supported`; other → `unsupported`; missing → `missing` |
| Installer component path | `pi install <dir>` (documented supported mechanism), `pi list` exact-source verification |
| Extension surface | pi-guard extension factory consumes Pi's `ExtensionAPI`: `registerCommand`, `registerTool`, `getAllTools`, `getActiveTools`, `setActiveTools`, `on('session_start'|'session_shutdown'|'before_agent_start'|'tool_call')`, `ExtensionContext` footer, `CONFIG_DIR_NAME`; typechecked against `@earendil-works/pi-coding-agent@0.83.0` devDeps; pi itself declares `engines.node >=22.19.0` |
| CI | isolated `@earendil-works/pi-coding-agent@0.83.0` lane; extension loaded through pi 0.83.0's own `loader.js` |
| Contracts | installation-contract §4: "0.83.0 is the verified baseline; 0.84.x is not a claimed lane" |

Mismatch consequences today: install refuses (when pi-guard selected);
doctor exit 2; `start`/`project add` not pi-gated.

---

## 2. Evidence-vs-runtime classification

| Pin | A. CI/evidence baseline | B. genuine runtime requirement | C. security invariant | D. accidental coupling / overconstraint |
|---|---|---|---|---|
| Node exact `22.23.2` | **YES** — CI provisions exact; release evidence | No — see §3 | Only the darwin-arm64 **native-arch** requirement (a lane capability), not the version equality | **YES** — runtime version equality gates install/start/add/doctor |
| Git exact `2.45.4` (pi-shuttle side) | **YES** — digest-pinned CI provision | No — pi-shuttle runs no git at runtime; Gateway owns all git execution | No (pi-shuttle side) | **YES** — doctor version equality only |
| Git `2.45.4` (Gateway side) | **YES** — validated baseline | The version gate is a *baseline gate*, not a demonstrated capability minimum (all used features are ≥ Git 2.15 — §5) | **YES, separate**: binary fingerprint + owner/mode + sanitized env + repo preflight — version-independent, must remain fail-closed | The `includes('2.45.4')` equality is a candidate for capability-based relaxation — **Gateway-side normative decision** |
| Pi exact `0.83.0` | **YES** — isolated lane | The real surface is `extension-api-v1` (loader-probe-able); version equality is the current proxy | No | **YES** — install/doctor equality gate; the `allow-unverified` policy seam already exists (PS-3 report §18) |
| Host lane `…node22` label | **YES** — identity material | No (label is never parsed; §4) | No | Label naming only — but do NOT change the string (§4 migration) |

Rule applied: exact equality is justified only where the version is
either (a) the release-evidence baseline or (b) a demonstrated capability
boundary. Neither Node 22.23.2 equality, pi-shuttle-side Git equality,
nor Pi 0.83.0 equality is a demonstrated capability boundary.

---

## 3. Node compatibility

**Actual API surface required:**

- pi-shuttle product `src/`: `node:fs` (sync + `rmSync`/`mkdirSync`),
  `node:crypto` (`createHash` SHA-256), `node:child_process`
  (`spawn`/`execFile`, never shell), `node:path`, `node:url`, `node:os`
  (`tmpdir`). Nothing requires Node > 16 semantics.
- Gateway: `node:fs/promises` (`FileHandle`), `node:crypto`,
  `node:child_process` (`execFile`, promisified), `node:util`. No
  post-Node-20 API (`no import.meta.dirname`, `toSorted`, `node:sqlite`,
  `crypto.subtle`, `Symbol.dispose` in either product src).
- pi-guard: types + `@earendil-works/pi-ai` `StringEnum`.
- Pi 0.83.0 runtime: declares `engines.node >=22.19.0` — **this is the
  binding floor** for any real-stack composition.
- Test/CI-only (`import.meta.dirname`, `node:test`): Node ≥ 20.11 /
  ≥ 18 — relevant to the CI lane, not end-user runtime.

**Answers:**

- Exact `22.23.2` technically required? **No.** Nothing in pi-shuttle,
  Gateway, pi-guard, or Pi 0.83.0 depends on that exact patch.
- Node 22.x sufficient? **Yes** (any patch ≥ 22.19 per pi's own floor;
  products declare ≥ 22.0).
- `>=22.x` defensible? **Yes as a floor**, with the narrowest
  evidence-backed bound `>=22.19.0` (pi's floor). A "22.x only" rule is
  also defensible; "23/24 untested" argues for not *claiming* them while
  not *refusing* them outright (see §13).
- Upper-bound risks? Untested majors only. No API-version-sensitive
  runtime behavior identified (§4). Probe-based acceptance (run the
  real-stack path on a candidate) converts "untested" into "probed".
- Hard failures to keep: native `process.arch == arm64` on the
  darwin-arm64 lane (required lane capability); node executable present
  and answering `--version` (capability probe failure = `installed but
  unverified`, never silently green).
- To become evidence/informational facts: version equality against
  `22.23.2` in doctor and the install/start/add equality gates.

---

## 4. HIGH PRIORITY — `node22` in the trusted host lane

**Trace.** `TRUSTED_HOST_LANE = 'linux-x86_64-posix-utf8-node22'` and
`DARWIN_ARM64_HOST_LANE = 'darwin-arm64-posix-utf8-node22'` are opaque
string constants (Gateway `src/trusted/host-lane.ts`; mirrored in
pi-shuttle `src/host/environment.ts`). The predicate is **set
membership only** — the lane is never parsed; `node22` is a descriptive
label. Nothing anywhere compares the label to a probed Node version
(Gateway has no `process.versions`/`process.version` read; pi-shuttle's
version gate is a separate mechanism).

**Normative properties the lane actually encodes:** platform +
architecture (via the pure mapping), POSIX filesystem semantics, UTF-8
locale, and — through the storage probe at bootstrap (ADR-036:
exclusive-create, hard-link, no-follow, fsync, case-sensitivity) —
*empirically probed filesystem facts*. The lane participates in the
configuration identity projection (`src/trusted/identity.ts`:
`hostLane` is a first-class member of the JCS-canonicalized projection →
SHA-256 digest → bound into store metadata → cross-lane replay fails
closed, ADR-042 decision 9).

**Per-invariant audit (Node major → normative property):**

| Property | Depends on Node major? | Evidence |
|---|---|---|
| Path semantics / containment | No | fs APIs stable; containment is path-string + no-follow descriptor logic |
| Unicode semantics | No | JCS serializer is hand-rolled RFC 8785 (no `JSON.stringify`); input restricted to safe integers / no surrogate pairs; verified against 19 digest vectors |
| JCS/canonicalization | No | pure code above |
| Filesystem containment | No | filesystem facts are probed at runtime, not assumed from Node version |
| Trusted storage | No | store behavior is fs semantics + fingerprint/lock discipline |
| Authority | No | authority model is separate from runtime identity |
| Cryptographic identity | No | `createHash('sha256')` stable |
| Git inspection | No | git is a separate subprocess with its own lane/fingerprint |
| Point-of-use behavior | No | MCP surface behavior is protocol-level |

**Answer: NO — moving from Node 22 to a compatible future Node runtime
does not require a different trusted configuration identity for a
security/correctness reason.** The `node22` suffix encodes no normative
behavior; it is legacy naming from when Node 22 was the validated
runtime.

**Classification:** the *Node-major host-lane coupling* is a candidate
simplification **in the runtime-gate sense only** (the label should not
be treated as a version requirement — it already is not, mechanically).

**Migration caution (do not change the identity formula in this gate):**
changing the lane *string* would change `configurationIdentity` for every
existing store; cross-lane replay fails closed with `ERR-STO-INTEGRITY`
(ADR-042 decision 9), so all stores would require re-verification
(`project add` replay). Recommendation: **leave the lane constants
byte-identical**; decouple the *runtime Node version gate* from them. If
a future lane rename is ever desired (e.g., to drop `node22`), that is a
breaking, normative, human-approved decision with a documented
re-verification migration — never a mechanical side effect.

---

## 5. Git compatibility

**Complete command inventory (Gateway runtime):**

| Command | Flags | Relied-on behavior | Feature floor (authoritative) |
|---|---|---|---|
| `status` | `--porcelain=v1 -z` | stable v1 machine format, NUL-delimited | v1 since 1.7.0; `-z` since 1.7.0 |
| `diff` | `--no-color --no-ext-diff --no-textconv [-- pathspecs]` | plain diff text; textconv/external diff disabled | `--no-ext-diff` 1.5.5; `--no-textconv` 1.6.1 |
| `log` | `--no-color --date=iso-strict --format=%H%x00…%B%x00%x00 -n<N>` | NUL-delimited stable fields | `--date=iso-strict` 2.2.0; `%aI`/`%cI` 2.2.0 |
| `show` | same format | same | 2.2.0 |
| `--version` | — | lane probe | ancient |
| global prefix | `--no-pager --no-optional-locks --no-replace-objects -c core.fsmonitor= …` | no locks/pagers/hooks/config leakage | `--no-optional-locks` **2.15.0** (binding floor); `-c` 1.6 |

pi-shuttle side: `rev-parse --git-dir` (project-add probe, ancient);
`git init/add/commit` only in CI test fixtures. CI provisions exact
2.45.4 (digest-pinned kernel.org source, `ci-provision-git-2454.sh`).

**Version-sensitive output parsing?** No free-text parsing anywhere.
Status/log/show parsers consume only stable NUL-delimited formats;
`--date=iso-strict` is stable; sort orders are explicit.

**Is exact 2.45.4 necessary? No** — the demonstrated capability floor is
**Git ≥ 2.15.0** (from `--no-optional-locks`); a conservative defensible
floor is 2.30 (2019-era, far below any realistic 2026-era system git).
The Gateway's `includes('2.45.4')` gate is a validated-baseline gate.

**Narrowest defensible model:** minimum version (≥ 2.15, conservative
≥ 2.30) **+ capability probe** (the actual `status --porcelain=v1 -z`
round-trip, which also exercises the sanitized environment) — keep
2.45.4 as the validated CI baseline. Note the GIT-018 history: flag
*forms* differ across versions (`--textconv=false` rejected by 2.45.4,
`--no-textconv` accepted since 1.6.1) — evidence that capability/flag
compatibility is the real constraint, and exactly why a probe beats an
equality string.

**Must remain fail-closed regardless of version relaxation (security
invariants, all version-independent):** canonical absolute binary path;
owner root-or-uid; mode not group/world-writable; dev/ino/mode/size/
mtime/SHA-256 fingerprint captured at lane init and **revalidated before
every launch**; sanitized child env (`LC_ALL=C`, empty `PATH`,
`GIT_CONFIG_*` nulled, no `GIT_*` leakage); `--no-optional-locks` /
pager/hooks/credential suppression; repository preflight (dangerous
config patterns: include/includeif, core.worktree/fsmonitor/hooksPath,
diff.external/textconv, pager, credential, log.showSignature, gpg);
no-shell execution; cwd pinned to workspace root. Any relaxation changes
only the version *string* comparison, never these checks.

**Gate note:** the Gateway's version gate lives in Gateway source —
relaxing it is a Gateway-side normative decision (with its own review/
evidence), outside this read-only gate. pi-shuttle can only (a) stop
duplicating the equality as a doctor hard-fail and (b) record the
Gateway's verdict.

---

## 6. Pi compatibility

**Pi behaviors pi-shuttle depends on:**

1. `pi --version` — version detection (install preflight, doctor).
2. `pi install <dir>` — documented supported package-install mechanism
   (installer component path).
3. `pi list` — exact-source verification (receipt `verifiedBy: pi-list`).
4. pi's extension loader (`loader.js`) — evidence probe loads pi-guard
   exactly as pi does at session start.
5. pi-guard's `ExtensionAPI` consumption: `registerCommand`,
   `registerTool`, `getAllTools`, `getActiveTools`, `setActiveTools`,
   `on('session_start' | 'session_shutdown' | 'before_agent_start' |
   'tool_call')`, `ExtensionContext` (footer), `CONFIG_DIR_NAME`.
   No hooks/events/tools beyond those five events and two registries.

**Is exact 0.83.0 technically required? No** — the actual integration
contract is the `extension-api-v1` surface (`SUPPORTED_PI_LANE`), which
version equality merely proxies. pi-guard is typechecked against 0.83.0
devDeps; whether a newer Pi's API is behaviorally compatible is a
**probeable fact**, not an equality fact.

**Smallest compatibility rule that allows newer Pi without weakening
enforcement:**

- Known-good: `0.83.0` (claimed, always supported).
- Candidate versions: accepted only when the **committed loader probe**
  passes on the candidate (real import through pi's own loader, factory
  runs, `/guard` registers, `getAllTools` inventory sane, zero load
  errors) — the same probe Lane B already runs.
- Fail-closed conditions (unchanged): pi missing when pi-guard selected;
  `--version` probe unparseable; candidate probe fails.
- Never claim unprobed versions; keep 0.83.0 as the only *claimed*
  baseline; probed candidates are `compatibility-probed` facts
  (informational), never silent acceptance.

The `allow-unverified` policy alternative already exists at the pure
layer (`applyPiPolicy`); the human decision recorded in the PS-3 report
is the only thing separating "refuse non-baseline" from "probe-based
acceptance".

---

## 7. Doctor taxonomy

Current checks → classification under the gate's rule (hard-fail only
when continuing would violate correctness, security, or a required
capability; CI-environment difference alone is never a hard fail):

| Check | Current verdict logic | Classification | Change |
|---|---|---|---|
| `platform` | manifest lane membership | **HARD FAIL (correct)** | keep |
| `node` (version) | exact 22.23.2 → supported; else unsupported (exit 2) | **violates the principle** (CI-difference-only) | → WARNING/INFORMATIONAL (record exact version, known-good lane, arch fact) |
| `node` (arch, darwin-arm64) | `process.arch != arm64` → unsupported | **HARD FAIL (correct)** — required lane capability | keep |
| `node` (probe failure) | no output → unsupported | **HARD FAIL (correct)** — capability unverifiable | keep (as `installed but unverified`-class finding) |
| `git` (missing) | missing | **HARD FAIL (correct)** — required capability | keep |
| `git` (version) | exact 2.45.4 → supported; else unsupported | **violates the principle** | → WARNING (report version; Gateway remains the runtime authority) |
| `git` (unparseable version) | installed but unverified | **correct** | keep |
| `pi` (missing, pi-guard installed) | missing (finding, exit 1) | **HARD FAIL (correct)** — Pi-side enforcement absent | keep |
| `pi` (version) | exact 0.83.0 → supported; else unsupported | **violates the principle** (probe-based acceptance replaces equality) | → WARNING/INFORMATIONAL with known-good + probed lists |
| `receipt`/`gateway`/`pi-guard`/`runtime-config`/`project-*`/`git-isolation`/`locks` | state/capability-based | **correct as-is** | keep |

Doctor exit-code semantics (`unsupported` → 2, findings → 1) remain
useful; after reclassification the `node`/`git`/`pi` version rows stop
producing `unsupported` purely for CI-drift, and `platform`/arch/
presence/capability rows keep producing it.

---

## 8. Installer / start / bootstrap gates

| Gate | Current | After simplification |
|---|---|---|
| `install` platform lane | exact lane membership | **unchanged** (hard) |
| `install` node | exact 22.23.2 equality → REFUSED | → capability check (present, answers `--version`, native arch on darwin) + informational lane fact |
| `install` tar | presence | **unchanged** (hard) |
| `install` pi (pi-guard selected) | exact 0.83.0 → else REFUSED | known-good 0.83.0 **or** loader-probe-passed candidate; missing/unparseable/probe-fail → REFUSED (unchanged fail-closed) |
| `install` git | not gated | no gate needed; Gateway's own lane gate governs at start |
| `project add` platform+node | platform hard; node exact equality | platform unchanged; node → capability/informational |
| `project add` git | presence + `rev-parse --git-dir` probe | **unchanged** (capability probe, already version-agnostic) |
| `start` platform | exact lane | **unchanged** (hard) |
| `start` node | exact equality → REFUSED | → capability/informational (the Gateway itself never checks node version) |
| `start` receipt/store/config | state-based fail-closed | **unchanged** |
| bootstrap (Gateway replay) | lane identity + storage probe | **unchanged** — identity formula untouched (§4) |

Fail-closed preserved wherever an actual required capability is absent:
platform lane, native arm64 node, tar, git presence + repo probe, pi
presence + probe, receipt/store/config integrity, Git binary fingerprint
(Gateway-owned).

---

## 9. CI policy after simplification

- **Lane A/B keep exactly** Node `22.23.2`, Git `2.45.4`, Pi `0.83.0` —
  the known-good release-evidence baseline; provisioning remains
  digest-pinned. The baseline never becomes `latest`.
- Add **focused compatibility tests around accepted alternatives**
  (not floating): a small matrix lane/job that runs the real-stack path
  (or its probe subset) against e.g. Node 22.latest-patch, Git floor
  candidates, and a loader-probed Pi candidate; results are recorded
  evidence facts, never support claims for unprobed versions.
- pi-shuttle's own suite keeps the exact-lane unit tests (they document
  the CI lane); new unit tests cover the range/probe logic and the
  doctor taxonomy.

---

## 10. Lane D consequences

A meaningful physical Apple Silicon UAT after simplification:

- **Node:** normal native (arm64) Node satisfying the supported rule
  (e.g., official 22.x installer), not a manually reproduced 22.23.2.
- **Git:** the user's normal compatible Git where possible (homebrew
  etc.), satisfying the minimum-version + capability probe; record
  origin and version (platform-support-contract §3.8 discipline kept).
- **Pi:** a current compatible Pi where possible, loader-probed;
  0.83.0 remains the claimed baseline.
- **Still repeated as exact-baseline release evidence** (separately):
  the exact Node 22.23.2 / Git 2.45.4 / Pi 0.83.0 stack once on the
  release lane (Lane B already does this per push); APFS strict evidence;
  storage crash/probe evidence; quarantine/canonical-path/UID facts;
  real MCP handshake; lifecycle; doctor exit 0.
- Lane D records: volume case-sensitivity, canonical paths, git origin,
  node origin/arch, pi version + probe result — same record discipline,
  no manual recreation of exact CI versions.

---

## 11. Contract impact (normative decisions required — none made here)

**MECHANICAL (implementation inventory, §13.11 below):**

- `checkNodeLane` → capability/range check; call sites unchanged shape.
- `applyPiPolicy`/`classifyPiVersion` → known-good + probe-based
  acceptance (or a new `probe-accepted` lane); `PI_NON_BASELINE_POLICY`
  becomes the recorded human choice.
- doctor wording/classification for node/git/pi version rows.
- tests: preflight, doctor, manifest, new probe/range tests.
- contracts: installation-contract §4, platform-support-contract §3.8/
  §3.9, operator-cli-contract doctor wording.

**NORMATIVE (human decisions):**

1. **Supported Node rule** — e.g. "≥22.19.0 within 22.x" vs "22.x any
   patch" vs ">=22.19.0 any future major once probed".
2. **Supported Git rule** — minimum version (2.15 evidence floor /
   conservative 2.30) + capability probe; **requires a Gateway-side
   decision** to relax `initializeGitHostLane`'s `includes('2.45.4')`.
3. **Supported Pi rule** — known-good 0.83.0 + loader-probe acceptance
   for candidates (with the probe shipped in the product path, not only
   CI), or keep refusal until a probe is productized.
4. **Whether Node major remains trusted identity material** — evidence
   says NO security/correctness dependency (§4), but the lane *string*
   must stay byte-identical to avoid breaking store identity; any future
   lane rename is a breaking decision with re-verification migration.

---

## 12. Regression / security risks and mitigations

| Risk | Mitigation (smallest) |
|---|---|
| Newer Git output/flag changes break parsers | Parsers already consume stable NUL-delimited formats; add a capability probe (real `status --porcelain=v1 -z` round-trip) to the acceptance rule; Gateway version gate relaxed only with its own review |
| Newer Git drops a relied-on flag (`--no-optional-locks`, `-z`, `--date=iso-strict`) | Minimum-version floor (≥2.15) keeps all relied-on flags in-range; probe exercises the actual commands |
| Pi extension API drift in a candidate version | Loader probe must pass on the candidate before acceptance; probe checks `/guard` registration + inventory + zero load errors; never claim unprobed versions |
| Node fs/runtime behavior changes on a future major | No API-version-sensitive code identified (§3/§4); acceptance via real-stack probe on candidate; arch/lane invariants unchanged |
| Store identity migration from lane changes | **Don't change lane strings**; identity formula frozen; any future rename is a separate breaking decision (§4) |
| False-positive compatibility (probe passes, real behavior differs) | Probes are the *same* committed evidence probes used in Lane B (loader probe, git status round-trip); acceptance recorded as `compatibility-probed`, never `supported` for unclaimed versions |
| Reduced fail-closed protection (e.g., accepting a drifted Git binary) | Binary fingerprint revalidation per launch stays untouched; version relaxation touches only the version *string* comparison; all owner/mode/env/preflight checks unchanged |
| Doctor exit-code semantics drift | Taxonomy reclassification is explicit (§7); `unsupported` remains for genuine capability absence |

---

## 13. Recommended minimal policy

> **known-good baseline + minimum capability/version + actual runtime
> probe + fail only when required behavior is absent.**

- **Node:** CI lanes keep 22.23.2. Runtime: require a present,
  answering, native-arch (darwin lane) Node ≥ the supported floor
  (evidence: ≥22.19.0); version equality becomes an informational
  doctor fact. Hard-fail only on capability absence.
- **Git:** CI lanes keep 2.45.4 (digest-pinned). Runtime: presence +
  minimum version (≥2.15 evidence floor; conservative ≥2.30) + the
  existing capability probes; pi-shuttle doctor stops hard-failing on
  version equality. Gateway-side gate relaxation is a separate Gateway
  normative decision; its binary fingerprint/revalidation/preflight
  invariants never change.
- **Pi:** 0.83.0 remains the claimed baseline; candidates accepted only
  through the committed loader probe; missing/unprobeable stays
  fail-closed.
- **Host lane:** byte-identical lane constants; `node22` treated as a
  label, not a gate; no identity formula change.
- **Doctor:** reclassify the three version-equality rows per §7.
- **No VERIFIED/UNVERIFIED state machine is introduced** — the evidence
  does not warrant one: the vocabulary already covers the needed states
  (`supported` / `installed but unverified` / `missing` / `unsupported`),
  and probe results map onto `supported` (probed known-good) vs
  `installed but unverified` (probe absent/failed), which is the
  existing closed vocabulary, not a new machine.

---

## 14. Scope exclusions honored

No Gateway authority model, MCP 9-tool surface, artifact schema,
storage architecture, APFS duplicate-object guard, remove semantics,
installer component ownership, or Linux/macOS support-claim reopening.
macOS Intel remains out of scope. No production code, contract, or
policy was modified; no commit/push made; this report is the only
artifact of this gate.

---

## 15. Report summary (per the gate's required items)

1. **Current exact-pin architecture** — §1 (full dependency graph:
   Node 22.23.2 gates install/start/add/doctor; Git 2.45.4 gates doctor
   (pi-shuttle) and Gateway lane init (hard) + fingerprint per launch;
   Pi 0.83.0 gates install/doctor; lane identity is separate).
2. **Evidence-vs-runtime classification** — §2 (Node equality: D;
   pi-shuttle Git equality: D; Gateway Git: baseline + C invariants
   (fingerprint); Pi equality: D with probeable surface; lane label: A).
3. **Node findings** — §3 (exact not required; 22.x sufficient;
   ≥22.19.0 defensible floor; no upper-bound API risk; hard = arch/
   presence/capability only).
4. **Host-lane/node22 findings** — §4 (**NO**: no security/correctness
   reason ties trusted configuration identity to Node major; label is
   opaque; but keep the string byte-identical — stores are lane-bound).
5. **Git findings** — §5 (floor ≥2.15 / conservative ≥2.30; stable
   formats; probe + minimum version is the narrowest defensible model;
   fingerprint/ownership/env/preflight invariants stay fail-closed;
   Gateway-side decision required for its equality gate).
6. **Pi findings** — §6 (surface is extension-api-v1; loader probe is
   the smallest acceptance rule; fail-closed on missing/unprobeable).
7. **Doctor taxonomy** — §7 (three version-equality rows violate the
   hard-fail principle; reclassify to WARNING/INFORMATIONAL; platform/
   arch/presence/capability rows stay hard).
8. **Install/start/bootstrap implications** — §8 (equality gates →
   capability checks; all true capability gates unchanged).
9. **Recommended compatibility policy** — §13.
10. **Contract decisions needed** — §11 (4 normative + mechanical
    inventory).
11. **Implementation inventory** — §11 MECHANICAL + §13.11: preflight
    check replacement (node), pi policy selection + probe, doctor rows,
    range/probe unit tests, contract text updates; **no change** to
    manifest pins, lane constants, or Gateway/pi-guard source.
12. **Focused test plan** — §9 matrix (alternatives probed on the
    real-stack path), plus new unit tests for range/probe/taxonomy;
    exact-lane tests retained.
13. **Lane D revised UAT implications** — §10 (native normal installs +
    probes; exact baseline repeated separately as release evidence).
14. **Security regression analysis** — §12 (no invariant weakened;
    fingerprint, lane identity, fail-closed capability gates, and
    probe-based acceptance all preserved).

**Bottom line.** The exact-version gates for Node, pi-shuttle-side Git,
and Pi are CI/evidence-baseline couplings (class D), not demonstrated
runtime requirements; the genuine invariants (native arch, binary
fingerprint, presence/capability probes, lane-bound store identity) are
separate and must not move. The simplification is well-scoped, small,
and probe-based. The one structural finding: the Gateway's own Git
equality gate and pi-guard's typed-against-0.83.0 surface require
component-side cooperation for full relaxation, so those become
normative decisions rather than pi-shuttle-only changes.

`PS-6R COMPATIBILITY SIMPLIFICATION — READY FOR HUMAN DECISIONS`
