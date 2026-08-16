# D — pi-shuttle macOS Intel Physical End-to-End Acceptance Report

**Gate type:** physical acceptance evidence (no production changes).
**Status of this gate's artifacts:** uncommitted, unstaged; no push/tag/
release/publication. The only repository file created is this report.

---

## 1. Gate objective

Prove the complete descriptor-bound macOS Intel x86_64 journey on REAL
Apple Intel hardware through PUBLIC/OPERATOR surfaces only: pinned
Darwin Gateway candidate materialization → clean `install.sh` install →
doctor → scratch project add / trusted-store bootstrap / replay →
start → real MCP stdio handshake with the exact accepted nine-tool
surface. Apple Silicon is NOT exercised and nothing here claims arm64
execution.

## 2. Source baselines

| Repo | Expected | Observed | Status |
|---|---|---|---|
| pi-shuttle | `adfa6f85dd0e7cfb28bc22c2dc5bf29a96e65ebc` (D0D local baseline) | identical (fresh clone HEAD) | ✓ |
| Gateway (macOS fork) | `mfx-labs/project-gateway-macos` @ `a18bd287c9ccada7fd31932dbe9937062d0b6bc1` (PGM-DIST-2 dual-arch candidate) | identical (fresh network clone HEAD; clean) | ✓ |
| pi-guard | `v0.1.2` @ `7a7580cc4cbd7926797564c72269394fc29a860a` | identical (fresh network clone; `git describe --tags --exact-match` = v0.1.2) | ✓ |

## 3. Host lane (physical Intel evidence)

| Fact | Observed |
|---|---|
| Hardware | MacBookPro13,3 (real Apple Intel hardware) |
| OS | macOS 12.7.6 (Monterey), Build 21H1320 |
| Architecture | x86_64 (`uname -m`) |
| Filesystem | APFS — `/dev/disk1s1s1` on `/` (apfs, sealed, journaled) |
| Node | v22.23.1 (`/Users/serene/.nvm/versions/node/v22.23.1/bin/node`) |
| Git | 2.37.1 (`/usr/bin/git`, Apple Git-137.1; PATH-discovered) |
| pi (isolated lane) | `@earendil-works/pi-coding-agent@0.83.0` installed into the acceptance root (known-good baseline; the real operator Pi store was never targeted) |
| tar / xattr | `/usr/bin/tar`, `/usr/bin/xattr` present |

## 4. Isolation model

- Acceptance root: `/private/tmp/pi-shuttle-d-intel-accept/` (mode 700;
  NOTE: `/private/tmp` was chosen deliberately — macOS `/tmp` is a
  symlink to `/private/tmp`, and the Gateway's trusted-lane construction
  refuses symlinked HOME path components fail-closed. The first attempt
  under `/tmp/...` was refused by the GATEWAY's own HOME validation
  (`path component is a symlink: tmp`) — recorded here as an observed
  fail-closed boundary, not a product defect: a normal user HOME
  (`/Users/<user>`) contains no symlinked components.
  Classification: `TEST-HARNESS PATH ISSUE — NON-BLOCKING` — the
  refusal is attributable to the acceptance harness's choice of the
  macOS-symlinked `/tmp` as the isolation root; the normal product
  journey path is unaffected and no product change is required.)
- Isolated `HOME` = acceptance root `home/` — zero-state proven before
  install.
- Isolated `PATH` = acceptance root `pi-lane/node_modules/.bin` (pi
  0.83.0) + host node/git/tar/xattr.
- Project root, installer staging, bin dir, Git HOME/TMP, Pi config
  store: all under the acceptance root. Real operator HOME, real Pi
  store, and source repos: never targeted.

## 5. Gateway candidate materialization (committed D0D machinery)

`node scripts/build-release.mjs --target darwin-x86_64-posix-utf8-node22`
from the fresh pi-shuttle clone (HEAD adfa6f8) against the pinned clean
checkouts:

- Selected identity: `mfx-labs/project-gateway-macos` @
  `a18bd287c9ccada7fd31932dbe9937062d0b6bc1`, package
  `@project-gateway/macos-core@0.1.0`, bin `project-gateway-macos-mcp`.
- No addon substitution: builder clones `--no-local` from the pinned
  checkout, verifies checkout HEAD + canonical GitHub origin, and the
  dual-arch addons are tracked files in the pinned tree (provenance
  machinery from PGM-DIST-2/D0D, unchanged).
- Artifact: `project-gateway-macos-core-0.1.0.tgz`, 3,573,616 bytes,
  SHA-256 `183ded3d1d4ca1870f32207519d0525af93f2cd07102dd86510c472fc77864b2`
  (matches the D0D focused-review materialization exactly), deps
  materialized, installer archive scan clean (2036 members), builder
  Gateway smoke green.

## 6. Clean install (committed install.sh surface)

`install.sh --batch --gateway yes --pi-guard yes --artifact-dir
<release-out> --expect-gateway-sha256 183ded3d…64b2
--expect-pi-guard-sha256 057f1b63…4d01` — exit 0, **COMPLETE**.

Receipt (`home/.local/state/pi-shuttle/install.json`, mode 0600):

- platformLane: `darwin-x86_64-posix-utf8-node22` (derived from the real
  host — no flag, no Linux fallback);
- gateway: `installed-verified`, version 0.1.0, commit
  `a18bd287c9ccada7fd31932dbe9937062d0b6bc1`, digestVerified true,
  artifactSha256 `183ded3d…64b2`, binPath
  `…/packages/project-gateway-macos-core@0.1.0/dist/runtime/mcp/cli.js`,
  smoke passed;
- pi-guard: `installed-verified`, verifiedBy `pi-list` (exact source
  line in the isolated pi 0.83.0 store);
- installed package identity: `@project-gateway/macos-core@0.1.0`, bin
  `project-gateway-macos-mcp` → `./dist/runtime/mcp/cli.js`;
- installed native tree carries both tracked addons; the installed x64
  addon digest is exactly
  `0667af87eaf541a92fa299cd21cd2202dc825c6af9da650fd96cebf4553f6382`.
- Quarantine: artifact carried no `com.apple.quarantine` attribute
  (locally materialized bytes — the normal `no-quarantine` condition;
  the strip step ran on the darwin path without failure).

## 7. Doctor

`pi-shuttle doctor` (final state, after project add) — exit 1 with
exactly ONE non-supported status:

- platform: `installed but unverified` — "technically eligible via a
  valid Gateway descriptor; not a product-support claim" — the expected
  policy-only result; NOT a D failure;
- supported (10/10): node, git, pi (0.83.0 baseline), installation
  receipt, gateway component (lane identity + commit + bounded --help
  smoke), pi-guard component (pi-list exact line), runtime
  configuration (mode 0600, 1 surface), registered project, git
  isolation dirs, coordination locks.
- No `unsupported` status, no exit 2, no identity drift, no integrity
  failure.

## 8. Project add / trusted-store bootstrap / replay

Fresh scratch Git project (1 commit) at
`/private/tmp/pi-shuttle-d-intel-accept/project`:

- `pi-shuttle project add <path>` exit 0;
- canonical identity: workspace `pgw:w:0095499c7f9fdc230bf708cd9e048b75`,
  surface `pgw-0095499c7f9fdc230bf708cd9e048b75` (deterministic — the
  earlier run under the symlinked root derived the same content-bound
  identity);
- root resolved to the real path (`/private/tmp/...`, macOS symlink
  canonicalization);
- trusted store initialized at
  `home/.local/share/pi-shuttle/stores/0095499c…`;
- bootstrap invoked the TARGET-SELECTED installed Gateway executable
  (receipt-pinned `project-gateway-macos-mcp` bin) with replay
  verification succeeding; runtime configuration persisted at
  `home/.config/pi-shuttle/runtime.json` (mode 0600, surface + locator +
  workspace + root recorded coherently).

## 9. Start + MCP handshake

Committed `scripts/mcp-handshake-probe.mjs` with
`GATEWAY_LANE=darwin-x86_64-posix-utf8-node22` and
`EXPECTED_GATEWAY_PACKAGE=@project-gateway/macos-core`, spawning the
installed `pi-shuttle start` surface with piped stdio:

- `MCP handshake OK: initialize + exactly 9/9 tools verified, clean EOF
  exit 0` (probe exit 0).
- Independent verification of the tool surface:
  `validate-artifact`, `inspect-stored-record`, `inspect-registry`,
  `inspect-audit-history`, `verify-record`, `enumerate-class`,
  `draft-artifact`, `persist-artifact`, `inspect-changes` — exactly
  nine, no extras/missing.
- Clean termination: Gateway child exited 0 on stdin EOF; byte-clean
  protocol stdout.

## 10. Fail-closed boundaries observed (not bypassed)

- Gateway trusted-lane HOME validation refused a symlinked path
  component (`/tmp` on macOS) — fail-closed, no workaround attempted in
  product code (isolation root relocated instead).
- Platform preflight, descriptor selection, artifact digest
  verification, package identity/bin confinement, quarantine step,
  receipt gates, and the probe's lane→package consistency assertion all
  ran and passed on the real journey.
- The release builder ran with no push/tag/upload (its own guard).

## 11. Claim boundary

This report establishes ONLY: the normal descriptor-bound macOS Intel
journey executes successfully on real Apple Intel hardware with the
PGM-DIST-2 dual-architecture candidate.

It does NOT establish: arm64/Apple Silicon execution (the arm64 addon
was carried and digest-pinned but never dlopen'ed), MAC-5 closure,
macOS product support (supportedLanes remains Linux-only; doctor's
platform status remains `installed but unverified`), release
availability, or npm/GitHub publication.

## 12. End-state verification

- pi-shuttle repo: no tracked modifications; HEAD adfa6f8 unchanged.
- This report: the only repository file created; uncommitted.
- No commit/push/tag/release/npm-publish performed anywhere in this
  gate.
