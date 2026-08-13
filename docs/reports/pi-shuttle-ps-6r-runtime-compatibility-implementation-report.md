# pi-shuttle PS-6R — runtime compatibility simplification implementation report

Gate: `PS-6R — RUNTIME COMPATIBILITY SIMPLIFICATION IMPLEMENTATION`.
All changes left **uncommitted and unstaged** for senior review. No
publication/tag/release/deploy performed.

Baselines at implementation start (verified): pi-shuttle local == remote
== `2076575efb7e8d9d7aeaff8f4bfafb7df3e965e8` (clean tree; the PS-6R
readiness analysis report was already present untracked). Gateway local
repo `/home/chef/Documents/Project_Gateway_MCP` == public
`mfx-labs/project-gateway` == `98d1b204a864596bda91bec1104b8a8d5e89e1cd`
(pre-existing untracked WP-13D debris recorded and left untouched).
pi-guard == `7a7580cc4cbd7926797564c72269394fc29a860a` = `v0.1.2`
(untouched).

## 1. Human-approved policy (implemented verbatim)

| Dimension | Policy |
|---|---|
| Node | minimum runtime `>=22.19.0`; exact `22.23.2` = deterministic CI baseline (reporting only); native arm64 mandatory on darwin-arm64; presence/runtime-capability failures remain hard |
| Git | minimum `>=2.30.0` (pi-shuttle); exact `2.45.4` = CI baseline; Gateway executable ownership/mode/fingerprint/sanitized-environment/required-command checks remain fail-closed |
| Pi | minimum candidate `>=0.83.0`; `0.83.0` known-good; other candidates require the committed pi-guard loader/integration compatibility probe to PASS; failed required integration fails closed |
| TrustedHostLane | strings byte-identical (`…-node22`); frozen opaque protocol identifiers; no rename; no identity/store migration |
| Doctor/install/start/project-add | exact-version difference alone is never a hard failure; missing required capability or security invariant always is |
| CI | Node 22.23.2, Git 2.45.4, Pi 0.83.0 remain the exact known-good evidence versions |

## 2. Exact Node changes (pi-shuttle)

- `src/compat/versions.ts` (new): strict `major.minor.patch` parser and
  minimum comparator. Grammar is exact-numeric only; prerelease/build
  suffixes, prefixes, partial triples → `malformed` (fail closed).
- `src/compat/manifest.ts`: added `NODE_RUNTIME_MINIMUM = '22.19.0'`,
  `GIT_RUNTIME_MINIMUM = '2.30.0'`, `PI_RUNTIME_MINIMUM = '0.83.0'`;
  existing exact constants kept as the validated baselines, with a
  comment separating baseline (evidence) from requirement (runtime).
- `src/installer/preflight.ts`: `classifyNodeRuntime(version)` (pure)
  replaces exact equality; `checkNodeLane()` accepts `>=22.19.0`,
  refuses below-minimum and malformed with messages naming both the
  minimum and the validated baseline. Used by install, project add, and
  start (their call sites are unchanged — the shared function is the
  gate).
- `src/command/doctor.ts`: node row now classifies via the shared
  classifier — `supported` (>= minimum, with detected version +
  minimum + baseline in the detail), `unsupported` (below minimum),
  `installed but unverified` (malformed/unreadable). The darwin-arm64
  native-arch assertion is unchanged in substance and now applies to ANY
  version-compatible runtime (Rosetta/x64 rejection not weakened).
- CI lanes unchanged: exact 22.23.2 provisioning remains (workflows not
  touched).

## 3. Exact Git changes

### pi-shuttle
- `src/command/doctor.ts` git row: robust `git version X.Y.Z` parsing →
  `>=2.30.0` = `supported` (detail: actual version, minimum, validated
  baseline); below → `unsupported`; malformed → `installed but
  unverified`; missing → `missing` (unchanged). Presence and the
  read-only `rev-parse --git-dir` probe (project add) are unchanged.
- No Git version gate exists in install/project-add/start (as before);
  the Gateway remains the runtime authority.

### Gateway (`/home/chef/Documents/Project_Gateway_MCP`, public HEAD)
- `src/git/host-lane.ts`: `initializeGitHostLane` now parses
  `git version x.y.z` strictly (`parseGitVersion`) and requires
  `>= 2.30.0` (`satisfiesGitMinimum`); malformed output and below-minimum
  both fail closed with the existing `wrong-version` code; descriptor
  `version` now records the DETECTED triple (truthful) instead of a
  hardcoded constant. The validated baseline 2.45.4 remains the CI
  provision.
- **Unchanged security invariants**: canonical absolute path, owner
  (root or uid), mode (not group/world writable), dev/ino/mode/size/
  mtime/SHA-256 fingerprint captured at init and revalidated before
  every launch, sanitized child env, repository preflight, no-shell
  execution, command set and output formats untouched.

## 4. Exact Pi changes

- `src/installer/preflight.ts`: `classifyPiVersion` now returns
  `supported` (exactly 0.83.0), `candidate` (any valid version
  >= 0.83.0 other than the baseline), `not-supported-lane` (< 0.83.0),
  `malformed`, or `missing`. Production policy
  `PI_RUNTIME_POLICY = 'probe-candidates'` (replaces the old
  refuse-non-baseline constant; `refuse-non-baseline` retained as the
  conservative alternative for tests). `allow-unverified` is removed —
  superseded by probe-based acceptance (never unverified acceptance).
- `src/compat/pi-guard-probe.ts` (new): the committed compatibility
  probe, usable as a module and as a CLI (ships in `dist`). Verifies
  through pi's OWN extension loader: zero load errors, factory runs,
  `guard` command registered, AND the required event surface
  (`session_start`, `session_shutdown`, `before_agent_start`,
  `tool_call`) — `/guard` textual presence alone is not the proof. The
  load-time tool registry is reported but not required (pi-guard
  registers its git-inspect tool lazily at session-start ownership
  determination — by design). `resolvePiLoaderFromBin` resolves pi's
  loader from the pi executable, failing closed on any other layout.
- `src/installer/components.ts` + `install.ts`: for a candidate pi, the
  probe runs against the ACTIVATED pi-guard package dir BEFORE any
  external `pi install` mutation. Probe FAIL → install FAILED (rolled
  back, no Pi-side mutation); loader not locatable → REFUSED before any
  mutation; probe PASS → install proceeds; the receipt notes record the
  probe result.
- `src/command/doctor.ts`: pi row — 0.83.0 `supported` (known-good);
  candidate → probe (injectable seam, default = the compiled probe
  spawned through the running node): PASS → `supported` (detail names
  candidate + probe result), FAIL → `unsupported` (exit 2), probe
  infrastructure unavailable → `installed but unverified` (exit 1);
  below minimum → `unsupported`; malformed → `installed but unverified`;
  missing → `missing`.
- `scripts/pi-extension-load-probe.mjs` is now a thin CI delegate to the
  compiled probe (single source of truth; same env contract and exit
  codes).

## 5. Host-lane non-change (PS-6R §3)

`linux-x86_64-posix-utf8-node22` and `darwin-arm64-posix-utf8-node22`
are byte-identical in both pi-shuttle (`src/host/environment.ts`) and
the Gateway (`src/trusted/host-lane.ts`). No node24/node25 lanes, no
derivation from `process.version`. Documented in code comments: the
`node22` label is a frozen protocol identifier for backwards-compatible
configuration/store identity, not an exact runtime-version assertion.
Regression test added proving the mapping is pure and version-free
(`tests/unit/runtime-compat.test.ts`). No identity digest/oracle change:
Gateway POUV2 (232), conformance digest vectors (17), and trusted/
identity (576) suites all pass with zero failures.

## 6. Doctor taxonomy changes

| Row | Before | After |
|---|---|---|
| node | exact 22.23.2 → supported; else unsupported (exit 2) | >= 22.19.0 → supported (detail: version, minimum, baseline); below → unsupported; malformed → installed but unverified; darwin native-arm64 assertion unchanged |
| git | exact 2.45.4 → supported; else unsupported | >= 2.30.0 → supported (detail: version, minimum, baseline); below → unsupported; malformed → installed but unverified; missing unchanged |
| pi | exact 0.83.0 → supported; else unsupported | 0.83.0 → supported (known-good); candidate >= 0.83.0 → probe PASS supported / probe FAIL unsupported / probe-unrunnable unverified; below → unsupported; missing unchanged |
| platform/arch/receipt/gateway/pi-guard/config/projects/git-isolation/locks | unchanged | unchanged (capability/state-based) |

Verified live on this host: `doctor` exit 0 with node 22.23.2, git
2.45.4, and the REAL pi 0.84.1 candidate passing the real probe through
pi's own loader.

## 7. Consistency across install / project add / doctor / start

All four boundaries consume the ONE shared classifier
(`checkNodeLane`/`classifyNodeRuntime`); no exact-equality gate remains
anywhere in `src` (the baseline constants appear only in reporting
text). Structural + behavioral consistency tests pin this
(`tests/unit/runtime-compat.test.ts`): identical runtime facts cannot
produce different verdicts across boundaries. Installer probe flow
tested end-to-end with a fake loader (FAIL → rolled back, no Pi
mutation; PASS → COMPLETE with receipt note).

## 8. Exact CI baselines retained

No workflow was changed. Lane A/B keep exact Node 22.23.2 (SHA-pinned,
arch-asserted), digest-pinned Git 2.45.4, and isolated Pi 0.83.0. The
real-stack evidence path now exercises the SAME committed probe
(compiled) through the CI delegate; verified locally against real
pi 0.83.0 + installed pi-guard: `PASS — guard command + required events
(session_start, session_shutdown, before_agent_start, tool_call)
verified through pi's own loader`.

## 9. Focused test results

pi-shuttle (`npm test`): **227 tests, 224 pass, 0 fail**, 3 truthful
darwin-only skips. New/updated tests:
- `tests/unit/runtime-compat.test.ts` (new): version triple edges; node
  boundaries (22.18.x reject, 22.19.0 accept, 22.23.2 accept/known-good,
  newer 22.x accept, newer major accept, malformed reject); git
  boundaries (2.29.x reject, 2.30.0 accept, 2.45.4 accept, newer accept,
  malformed reject); host-lane frozen-identifier regression; four-boundary
  consistency.
- `tests/unit/installer-preflight.test.ts`: node classification
  boundaries; pi classification (candidate/malformed/below); both
  policies.
- `tests/unit/doctor.test.ts`: node/git/pi rows reclassified; candidate
  probe PASS/FAIL/unrunnable via the injectable seam; newer-git healthy;
  below-minimum unsupported.
- `tests/unit/installer-flow.test.ts`: candidate with unlocatable loader
  → REFUSED; candidate probe FAIL → FAILED with rollback and no Pi
  mutation; probe PASS → COMPLETE with receipt note.
- `tests/unit/static-guard.test.ts`: allowlists extended for the new
  probe module (fs imports; env at the process boundary); zero-dep and
  exec-confinement guards still green.
- typecheck, `npm ci --dry-run`, `git diff --check`: all clean.

Gateway (`Project_Gateway_MCP`): build + typecheck clean;
`tests/wp7/git/git.test.js` **41/41 pass** including the new version
policy block: 2.29.x rejected, 2.30.0 accepted, 2.45.4 accepted,
2.50.1 accepted, malformed rejected, same-version fingerprint mutation
rejected, newer-version unsafe binary (world-writable) rejected;
`tests/wp7/security/security.test.js` pass (fingerprint/mutation/
preflight invariants); directly affected inspection suites
(`mcp/unit/changes`, `runtime/wp14b-e2e`) pass; **POUV2 232/0,
conformance digest vectors 17/0, trusted/identity 576/0** — no identity
or digest change.

## 10. Source files changed

pi-shuttle (all uncommitted/unstaged):
- Modified: `src/installer/preflight.ts`, `src/installer/install.ts`,
  `src/installer/components.ts`, `src/command/doctor.ts`,
  `src/compat/manifest.ts`, `scripts/pi-extension-load-probe.mjs`,
  `docs/installation-contract.md`, `docs/operator-cli-contract.md`,
  `docs/platform-support-contract.md`, `tests/unit/doctor.test.ts`,
  `tests/unit/installer-flow.test.ts`,
  `tests/unit/installer-preflight.test.ts`,
  `tests/unit/static-guard.test.ts`.
- Added: `src/compat/versions.ts`, `src/compat/pi-guard-probe.ts`,
  `tests/unit/runtime-compat.test.ts`.
- Untracked (pre-existing, untouched): the PS-6R readiness analysis
  report.

Gateway (all uncommitted/unstaged):
- Modified: `src/git/host-lane.ts`, `tests/wp7/git/git.test.ts`.
- Untracked (pre-existing WP-13D debris, untouched).

pi-guard: no changes (verified at `7a7580cc…` = `v0.1.2`, clean).

## 11. Security invariants preserved

- Gateway git binary fingerprint (dev/ino/mode/size/mtime/SHA-256)
  revalidated before every launch — unchanged; only the version string
  comparison was relaxed, and it remains fail-closed on malformed and
  below-minimum output.
- Git ownership/mode/path/preflight/sanitized-env/no-shell checks —
  unchanged.
- Native arm64 Node requirement on darwin-arm64 — unchanged (doctor +
  CI); Rosetta/x64 rejection not weakened.
- Platform lane membership (Linux x86_64, darwin arm64; macOS Intel
  unsupported) — unchanged.
- Pi missing/unprobeable/failed-probe — fail closed (install REFUSED/
  FAILED with rollback; doctor unsupported/unverified). Unprobed
  candidates are never claimed compatible.
- Trusted host-lane strings, configuration identity, store replay
  behavior, APFS dev+ino duplicate-object guard, Gateway 9-tool MCP
  surface, pi-guard enforcement, project remove deregister-only
  semantics — untouched; POUV2/conformance/identity digest vectors
  unchanged (proven by the suites above).

## 12. Lane D implications

A physical Apple Silicon UAT can now use a normal native Node
(>= 22.19.0, arm64), the operator's normal Git (>= 2.30.0) where
available, and a current compatible Pi (>= 0.83.0, probe-passed) instead
of manually recreating exact CI versions. The exact baseline stack
(22.23.2 / 2.45.4 / 0.83.0) is still repeated separately on the release
lane as evidence. Lane D still records: volume facts, canonical paths,
UID behavior, quarantine, git origin/version, node origin/version/arch,
pi version + probe result.

## 13. Git status of all component repos

- pi-shuttle: HEAD `2076575efb7e8d9d7aeaff8f4bfafb7df3e965e8` (local ==
  remote); changes uncommitted/unstaged (list in §10).
- Gateway (local): HEAD `98d1b204a864596bda91bec1104b8a8d5e89e1cd` ==
  public HEAD; changes uncommitted/unstaged; pre-existing untracked
  WP-13D debris untouched.
- pi-guard: HEAD `7a7580cc4cbd7926797564c72269394fc29a860a` = `v0.1.2`;
  clean; untouched.

## 14. Regression boundaries verified

Supported OS set (Linux x86_64, macOS arm64) unchanged; macOS Intel
unsupported; trusted lane strings byte-identical; configuration
identity unchanged; store replay unchanged; APFS duplicate-object guard
unchanged; Gateway 9-tool MCP surface unchanged (real-stack MCP probe
still 9/9); pi-guard enforcement unchanged (probe verifies the same
surface); remove semantics unchanged. No POUV2/identity/conformance
digest changed.

`PS-6R IMPLEMENTATION — READY FOR SENIOR REVIEW`
