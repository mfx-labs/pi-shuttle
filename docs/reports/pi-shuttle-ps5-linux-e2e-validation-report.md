# PS-5 — pi-shuttle Linux End-to-End Validation Report

**Gate type:** E2E evidence / validation (no production changes).
**Status of this gate's artifacts:** uncommitted, unstaged; no push/tag/
publication/remote; the only repository file created is this report.

---

## 1. Gate objective

Prove the complete supported Linux x86_64 local product flow on the
validated lane through PUBLIC/OPERATOR surfaces only: fresh user
environment → exact artifacts → installer → Gateway → pi-guard on an
isolated Pi 0.83.0 lane → receipt → project add → re-add → list → doctor
→ start → real MCP stdio runtime → public tool surface → bounded project
interaction → confinement negatives → remove → re-add → installer rerun →
failure scenarios → audits → source-repo integrity.

## 2. Source baselines

| Repo | Expected | Observed | Status |
|---|---|---|---|
| pi-shuttle | `edccd9e3f9e5d3a378a6ccb9fa00f0f43f160ccd` (`feat: establish pi-shuttle PS-4 project lifecycle`) | identical | ✓ |
| Gateway | `7f3b4afdb43704e7dac82da7b086d8367347c641` | identical | ✓ |
| pi-guard | `v0.1.2` @ `7a7580cc4cbd7926797564c72269394fc29a860a` | identical | ✓ |

External repos were read-only (see §24/§25 for end-state verification).
Pre-existing untracked debris (Gateway WP-13D files, pi-guard v0.1.1
review docs) recorded separately and never touched.

## 3. Host lane (validated evidence lane)

| Fact | Observed | Contract lane | Match |
|---|---|---|---|
| OS | Linux (kernel x86_64, ext4 root, /tmp on ext) | Linux | ✓ |
| Architecture | x86_64 | x86_64 | ✓ |
| Node | v22.23.2 (`node --version`) | 22.23.2 | ✓ |
| npm | 10.9.8 | contract-approved exact evidence (not manifest-pinned; recorded) | ✓ |
| Git | 2.45.4 (`/home/chef/.local/git-2.45.4/bin/git`, PATH-discovered) | 2.45.4 | ✓ |
| Pi (host) | 0.84.1 at `/home/chef/.local/share/pi-node/.../bin/pi` | NOT a claimed lane | — |
| User | uid 1000 (`chef`), non-root | per-user install | ✓ |
| pi-shuttle state on host | none (`~/.config/pi-shuttle`, `~/.local/state/pi-shuttle`, `~/.local/share/pi-shuttle` all absent) | zero-state | ✓ |
| Real Pi store | `~/.pi/agent/settings.json` untouched (no pi-guard entry; mtime predates this gate) | no real-Pi mutation | ✓ |

**Pi lane:** host Pi 0.84.1 was NEVER used as evidence. An isolated
Pi 0.83.0 lane was created (see §9).

## 4. Isolation model

- PS-5 root: `/tmp/pi-shuttle-ps5-e2e/` (outside all product repos;
  disposable; chmod 700).
- Isolated `HOME` = `$PS5ROOT/e2e-home` — zero-state proven before
  install (0 files; no `~/.local`, no `.pi`, no pi-shuttle state).
- Isolated `PATH` = `<ps5root>/pi-lane/node_modules/.bin` (pi 0.83.0)
  + host node/git/tar/npm.
- Isolated Pi config: pi 0.83.0 writes `$HOME/.pi/agent/settings.json`
  — inside the isolated HOME only.
- Project roots, installer staging, bin dir, Git HOME/TMP: all under the
  PS-5 root.
- Real operator HOME, real Pi store, source repos: never targeted.

## 5. Exact artifacts and SHA-256

Built from CLEAN temporary clones at the frozen baselines (Gateway and
pi-guard clones verified: pinned HEAD, zero tracked changes; `dist/` is
gitignored in Gateway, so the clone was built with the repository's own
`npm ci` (exact lockfile) + `npm run build`).

| Artifact | Source | Members | SHA-256 |
|---|---|---|---|
| `pi-shuttle-0.1.0.tgz` | pi-shuttle `edccd9e…` (`npm run build` + `npm pack`) | 54 (dist/ + package.json) | `1fc9435c6dfb24167facd31580b9435903f45e98d2dbef96dfdab0c246f047fe` |
| `project-gateway-artifact-core-0.1.0.tgz` | Gateway `7f3b4af…` clean clone, `npm ci` + `npm run build` + `npm pack` | 507 (506 dist/ + package.json) | `d37c598f5685e5f66d7c8a580003631423bdf5b36c5b85bc98925e4778aa395c` |
| `pi-guard-0.1.2.tgz` | pi-guard `7a7580cc…` = v0.1.2 clean clone, `npm pack` | 12 (src/, extensions/pi-guard/index.ts, package.json, LICENSE, README) | `057f1b636328e8c77857a4b590d051fcc52c0c9b015ca5dd1a773c21d7d24d01` |

Package identities verified by the installer against the exact pins:
`@project-gateway/artifact-core@0.1.0` (bin `./dist/runtime/mcp/cli.js`),
`pi-guard@0.1.2` (extension entry `extensions/pi-guard/index.ts`),
`pi-shuttle@0.1.0` (bin `./dist/cli.js`). Nothing published; tarballs
exist only under the PS-5 root.

## 6. Dependency materialization

PS-3's recorded release dependency (Gateway `installed-unverified`
without deps) was resolved for this lane WITHOUT any production change:

- The installer's first run activates the Gateway package and classifies
  it `installed-unverified` (bin smoke cannot find modules) — truthful,
  as designed.
- Materialization (release-pipeline step, contract §5.4's "pinned npm
  install … into packages/…"): `npm install --no-save --omit=dev
  --prefix <packages>/project-gateway-artifact-core@0.1.0
  @modelcontextprotocol/server@2.0.0 ajv@8.20.0 zod@4.4.3`
  (EXACT contract pins; no floating versions).
- Resolved tree (recorded via `npm ls`): `@modelcontextprotocol/server@2.0.0`
  (+ `@modelcontextprotocol/core@2.0.0`), `ajv@8.20.0` (fast-deep-equal,
  fast-uri, json-schema-traverse, require-from-string), `zod@4.4.3`
  (deduped). Registry network access was available; no source changes.
- Post-materialization the Gateway `--help` smoke exits 0 and the
  installer re-run records `installed-verified`.

This is evidence-lane packaging, not a pi-shuttle code change; a later
release gate should fold this step into the release pipeline.

## 7. Installer command/result

Primary lane (batch, explicit selections, explicit expected digests):

```
HOME=$PS5ROOT/e2e-home PATH=<isolated pi-0.83.0 bin>:<host PATH> \
  bash /home/chef/Documents/pi-shuttle/install.sh \
  --batch --gateway yes --pi-guard yes \
  --artifact-dir $PS5ROOT/artifacts \
  --expect-gateway-sha256 d37c598f… \
  --expect-pi-guard-sha256 057f1b63…
```

- Run 1: `result: PARTIAL INSTALLATION` (exit 1) — gateway activated but
  `installed-unverified` (dependency materialization pending; truthful
  note). pi-guard already `installed-verified`.
- Materialization (§6), then **Run 2: `result: COMPLETE` (exit 0)** —
  gateway `installed-verified`, smoke `passed`.

Interactive smoke lane (fresh fixture, piped answers yes/yes/defaults/no):
prompts consumed correctly, install proceeded, truthful PARTIAL
pre-materialization, no silent defaults. (The interactive lane was not
re-run post-materialization; the batch lane is the primary acceptance
path.)

## 8. Receipt evidence (final state)

`~/.local/state/pi-shuttle/install.json` — mode 0600:
- `result: "COMPLETE"`, `platformLane: "linux-x86_64-posix-utf8-node22"`;
- gateway: `status "installed-verified"`, `version 0.1.0`,
  `commit 7f3b4af…`, **`digestVerified: true`**,
  `artifactSha256 d37c598f…`, `smoke "passed"`, binPath
  `packages/project-gateway-artifact-core@0.1.0/dist/runtime/mcp/cli.js`;
- piGuard: `status "installed-verified"`, `version 0.1.2`,
  `commit 7a7580cc…`, **`digestVerified: true`**,
  `artifactSha256 057f1b63…`, `piVersion "0.83.0"`, `verifiedBy "pi-list"`.
- All pi-shuttle layout dirs 0700; bin link
  `~/.local/bin/pi-shuttle` → `<repo>/dist/cli.js` (local-lane design;
  see finding PS5-LINUX-001).

## 9. pi-guard installation evidence (isolated Pi 0.83.0 lane)

- Lane: `@earendil-works/pi-coding-agent@0.83.0` npm-installed into
  `$PS5ROOT/pi-lane`; `pi --version` = `0.83.0`; config store
  `$HOME/.pi/agent/settings.json` (isolated HOME).
- Installer ran `pi install <packages>/pi-guard@0.1.2` (exact source);
  `pi list` resolved the exact absolute source line
  `/tmp/pi-shuttle-ps5-e2e/e2e-home/.local/share/pi-shuttle/packages/pi-guard@0.1.2`
  → exact-line confirmation (`piListConfirmsSource`), no substring
  false-positive possible; receipt `installed-verified`, `verifiedBy:
  pi-list`.
- **Extension load proof (pi 0.83.0's own loader):** a test-only probe
  imported pi 0.83.0's `loadExtensions` (jiti + bundled-module aliases)
  against the installed extension entry
  `packages/pi-guard@0.1.2/extensions/pi-guard/index.ts`:
  `load errors: NONE`, `registered commands: ['guard']` — module import,
  factory execution, and command registration all succeed under pi
  0.83.0. The bounded `pi -p …` startup probe (isolated lane) reached
  session start and failed only at provider auth (no API key in the
  isolated lane) with no extension-load error — pi-guard's presence does
  not break Pi startup. Not a pi-guard regression suite (out of scope).

## 10. Project fixture

`$PS5ROOT/projects/alpha`: `git init`, one committed file (`README.md`,
commit `2a4b8eb`), sentinel inventory recorded; no `.pi`, no Gateway
trusted state, no pi-shuttle registration pre-existing.

## 11. `project add` (real installed stack)

`pi-shuttle project add $PS5ROOT/projects/alpha` → exit 0,
`state: initialized`. Verified:
- identity independently recomputed: `storeId = sha256(canonicalRoot)
  .hex.slice(0,32) = 3e0a2cd6070aa9fe55722bc84731ce3e` (match);
  workspace `pgw:w:3e0a2cd…`, surface `pgw-3e0a2cd…`;
- runtime config `~/.config/pi-shuttle/runtime.json` (0600): one surface,
  locator `stores/3e0a2cd…`, `forbiddenRoots=[root]`, `configurationVersion
  "2"`, `configurationIdentity sha-256:73a3f792…` (produced by the real
  Gateway bootstrap verb — pi-shuttle never computes it), `gitPath`
  = discovered `/home/chef/.local/git-2.45.4/bin/git`,
  `gitHome`/`gitTmpdir` under `share/git-home|git-tmp/<storeId>`;
- trusted store created by the Gateway: `store-v1/{metadata,tmp}` +
  `config-v1/{metadata,tmp}` (metadata 0600, parents 0700) — exactly the
  initialization contract shape; no `records/`/`audit/`/`locks/`/
  `index/`/`quarantine/`;
- project contents: only `artifacts/` added (README untouched);
- Git isolation dirs present, empty, 0700.

## 12. Exact re-add

`project add <same>` → exit 0, `project already registered (exact
replay; no registry change)`, `state: verification-replay`; store
metadata **byte-identical**; registry still exactly 1 surface; no new
store identity.

## 13. `project list`

One deterministic line: workspaceId, canonical root, surface id, store
locator; exactly once; no health claims; `no registered projects` (exit
0) after removal.

## 14. `doctor` (healthy state)

Full output recorded (exit **0**): platform supported; node 22.23.2
supported; git 2.45.4 supported (PATH-discovered); **pi 0.83.0 supported
(isolated lane)**; receipt supported (0600); gateway component supported
(identity + `--help` smoke); pi-guard supported (exact source in
`pi list`); runtime config supported (0600); both registered projects
supported (root resolves, store present); git isolation supported ×2;
coordination locks supported (none present). PS-7 tunnel/ChatGPT notes
present as designed (non-finding).

## 15. Real `start` / MCP handshake

Test-only harness spawned `pi-shuttle start` (piped stdio → the Gateway
child inherits the same pipes) and performed a full MCP exchange through
the REAL installed Gateway (`@modelcontextprotocol/server@2.0.0`,
newline-delimited JSON-RPC, modern protocol era):
- `initialize` → response with `serverInfo
  {name:"@project-gateway/artifact-core",version:"0.1.0"}`, negotiated
  protocolVersion;
- `tools/list` → **exactly the 9-tool closed set**;
- `inspect-registry` round-trip → `ok:true`;
- EOF → clean exit 0.
**10/10 probe assertions passed**, twice (mid-flow and final state).
Protocol-clean stdout verified at byte level: every stdout line is a
JSON-RPC line; zero pi-shuttle prefix/banner; stderr empty during the
exchange. (Harness used `node <dist/cli.js>` — see PS5-LINUX-001 for why
direct bin exec was unavailable.)

## 16. Tool-surface evidence

Exactly: `validate-artifact, inspect-stored-record, inspect-registry,
inspect-audit-history, verify-record, enumerate-class, draft-artifact,
persist-artifact, inspect-changes`. No bootstrap/admin/lifecycle/
approval/issue/activate/receipt/grant/shell/exec tool exposed
(asserted by regex on the live inventory).

## 17. Bounded project interaction (real Gateway)

13/13 harness assertions passed against the live chain:
- `inspect-changes` (clean repo): `changedFiles: []`, `changedFileCount:
  0` — read-only real Git lane;
- `validate-artifact` (canonical TaskSpec fixture): `valid:true`,
  kind/instance/revision/digest echoed;
- `draft-artifact`: `ok:true, valid:true` with canonical proposal;
- `persist-artifact`: `ok:true`, persisted evidence —
  `instanceId pgw:i:9e74f09cf0287d6787d69e8ebddb5157` (matches fixture),
  `digest sha-256:b6418a37…`, `relativeDestination
  TaskSpec.pgw:i:…pgw:r:….json` (workspace-relative),
  `transition missing-to-file`, `persistedByteCount 755`;
- proposal file landed at `<root>/artifacts/TaskSpec….json` (0600,
  canonical form) — operation stayed inside the configured workspace;
- no approval/activation/issue/shell vocabulary in any response;
- store metadata byte-identical after the flow (registry/store untouched
  by persist, per the WP-14B design);
- re-persist of the same destination → `write-denied` (TAD-039
  target-exists) — fail-closed no-overwrite (incidental negative).

## 18. Confinement negatives (real stack)

- MCP surface (4/4): unregistered surface → `ok:false not-found`;
  unknown stored record → `ok:false invalid-request`; unsupported
  artifact kind → `unsupported-artifact-kind`; artifact with
  `workspace_binding.root: "/etc"` → refused (`valid:false`, typed
  findings) — no out-of-workspace access.
- CLI surface (throwaway fixtures): foreign/malformed runtime config →
  `ERR-PS4-START-CONFIG-INVALID`, exit 1, zero stdout bytes (no child);
  locator present + store-v1 missing → `ERR-PS4-START-STORE-V1-MISSING`,
  exit 1, no child, store-v1 NOT created; pre-held `project.lock` →
  `ERR-PS4-BUSY` (21 attempts, stale guidance), nothing mutated;
- Unsupported Pi lane (separate fixture, pi 0.84.1 on PATH): installer
  **REFUSED** (exit 2, "no installation changes were finalized", no
  receipt written); `doctor` reports pi `unsupported` → exit 2.
- None of these touched the healthy primary environment.

## 19. `project remove`

`pi-shuttle project remove pgw:w:3e0a2cd…` → exit 0,
`deregistered …`, "trusted store preserved at …", "project directory and
Git history untouched". Verified: registry 0 surfaces; store metadata
byte-identical; `README.md`, `.git`, `artifacts/` (incl. the persisted
TaskSpec file) all present; `pi list` still shows pi-guard (install
unchanged); `project list` → `no registered projects`, exit 0.

## 20. Re-add after remove

`project add <same>` → exit 0, `state: verification-replay`; same
workspace/surface identity; same locator; store metadata byte-identical
(replay, no recreation); `configurationIdentity` unchanged; registry 1
surface; doctor healthy again (exit 0, 11 supported checks).

## 21. Installer rerun

Identical batch command on the live installation → **COMPLETE, exit 0**;
store metadata and runtime config byte-identical; pi extension entries
not duplicated (still the single pi-guard source); receipt
`installedAt` legitimately refreshed (00:29:27 → 00:37:58); components
re-verified `installed-verified`.

## 22. Failure recovery scenarios

- **F1 digest mismatch** (gateway expectation `aaa…64`): FAILED at stage
  "gateway" — computed vs expected digest in message; no receipt written;
  no activation (packages dir empty).
- **F2 foreign component directory**: FAILED at stage "gateway" —
  "existing gateway installation … has incompatible identity; refusing
  to touch it"; foreign file preserved verbatim.
- **F3 foreign receipt** (piShuttleVersion 9.9.9): REFUSED — "refusing
  to modify foreign installation state"; receipt preserved byte-for-byte.
- **F4 pre-held `install.lock`**: REFUSED with BUSY message (21
  attempts), lock not auto-deleted.
- **F5 bootstrap residual (REAL Gateway)**: with `runtime.json` blocked
  by a directory, `project add beta` → Gateway bootstrap SUCCEEDED
  (real store `stores/d40096072ea45884a3806c1560d0955b/store-v1`
  initialized) then registration failed
  (`ERR-PS2-CONFIG-READ (EISDIR)` → `ERR-PS4-REGISTER-FAILED`) with the
  truthful residual message: store "was initialized by the Gateway and is
  PRESERVED … re-run `pi-shuttle project add …`". Unblock → re-run →
  `state: verification-replay`, exit 0, registry 2 surfaces. Store
  preserved throughout; no rollback of Gateway state.

## 23. Permissions / confinement audit (final state)

- `install.json` 0600; `runtime.json` 0600; store metadata (both
  namespaces, both projects) 0600; store parents + `store-v1` + git
  isolation dirs 0700; all pi-shuttle layout dirs 0700; artifacts dirs
  0700; proposal file 0600.
- No lock artifacts at steady state (0 `.lock` files).
- No group/world-writable sensitive operator state (the only
  group-writable files found: pi's own `$HOME/.pi/agent/settings.json`
  in the isolated lane — pi-owned, not pi-shuttle state).
- **Deviation:** component package dirs (`packages/*@*/`) are 0775 and
  files 0644 — the npm-pack artifact shape (npm pack on this host emits
  dir members 0775), preserved by extraction; the pi-guard dir was never
  touched by npm yet is equally 0775, confirming the artifact shape is
  the cause. Mitigation: the parent `packages/` is 0700, so no group
  access path exists; doctor's contract checks do not cover package-dir
  modes. Recorded as PS5-LINUX-002 (optional hardening).
- **Deviation (defect):** `~/.local/bin/pi-shuttle` is a symlink to
  `dist/cli.js` which is built 0644 (non-executable) → direct bin exec
  fails with EACCES (126). Recorded as PS5-LINUX-001 (CRITICAL).

## 24. Mutation audit

Isolated HOME before/after: zero-state → final inventory confined to
`e2e-home/.local/{share,state,config,bin}/pi-shuttle` (approved layout),
`e2e-home/.pi` (isolated pi settings + auth.json from the bounded startup
probe), and the bin symlink. Projects: only `artifacts/` added (alpha:
1 proposal file; beta: empty artifacts dir). No mutation in: source
repos, real HOME, real Pi store, system dirs, other projects.

## 25. Source-repo integrity (end)

- pi-shuttle: HEAD `edccd9e3f9e5d3a378a6ccb9fa00f0f43f160ccd`, working
  tree clean except this report (uncommitted, unstaged — §29).
- Gateway: HEAD `7f3b4af…`; untracked = the 4 pre-existing WP-13D
  entries (identical to gate start; untouched).
- pi-guard: HEAD `7a7580cc…` = v0.1.2; untracked = the 8 pre-existing
  v0.1.1 review docs (identical to gate start; untouched).
- No production source modified anywhere; no real Pi mutation; no
  network beyond the npm registry for pinned deps; no sudo.

## 26. Existing test-suite result (pi-shuttle)

- `npm test`: **184 run / 184 pass / 0 fail / 0 skip** (matches the
  PS-4 baselined total).
- `npm run typecheck`: clean. `npm ci --dry-run`: green.
  `git diff --check`: clean.
- Gateway/pi-guard broad suites NOT re-run (out of scope); the real
  Gateway was exercised black-box through the product (§15–§17).

## 27. Findings

### PS5-LINUX-001 — CRITICAL — PRODUCT / INTEGRATION — installed `pi-shuttle` bin is not executable
- **Stage:** post-install, first operator invocation (§7).
- **Reproduction:** fresh install → `~/.local/bin/pi-shuttle --version`
  → `env: 'pi-shuttle': Permission denied` (exit 126). `dist/cli.js` is
  built 0644 (`-rw-rw-r--`); the installer bin link points at it; the
  shebang requires +x. The npm-pack tarball preserves 0644
  (`tar -tvzf pi-shuttle-0.1.0.tgz` → `package/dist/cli.js` 0644), so a
  release-shaped install has the same defect. Gateway is unaffected (its
  bin is always invoked via `node <bin>` by pi-shuttle; the installer
  smoke does the same).
- **Observed vs expected:** 126 + EACCES vs. a working `pi-shuttle`
  entry; the PS-4 suite never exec'd the bin link directly, so this
  never surfaced before.
- **At fault:** existing implementation (build/installer bin-link path),
  not the release packaging alone.
- **Smallest correction (later focused-correction gate):** make the
  built CLI executable — e.g., `chmod +x dist/cli.js` in `npm run build`
  (and/or normalize the mode when creating the bin link) — plus a
  regression test that execs the installed bin link directly. Inside the
  pi-shuttle source envelope; NOT performed in this gate.
- **E2E impact:** the direct bin-exec acceptance point fails; all other
  criteria were validated through the byte-equivalent operator surface
  `node <dist/cli.js>` (exactly what the shebang would exec).

### PS5-LINUX-002 — MINOR — OPTIONAL HARDENING — npm-pack component dirs activate as 0775
- **Stage:** post-install permissions audit (§23).
- **Detail:** `packages/*@*/` dirs 0775 / files 0644 (npm-pack artifact
  shape on this host; pi-guard dir, never touched by npm install, is
  equally 0775). Parent `packages/` is 0700 → no group access path;
  no contract check violated (doctor covers store/config/receipt/
  isolation, not package-dir modes).
- **Correction (optional, later gate):** normalize component dirs to
  0700 at activation. Not a blocker.

### PS5-LINUX-003 — MINOR — EVIDENCE / DOCUMENTATION — dependency materialization is a manual release-pipeline step
- **Detail:** §6's `npm install --prefix` step is required between
  installer runs for `installed-verified`; the installer itself
  truthfully reports `installed-unverified` without it. Recorded as an
  unresolved release dependency (contract §5.4's "pinned npm install"
  step) for the release gate, not a pi-shuttle defect.

No other findings. No CRITICAL security or data-integrity issues;
fail-closed behavior held at every adversarial point exercised.

## 28. Unresolved release dependencies

- Gateway dependency materialization step must be folded into the
  release pipeline (§6, PS5-LINUX-003).
- pi-shuttle bin executability fix (PS5-LINUX-001) before any release
  artifact distribution.
- Public installer URL / artifact hosting / pi-guard distribution
  authorization (unchanged external gates).
- Lane A final evidence on a Pi 0.83.0 host (this gate used an isolated
  Pi 0.83.0 lane; the operator host remains 0.84.1 — P3A-WP15-006
  unchanged).

## 29. Exact Git status (end of gate)

`/home/chef/Documents/pi-shuttle` (`master`, HEAD `edccd9e3…`):
- `?? docs/reports/pi-shuttle-ps5-linux-e2e-validation-report.md`
  (this report — uncommitted, unstaged; nothing else changed).
Gateway and pi-guard: no tracked changes; pre-existing untracked debris
unchanged. No remotes configured on pi-shuttle; no push/tag/publication.

## 30. Acceptance criteria and final verdict

| # | Criterion | Result |
|---|---|---|
| 1 | exact artifacts from frozen baselines | **PASS** |
| 2 | exact digests verified (`digestVerified: true` both) | **PASS** |
| 3 | installer COMPLETE (primary batch lane) | **PASS** |
| 4 | Gateway installed-verified | **PASS** |
| 5 | pi-guard installed-verified on supported Pi 0.83.0 lane | **PASS** (isolated lane; extension load proven) |
| 6 | project add succeeds | **PASS** |
| 7 | exact re-add idempotent | **PASS** |
| 8 | project list coherent | **PASS** |
| 9 | doctor exit 0 | **PASS** |
| 10 | pi-shuttle start reaches real Gateway MCP runtime | **PASS** (10/10 harness) |
| 11 | protocol stdout clean | **PASS** (byte-level) |
| 12 | expected Gateway public tool surface | **PASS** (exactly 9) |
| 13 | bounded real project interaction | **PASS** (13/13) |
| 14 | remove is deregister-only | **PASS** |
| 15 | store/history/project preserved | **PASS** |
| 16 | re-add after remove reuses trusted store | **PASS** |
| 17 | installer rerun safe | **PASS** |
| 18 | failure scenarios fail closed | **PASS** (F1–F5, NEG-A/B/C, MCP negatives 4/4, unsupported Pi lane) |
| 19 | permissions/confinement audit | **FAIL** — one deviation: installed `pi-shuttle` bin not executable (PS5-LINUX-001); package-dir 0775 recorded as optional hardening (PS5-LINUX-002) |
| 20 | source repos unchanged | **PASS** |

Criterion 19 fails on a real implementation defect (PS5-LINUX-001) that
blocks the primary operator surface after installation. Per the gate
rules, the failure is not reinterpreted as accepted evidence: the defect
is reproduced, classified, and the affected scenario (direct bin exec)
is recorded as stopped, with the smallest correction specified for a
later focused-correction gate. Every other mandatory criterion passed on
the real installed stack.

`PS-5 LINUX E2E — CORRECTIONS REQUIRED`
`PS-5 LINUX E2E — CORRECTIONS REQUIRED`

---

## 31. Focused correction gate — PS5-LINUX-001 (executable mode)

Recorded after the PS-5 original run. The original failed evidence above
(§7/§23/§27) is preserved unchanged; this section records the focused
correction and its evidence. PS-5 remains `CORRECTIONS REQUIRED` at this
stage — the verdict changes only after a later PS-5 focused E2E
revalidation against the NEW committed correction SHA.

### 31.1 Original reproduction (preserved, §27)

- clean build produces `dist/cli.js` mode 0644;
- npm-pack release-shaped artifact preserves the non-executable mode
  (`package/dist/cli.js` 0644, original tarball SHA `1fc9435c...`);
- installed `~/.local/bin/pi-shuttle` symlink points to that file;
- direct invocation fails `EACCES` / exit 126;
- the same JavaScript surface succeeds when invoked explicitly through
  `node dist/cli.js`.

### 31.2 Root cause

`npm run build` ran only `tsc -p tsconfig.json`; tsc emits build output
with the process umask's regular-file mode (0644) and npm-pack preserves
that mode in the tarball. The shebang alone cannot make a non-executable
file runnable.

### 31.3 Exact correction (source-controlled)

- **`scripts/normalize-cli-mode.mjs`** (new, Node-based, cross-POSIX,
  no runtime dependency, no sudo, no global mutation): post-build step
  that (a) fails closed if the known CLI entrypoint
  (`dist/cli.js`, or an explicit outDir for isolated builds) does not
  exist or is not a REGULAR file (lstat), (b) verifies the shebang is
  present (never rewritten), (c) chmods exactly that one file to the
  deterministic conventional mode **0755**, (d) re-verifies the mode and
  exits 1 on any deviation. It never chmods arbitrary `dist/**` files.
- **`package.json`**: `"build": "tsc -p tsconfig.json && node
  scripts/normalize-cli-mode.mjs"` — the mode correction is now part of
  the source-controlled build/package behavior (build TypeScript →
  verify CLI output → normalize to executable → package).
- **`tests/unit/build-executable.test.ts`** (new, 3 focused regressions):
  clean isolated build → executable 0755 + shebang + DIRECT exec;
  npm-pack tarball extraction → packaged `package/dist/cli.js` 0755 +
  DIRECT exec `--version`; real `install.sh` bin-link composition in an
  isolated HOME → `<binDir>/pi-shuttle` DIRECT exec `--version` and
  `--help`. No manual chmod anywhere in the tests or the fix.

### 31.4 Correction evidence

- Clean build (`npm run build` from `rm -rf dist`): `dist/cli.js` mode
  **0755**, shebang `#!/usr/bin/env node` preserved, `./dist/cli.js
  --version` exits 0.
- npm-pack release-shaped artifact:
  `pi-shuttle-0.1.0.tgz` SHA-256
  `e2144878d51b9d356c5f85a0be4a9e00c85a1fd10f5fd4b1e8b2c0bfd967e75f`
  (evidence artifact only — NOT an official release artifact); tarball
  member `package/dist/cli.js` mode **-rwxr-xr-x (0755)**; extracted and
  executed directly → exit 0, `pi-shuttle 0.1.0`.
- Installed symlink (real installer, isolated HOME):
  `<binDir>/pi-shuttle` → `dist/cli.js` (0755); direct exec `--version`
  exit 0 and `--help` exit 0.
- Normalizer fail-closed check: missing output dir → exit 1 with a typed
  message.

### 31.5 Regression totals

- Pre-correction historical total (PS-4 baseline): 184/184 — preserved,
  not overwritten.
- **Post-correction total: 187 run / 187 pass / 0 fail / 0 skip**
  (+3: clean-build, npm-pack, installed-symlink executable regressions).
- `npm run typecheck` clean; `npm ci --dry-run` green;
  `git diff --check` clean.
- Directly affected suites (cli, installer-flow/bin-link, static-guard,
  package/build) all green within the 187.

### 31.6 Remaining requirement

A subsequent PS-5 focused E2E revalidation must run against the new
committed correction SHA (`fix: make pi-shuttle CLI executable`),
rebuild clean release-shaped artifacts from it, and replay the affected
real Linux product path through the directly executable `pi-shuttle`
command before PS-5 may be declared ACCEPTED.

### 31.7 Other PS-5 findings (unchanged)

- `PS5-LINUX-002 — DEFERRED / OPTIONAL HARDENING` — npm-pack component
  directories may activate as 0775 under a 0700 parent (mitigated by the
  0700 parent; no production correction in this gate).
- `PS5-LINUX-003 — RELEASE-PIPELINE EVIDENCE / NOT A PRODUCTION DEFECT`
  — exact Gateway dependency materialization remains a release-pipeline
  step; no production correction required in this gate.

---

PS-5 LINUX E2E — CORRECTIONS REQUIRED (awaiting post-commit revalidation)

`PS5-LINUX-001 — CORRECTED AND BASELINED` (see PS-5 executable focused rereview)
`PS5-LINUX-001 — CORRECTED AND BASELINED` (see PS-5 executable focused rereview)


---

## 32. Post-correction Linux E2E revalidation (PS5-LINUX-001 closure)

Executed against the corrected committed SHA `5380b3113dd7aea76f75347105e1b0a6363562c8`
(`fix: make pi-shuttle CLI executable`), after the focused rereview
(`pi-shuttle-ps5-linux-executable-focused-rereview.md` — ACCEPTED).
Fresh disposable zero-state root: `/tmp/pi-shuttle-ps5-revalidation`
(isolated HOME/config/state/share/bin, Pi 0.83.0 lane, Git HOME/TMP,
project root, artifact dir; zero-state proven before install). All
product commands in this revalidation were executed through the directly
executable installed `pi-shuttle` — NEVER via `node dist/cli.js`.

### 32.1 Revalidation evidence

| Step | Result |
|---|---|
| Clean build (`rm -rf dist` + `npm run build` at `5380b31…`) | `dist/cli.js` regular file, mode **0755**, shebang `#!/usr/bin/env node`, `./dist/cli.js --version` exit 0 (no `node` prefix) |
| npm-pack release-shaped artifact | `pi-shuttle-0.1.0.tgz` SHA-256 `e2144878d51b9d356c5f85a0be4a9e00c85a1fd10f5fd4b1e8b2c0bfd967e75f` (54 members); member `package/dist/cli.js` **-rwxr-xr-x (0755)**; extracted direct exec `--version` and `--help` both exit 0 |
| Gateway artifact (clean clone `7f3b4af…`) | `project-gateway-artifact-core-0.1.0.tgz` SHA `d37c598f5685e5f66d7c8a580003631423bdf5b36c5b85bc98925e4778aa395c` (deterministic — identical to prior run) |
| pi-guard artifact (clean clone v0.1.2) | `pi-guard-0.1.2.tgz` SHA `057f1b636328e8c77857a4b590d051fcc52c0c9b015ca5dd1a773c21d7d24d01` (deterministic — identical to prior run) |
| Dependency materialization | exact pins `@modelcontextprotocol/server@2.0.0`, `ajv@8.20.0`, `zod@4.4.3` (PS5-LINUX-003 release-pipeline evidence, unchanged) |
| Installer (fresh HOME, batch, both yes, explicit digests) | run 1 PARTIAL (gateway activated, deps pending — truthful); after materialization **run 2 COMPLETE, exit 0**; receipt: gateway `installed-verified`, pi-guard `installed-verified` (pi 0.83.0, `pi-list`), **both `digestVerified: true`** |
| **Direct-executable acceptance (PS5-LINUX-001)** | `<binDir>/pi-shuttle` → `dist/cli.js` (0755 regular file); **direct** `pi-shuttle --version` exit 0 and `pi-shuttle --help` exit 0 — no `node`, no EACCES, no 126 |
| Direct `project add` | exit 0, `state: initialized`; identity independently recomputed (storeId `eb8264d59b3e3099c3c89319d666dbb9` matches); store-v1 created by real Gateway; runtime config persisted; sentinel unchanged; artifacts dir created |
| Direct exact re-add | exit 0, `verification-replay`, store metadata byte-identical, 1 registration |
| Direct `project list` | deterministic single line, exit 0 |
| Direct `doctor` | **exit 0** (11 supported checks: platform, node, git, pi 0.83.0, receipt, gateway, pi-guard exact source, runtime config, project, git isolation, locks) |
| Direct `pi-shuttle start` → real Gateway MCP | **8/8 harness assertions**: initialize (real serverInfo), exactly the nine public tools, no admin/bootstrap leak, inspect-registry ok, validate-artifact valid, clean EOF exit 0, stdout byte-clean protocol (every line JSON, zero pi-shuttle text), stderr empty |
| Direct remove | deregister-only: store metadata byte-identical, project/`.git`/artifacts preserved, list → `no registered projects` |
| Direct re-add after remove | same identity/locator, `verification-replay`, store reused byte-identical, doctor exit 0 |
| Installer rerun | COMPLETE exit 0; store and runtime config byte-identical; pi extension not duplicated; direct `pi-shuttle --version` still exit 0 |
| Executable negative (§19) | throwaway copy: target 0644 → direct exec exit 126 (OS layer EACCES); 0755 (corrected-build semantics) → direct exec exit 0; primary environment untouched |
| Permissions audit | CLI target 755 regular; receipt/runtime config/store metadata 0600; isolation dirs 0700; no locks at steady state; component dirs 0775 under 0700 parent (PS5-LINUX-002, unchanged) |
| Baseline regression | `npm test` **187/187 pass, 0 skip**; `npm run typecheck` clean; `npm ci --dry-run` green; `git diff --check` clean |
| Source integrity | pi-shuttle HEAD `5380b31…`; Gateway `7f3b4af…` (4 pre-existing untracked); pi-guard `7a7580cc…` (8 pre-existing untracked); real Pi state untouched; no push/tag/publication |

### 32.2 Evidence reuse (unchanged `src/**` by the executable correction)

The correction changed ONLY the build script, the build-mode normalizer,
the executable regression tests, and reports — `src/**` is byte-identical
to the originally validated code. Therefore the following prior PS-5
evidence remains applicable and is REUSED (not re-executed here): Pi
0.83.0 extension load proof; full MCP 10/10 matrix; bounded interaction
13/13 (validate/draft/persist/confine); confinement negative matrix
(MCP + CLI + unsupported-Pi lane); bootstrap residual recovery (F5);
permissions/confinement audit baseline; source integrity. This
revalidation REVALIDATED: clean build executability, npm-pack
executability, installed-symlink direct exec, installer COMPLETE, direct
add/list/doctor/start/remove/re-add/rerun. NOT APPLICABLE to this gate:
interactive installer lane (unchanged from prior run), broad Gateway/
pi-guard suites.

### 32.3 Finding dispositions (final)

- **`PS5-LINUX-001 — VERIFIED CLOSED`** — the corrected committed SHA
  produces a release-shaped installation whose public `pi-shuttle`
  command executes directly through the real end-to-end path (clean
  build → npm-pack → installer → symlink → direct exec → full lifecycle
  → real Gateway MCP runtime). Closed by the focused correction baseline
  `5380b311…` plus this revalidation; the original failure evidence
  (§7/§23/§27) and the correction record (§31) remain preserved above.
- `PS5-LINUX-002 — DEFERRED / OPTIONAL HARDENING` — npm-pack component
  directories may activate as 0775 under a 0700 parent (reconfirmed this
  run; unchanged, not broadened).
- `PS5-LINUX-003 — RELEASE-PIPELINE EVIDENCE` — exact Gateway dependency
  materialization remains a release-pipeline step; no production
  correction (reconfirmed this run).

### 32.4 Historical verdict preserved

The original run's verdict `PS-5 LINUX E2E — CORRECTIONS REQUIRED`
(§27/§30) remains on record as historical evidence and is not erased.
The revalidation above closes the sole mandatory-criterion failure, so
the current PS-5 verdict is updated:

`PS-5 LINUX E2E — ACCEPTED`
