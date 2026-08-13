# PS-5 — pi-shuttle Linux Executable — FOCUSED REREVIEW (PS5-LINUX-001)

**Review mode:** READ-ONLY focused rereview of the PS5-LINUX-001
correction. No production code, tests, or docs modified by this rereview.
Baseline: pi-shuttle `edccd9e3f9e5d3a378a6ccb9fa00f0f43f160ccd` with the
uncommitted correction; PS-5 report
`pi-shuttle-ps5-linux-e2e-validation-report.md` (original verdict
`PS-5 LINUX E2E — CORRECTIONS REQUIRED` preserved, correction record
appended as §31).

---

## 1. Mandatory questions

### Q1. Does a completely clean build produce an executable `dist/cli.js`?

**YES.** Independently re-run in this rereview: `rm -rf dist` (no usable
build output), then `npm run build` (`tsc -p tsconfig.json && node
scripts/normalize-cli-mode.mjs`). Result: `dist/cli.js` exists, regular
file (lstat), mode **0755** (executable bits present), shebang
`#!/usr/bin/env node` preserved, direct execution `./dist/cli.js
--version` exits 0 with `pi-shuttle 0.1.0`. Also proven by the committed
regression test `PS5-LINUX-001: a clean isolated build produces a
directly executable dist/cli.js` which compiles into an EMPTY isolated
output directory (no pre-existing dist) and asserts mode 0755 + shebang +
direct exec.

### Q2. Is the executable mode produced by source-controlled build/package behavior rather than a manual PS-5 chmod?

**YES.** The correction is entirely source-controlled:
- `package.json` — the `build` script now chains
  `node scripts/normalize-cli-mode.mjs` after `tsc`;
- `scripts/normalize-cli-mode.mjs` — the Node-based post-build
  normalizer (fails closed on missing/non-regular entrypoint, verifies
  shebang, chmods exactly the CLI entrypoint to 0755, re-verifies mode,
  exits 1 on deviation). No manual `chmod` was used to produce the
  evidence: the rereview evidence run was `rm -rf dist && npm run
  build` (the regression tests' only `chmodSync` calls are on their own
  isolated `mkdtemp` fixture roots, never on build output).

### Q3. Does an actual npm-pack tarball preserve executable semantics?

**YES.** `npm pack` on the corrected tree produces
`pi-shuttle-0.1.0.tgz` (SHA-256
`e2144878d51b9d356c5f85a0be4a9e00c85a1fd10f5fd4b1e8b2c0bfd967e75f`,
evidence artifact only, not an official release artifact); `tar -tvzf`
shows member `package/dist/cli.js` mode **-rwxr-xr-x (0755)** (was 0644
in the pre-correction artifact `1fc9435c…`). Pinned by the committed
regression test `PS5-LINUX-001: the npm-pack release-shaped artifact
preserves executable semantics`.

### Q4. After extraction, can `package/dist/cli.js --version` execute directly?

**YES.** Extracted into an isolated directory and executed with NO
`node` prefix: exit 0, output `pi-shuttle 0.1.0 …`, no EACCES, no exit
126. Pinned by the same committed regression test (it extracts the real
tarball and direct-executes it).

### Q5. Does the actual installed `<binDir>/pi-shuttle` symlink execute directly?

**YES.** The REAL PS-3 installer entrypoint
(`install.sh --batch --gateway no --pi-guard no`, isolated HOME) was run:
it composed `<binDir>/pi-shuttle` → `<repo>/dist/cli.js` and the
direct-exec (no `node` prefix) of `--version` exits 0 with the correct
version, and `--help` exits 0 with the usage text. Pinned by the
committed regression test `PS5-LINUX-001: the installed <binDir>/pi-shuttle
symlink executes directly`.

### Q6. Is the shebang still correct?

**YES.** `dist/cli.js` first line remains exactly `#!/usr/bin/env node`;
the normalizer verifies a `#!` prefix and fails closed (exit 1) rather
than rewriting or accepting a missing shebang; bytes are never modified
(mode-only change).

### Q7. Were JavaScript/runtime semantics unchanged except for the intended build/package mode behavior?

**YES.** `src/**` is untouched (zero diff); the only production-surface
change is `package.json`'s build script (+ the new build helper, which is
not shipped — `files: ["dist"]` and the tarball inventory contain no
`scripts/` member). `chmodSync` changes metadata only; compiled output
bytes are produced from unchanged sources. Full suite green (see §3)
confirms no runtime behavior drift.

### Q8. Were Gateway, pi-guard, real Pi state, network behavior, authority boundaries, and installer architecture left unchanged?

**YES.**
- Gateway repo: HEAD `7f3b4afdb43704e7dac82da7b086d8367347c641`, only the
  4 pre-existing untracked WP-13D entries (unchanged from gate start).
- pi-guard repo: HEAD `7a7580cc4cbd7926797564c72269394fc29a860a` = v0.1.2,
  only the 8 pre-existing untracked v0.1.1 docs (unchanged).
- Real Pi state: `~/.pi/agent/settings.json` contains no pi-guard entry
  and was not touched.
- No network behavior added (no network imports; build helper is
  filesystem-only); no new runtime dependency (`package.json`
  `dependencies` still absent); no trusted-authority change (src
  untouched); installer architecture unchanged (no installer code
  change — the fix is at the build/package source, per the gate
  requirement that an installer-side chmod alone would NOT be
  sufficient).

## 2. Other PS-5 findings (unchanged)

- `PS5-LINUX-002 — DEFERRED / OPTIONAL HARDENING` — npm-pack component
  directories may activate as 0775 under a 0700 parent; still optional,
  not touched by this gate.
- `PS5-LINUX-003 — RELEASE-PIPELINE EVIDENCE / NOT A PRODUCTION DEFECT`
  — Gateway dependency materialization remains a release-pipeline step;
  no production correction required.
- No PS-6 (macOS) or PS-7 (tunnel/ChatGPT) scope entered; no PS-5
  revalidation performed in this gate (that is the next gate's job
  against the new SHA).

## 3. Verification performed (this rereview)

- Re-ran the correction evidence from scratch: `rm -rf dist` →
  `npm run build` → `stat` 0755 → direct `./dist/cli.js --version`
  (exit 0).
- Re-ran `npm pack` + `tar -tvzf` (member 0755) + isolated extraction +
  direct exec (exit 0).
- Re-ran the real installer bin-link composition in a fresh isolated
  HOME + direct exec of `--version` and `--help`.
- Normalizer fail-closed: missing output dir → exit 1, typed message.
- Full pi-shuttle suite: **187 run / 187 pass / 0 fail / 0 skip**
  (historical PS-4 baseline 184/184 preserved, not overwritten);
  `npm run typecheck` clean; `npm ci --dry-run` green;
  `git diff --check` clean.
- Change inventory: `package.json` (1-line), `scripts/normalize-cli-mode.mjs`
  (new), `tests/unit/build-executable.test.ts` (new, 3 regressions),
  PS-5 report (correction record appended); `src/**` untouched; no
  staging; no commit; no remote.

## 4. Findings

None. The correction is minimal, source-controlled, fail-closed, and
pinned by three genuine regressions that start from the real build/
package/install paths. No regression of PS-3/PS-4 behavior observed
(full suite green; installer-flow, cli, static-guard suites included).

## 5. Verdict

`PS-5 EXECUTABLE FOCUSED REREVIEW — ACCEPTED`
