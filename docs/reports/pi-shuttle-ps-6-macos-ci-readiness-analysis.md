# PS-6 — pi-shuttle macOS arm64 + CI Readiness Analysis

**Gate type:** READ-ONLY implementation-readiness analysis. No production
code modified in any repository; no CI workflows created; no commits; no
push/tag/publish/deploy. The only file created is this report (uncommitted,
unstaged).

---

## 1. Baseline

| Repo | Expected | Observed | Status |
|---|---|---|---|
| pi-shuttle (`/home/chef/Documents/pi-shuttle`, `master`) | `42c1e5b3bd53c5b922b9635c86ecdceb123c9847` `docs: close pi-shuttle PS-5 Linux E2E` | identical | ✓ |
| Project Gateway MCP | `7f3b4afdb43704e7dac82da7b086d8367347c641` | identical | ✓ |
| pi-guard | `v0.1.2` @ `7a7580cc4cbd7926797564c72269394fc29a860a` | identical | ✓ |

Pre-existing untracked debris (Gateway WP-13D files ×4, pi-guard v0.1.1
review docs ×8) recorded, never touched. pi-shuttle has **no remote** and
**no `.github/` directory** today.

Normative sources read in full: `docs/product-contract.md`,
`docs/component-boundaries.md`, `docs/installation-contract.md`,
`docs/operator-cli-contract.md`, `docs/platform-support-contract.md`,
`docs/test-and-release-plan.md`, `docs/work-packages.md`,
`docs/decisions/ADR-001-*.md`, PS-5 closure report
(`pi-shuttle-ps5-linux-e2e-validation-report.md`, incl. §31/§32 correction
and revalidation), PS-5 executable focused rereview. Gateway sources
inspected at the exact pinned HEAD (host-lane, validator, containment,
identity, storage initialization/probe/metadata, runtime lanes, bootstrap
verb, git host lane, CLI, config, runbook, ADR-036/041). pi-guard source
and package metadata inspected at the exact pinned tag.

## 2. Scope

The smallest exact implementation scope to promote **macOS arm64 / Apple
Silicon** to a first-class pi-shuttle v0.1.0 product lane, preserving the
validated Linux x86_64 lane, plus CI evidence sufficient for: Linux x86_64
regression; macOS arm64 build/install/lifecycle confidence; macOS Intel
compatibility-only evidence. No broad cross-platform abstraction for
hypothetical operating systems.

## 3. Normative decisions (verified against code, all confirmed consistent)

1. **Lanes:** Linux x86_64 first-class (PS-5 validated); macOS arm64
   first-class gated on PS-6 evidence; macOS Intel NOT supported.
   Code state: `hostLane()` (`src/host/environment.ts`) already maps
   `darwin+arm64 → darwin-arm64-posix-utf8-node22` and
   `darwin+x64 → darwin-x64` (unclaimed); manifest
   (`src/compat/manifest.ts`) carries `supportedLanes: [linux…]` and
   `gatedLanes: [darwin-arm64…]`; installer/doctor/start/add all gate on
   `supportedLanes` membership. The platform refusal policy is
   **manifest-driven**, so the darwin-arm64 promotion is a manifest change
   plus tests — no refusal-policy redesign.
2. **Filesystem:** default (case-insensitive) APFS intended supported; no
   case-sensitive volume requirement unless evidence proves otherwise.
   Verified below (§6): the required invariants hold without a case-fold
   normalization semantic.
3. **Node:** no bundling; exact validated evidence lane 22.23.2
   (`NODE_LANE_VERSION`, enforced by installer `checkNodeLane()` and
   doctor). Package floor `>=22.0.0` is not a claim — unchanged.
4. **Pi:** baseline 0.83.0; 0.84.x refused (`PI_NON_BASELINE_POLICY =
   'refuse-non-baseline'`); the darwin lane work touches no Pi policy.
5. **`configurationVersion = "2"`** unchanged (manifest + bootstrap
   composition).
6. **`project remove` = DEREGISTER ONLY** unchanged (store preserved).

## 4. Linux assumptions audit (production code, classified)

Audited all of pi-shuttle `src/**` (4,613 lines) plus `install.sh`:

| Assumption | Location | Classification |
|---|---|---|
| `process.platform`/`process.arch` observation | `src/host/environment.ts` (`hostEnvironmentFromProcess`) | **portable as-is** (neutral observation; static guard confines `process.env` here) |
| Lane mapping | `src/host/environment.ts` `hostLane()` | **portable as-is** — darwin-arm64 already mapped; darwin-x64 falls to `darwin-x64` (unclaimed → refused) |
| UID/root refusal | `src/installer/preflight.ts` `checkNotRoot`; `install.ts:169` (`typeof process.getuid === 'function'` guard); Gateway `git/host-lane.ts` | **portable as-is** — `process.getuid()` exists on macOS (real uid; root = 0); never `setuid`/`chown` anywhere; Windows path already null-guarded |
| HOME/XDG layout | `resolveLayout()` — `$HOME/.local/{share,state,config,bin}` | **portable as-is** — the approved identical-on-both-platforms layout (platform-support-contract §2); no `~/Library` substitution needed |
| Executable discovery (PATH) | `resolveExecutable()` (`src/process/runner.ts`, `src/installer/process.ts`) — `accessSync(X_OK)`, `:` split | **portable as-is** — macOS PATH semantics identical |
| Shebang/direct exec | `dist/cli.js` `#!/usr/bin/env node`, normalizer 0755 (PS5-LINUX-001) | **portable as-is** — `/usr/bin/env` exists on macOS; mode bits identical on APFS (see §9) |
| chmod modes | 0600/0700/0755 throughout (`writer.ts`, `lock.ts`, `preflight.ts`, `prepareOperatorDirs`) | **portable as-is** — POSIX bits identical; ACL caveat in §8 |
| Symlink behavior | `symlinkSync`/`readlinkSync` (bin link, `install.ts`), `realpathSync` (canonicalization) | **portable as-is** — POSIX symlinks on APFS; no Windows `type` handling needed |
| mkdir/rename semantics | `mkdirSync` 0700, atomic `renameSync` (`writer.ts`, `components.ts`) | **portable as-is** — same POSIX semantics; rename atomic on APFS (§14) |
| O_EXCL locks | `openSync('wx')` (`lock.ts`) | **portable as-is** — O_CREAT\|O_EXCL supported on APFS; the Gateway's own compatibility probe verifies exclusive creation at bootstrap (§14) |
| Temp directories | product never uses `os.tmpdir()` for security-relevant state: staging, bootstrap probes, receipt all under `~/.local/state/pi-shuttle`; Gateway store `tmp/` under the store locator | **portable as-is** — `/tmp → /private/tmp` symlink and per-user `/var/folders` `os.tmpdir()` behavior are avoided by design; doctor must note canonical store-parent (Lane B records) |
| Git discovery | PATH-only `resolveExecutable('git')`, absolute `gitPath` written into config; never `/usr/bin/git` | **portable as-is** — required: macOS `/usr/bin/git` is an Apple CLT shim (2.39.x) that fails the exact 2.45.4 runtime check (§11) |
| Pi discovery | PATH-only | **portable as-is** |
| tar | PATH-only (`checkTarPresent`); extraction policy owned by the Node archive scanner (`archive.ts`), tar binary only extracts | **portable as-is** — macOS ships BSD `tar` (bsdtar) which honors `-xzf`; scanner makes tar behavior non-security-relevant |
| npm packaging | `npm pack` mode preservation | **portable as-is** with evidence lane (§9) |
| Subprocess/signal | `spawn` argv-only, bounded capture, inherited stdio only in `spawnGatewayForStart`; SIGINT/SIGTERM/SIGHUP forwarding; `128+constants.signals[]` | **portable as-is** (§13) |
| `process.getuid` | as above | **portable as-is** |
| Path canonicalization | `canonicalizePath` = `realpathSync` (host seam) | **portable as-is**, and the macOS case/Unicode identity mechanism (§6–§7) |
| Case sensitivity assumptions | none in pi-shuttle code; identity = SHA-256 of the canonical root string | **portable as-is; requires small darwin branch** for doctor node-arch check (§10) and Lane B case-variant evidence |
| Filesystem permissions | stat-mode checks in doctor (`modeOf`, `modeNote`) | **portable as-is** with the §8 ACL caveat (optional hardening, not a blocker) |
| Runtime/store paths | all derived from `resolveLayout(home)` | **portable as-is** |
| `install.sh` | bash 3.2-compatible constructs only (`set -euo pipefail`, `$(...)`, `exec`) | **portable as-is** — macOS ships bash 3.2 at `/bin/bash`; `/usr/bin/env bash` resolves |

**No architectural correction is required anywhere in pi-shuttle
production code.** The darwin delta is: manifest lane promotion + one
doctor check (node arch on darwin) + tests. No generic portability
abstraction is justified.

## 5. Gateway host-lane delta (HIGH PRIORITY — inspected at HEAD `7f3b4af…`)

### 5.1 Where Linux x86_64 is encoded today

| File | Encoding |
|---|---|
| `src/trusted/host-lane.ts` | `TRUSTED_HOST_LANE = 'linux-x86_64-posix-utf8-node22'`; `isSupportedHostLane()` = single-value equality |
| `src/trusted/types.ts:155` | `readonly hostLane: typeof TRUSTED_HOST_LANE` (type literal narrowing) |
| `src/trusted/validate.ts:438-444` | lane is already an **explicit trusted operand** (`options.hostLane`); missing → TCF-027, unsupported → TCF-028, both fail closed before any input handling |
| `src/trusted/validate.ts:731` | validated configuration **stamped with the constant**, ignoring the operand beyond the gate |
| `src/trusted/containment-validate.ts:172` | `if (configuration.hostLane !== TRUSTED_HOST_LANE)` hardcoded comparison |
| `src/runtime/mcp/lanes.ts:252` | `buildWorkspaceLanes` hardcodes the operand |
| `src/conformance/runner.ts:874` | conformance runner hardcodes the operand |
| `src/control-plane/storage-bootstrap-action.ts:171` | `bootstrapStore` hardcodes the operand |
| `src/bootstrap/run.ts` | CLI bootstrap runner — no lane input; receives it only via `bootstrapStore`'s hardcode |

### 5.2 Which identity/configuration inputs include host lane

`computeTrustedConfigurationIdentity` (`src/trusted/identity.ts`): the
canonical projection contains `hostLane: configuration.hostLane`
(first-class field), then RFC 8785 JCS + SHA-256 with domain prefix
`PGAP-TRUSTED-CONFIG-v1\0`. **Host lane participates in configuration
identity — confirmed in code**, and the F7 test suite pins
`proj['hostLane'] === TRUSTED_HOST_LANE` in the projection bytes.

### 5.3 Does trusted configuration identity change when host lane changes?

**YES — by construction.** The identity digest differs when the validated
lane differs. Consequently:

- `configurationIdentity` in the runtime config and in the store metadata
  payload is lane-bound.
- **Cross-lane replay is rejected automatically, fail closed:**
  `replayMetadata` (`src/storage/metadata/bootstrap-persist.ts:234`)
  requires `configurationIdentity === binding.configurationIdentity`;
  `verifyStoreInstance` (`src/storage/read/read-record.ts`) re-checks the
  same binding at runtime composition. A store created under the Linux
  lane, replayed/verified under the darwin lane, derives a different
  identity → `ERR-STO-REQ-INVALID` ("configuration metadata identity does
  not match the permit binding") → `replayClassification` → `FOREIGN` →
  fail closed. **A persisted Linux store cannot be accidentally replayed
  as macOS state.** (And vice versa.) Lane-bound stores are documented as
  machine-local (component-boundaries §4.2).
- The storage-level `lane` recorded in store metadata is the storage
  constant `posix-0700` (unrelated to the host lane; no change needed).

### 5.4 Does darwin-arm64 need its own lane identifier?

**YES.** `darwin-arm64-posix-utf8-node22` must join the closed accepted
set as a distinct string (it is already the pi-shuttle-side constant and
the platform-support-contract lane). The existing F7 negative test lists
`macos-arm64-posix-utf8-node22` (note: `macos-` spelling) as unsupported —
that spelling remains unsupported; only the exact `darwin-arm64-…` string
is added. `darwin-x86_64-posix-utf8-node22` stays rejected.

### 5.5 Schemas/types/constants/tests requiring the new lane

- `src/trusted/host-lane.ts` — accepted-lane set (closed, exactly two
  members), `isSupportedHostLane` set membership, doc comment (drop the
  blanket "macOS … unverified and unsupported" wording in favor of
  "macOS arm64 accepted per ADR-0xx; macOS Intel and Windows remain
  unsupported; case-insensitive filesystem assessment per ADR-0xx").
- `src/trusted/types.ts:155` — widen the literal type to the two-lane
  union.
- `src/trusted/validate.ts:731` — stamp the validated operand
  (`options.hostLane`, already gated by the accepted set) instead of the
  constant. This is the one semantic change: the operand becomes
  identity-relevant (it already is the gate; now it must also be the
  value).
- `src/trusted/containment-validate.ts:172` — `isSupportedHostLane(...)`
  instead of constant equality.
- `src/runtime/mcp/lanes.ts:252`, `src/conformance/runner.ts:874`,
  `src/control-plane/storage-bootstrap-action.ts:171` — operand becomes a
  parameter threaded from the CLI boundary.
- `src/bootstrap/run.ts` + `src/runtime/mcp/cli.ts` — derive the lane
  once at the operator CLI boundary from `process.platform`/`process.arch`
  (the only host observation in the runtime; the I/O-free trusted core
  stays ambient-probe-free per F-7) and pass it into `bootstrapStore` and
  `buildWorkspaceLanes`. Both paths must use the same derivation so
  bootstrap identity == start identity on the same machine.
- Tests: `tests/trusted/host-lane.test.ts` (F7) — move
  `darwin-arm64-posix-utf8-node22` from the unsupported list to an
  accepted-lane test; keep `macos-arm64-…`, `darwin-x86_64-…` unsupported;
  add lane-bound identity assertions for both accepted lanes and a
  cross-lane identity-difference test; `containment-validate` tests for
  the darwin lane; storage replay tests for cross-lane rejection.
- No schema change to the operator `--config` document: the lane is a
  trusted operand, never an operator-supplied config field (F7 pins "no
  host-lane inference from input fields").
- `src/storage/probe/probe.ts` — **no change** (§6/§14).

### 5.6 Classification

**Purely mechanical inside the previously approved PS-6 envelope.** The
operand plumbing already exists (`options.hostLane`); the change is
exactly "closed accepted-lane set + darwin-arm64 + validator operand +
lane threading at the CLI boundary + tests + Gateway ADR" as
component-boundaries §4.2 and work-packages PS-6 describe. **No HUMAN
contract escalation required.** The Gateway ADR is part of the approved
envelope (platform-support-contract §3.1: "plus a Gateway ADR"; the ADR
must cover: the accepted-lane set, APFS case-insensitivity assessment of
the fixed-lowercase layout, and fsync-evidence acceptance).

## 6. APFS / path semantics (HIGH PRIORITY)

### 6.1 Mechanism

Default APFS is case-insensitive but case-preserving. All pi-shuttle
identity derives from **one canonical string**: `canonicalizePath() =
realpathSync(path)` (host seam), then
`storeId = workspaceId[:32] = sha256(canonicalRoot)`. On macOS,
`realpath(3)`/`realpathSync` resolves every component to the **actual
on-disk directory-entry spelling** (case-fixed, symlink-resolved,
NFD-normalized as stored). Therefore:

> `/Users/alice/Project` and `/Users/alice/project` resolve to the same
> filesystem object AND to the same canonical string → the same
> workspaceId, storeId, surfaceId, locator, forbiddenRoots, and
> `configurationIdentity` inputs. **YES — one canonical filesystem object
> yields one stable pi-shuttle identity, with no case-folding code.**

Second registration of the other spelling: `project add` canonicalizes
first → identical surface → `registerSurface` exact-replay no-op
(`ERR-PS2-REG-DUPLICATE-*` fail-closed paths exist for any conflict). No
duplicate authority can be created. `project remove` canonicalizes
path-shaped targets before matching — case variants remove correctly.

### 6.2 Fail-closed posture

If any future deviation ever produced two different canonical strings for
one object (e.g. a case-sensitive volume where both spellings are distinct
objects — which is correct behavior: distinct objects, distinct
identities), the registry dedupes on surfaceId/locator/workspaceId — all
derived from the same canonical string — so a mismatch would surface as
two registrations only if realpath itself returned unstable output. This
is exactly why **Lane B must run the case-variant test** (add
`Project`, re-add `project`, assert identical identity and single
registration, plus a `realpath`/`stat` dev+ino pair evidence record) —
the mandated evidence, not an assumption. pi-shuttle applies **no
lowercase-string normalization** (contract-faithful: filesystem
canonicalization only).

### 6.3 Store layout under case-insensitive APFS

The entire Gateway store layout is fixed lowercase ASCII (`store-v1`,
`config-v1`, `metadata`, `tmp`, `records`, `audit`, `locks`, `index`,
`quarantine`, `metadata.json`); storeId is lowercase hex. The only
case-collision surface is two hex strings differing in case — impossible,
because pi-shuttle emits lowercase hex only and the Gateway never
re-derives store names from mixed-case input. Namespace identity is
**dev+ino based** (`namespaceIdentity`, `parentIdentity` in store
metadata), which is case-independent. The Gateway compatibility probe
records `caseSensitive: false` on default APFS **without failing** (see
§14) — the profile becomes part of the recorded metadata facts. The
platform-support-contract §3.2 requirement (record volume case
sensitivity; Gateway ADR assessing the fixed-lowercase layout; probe
green) is the exact closure path and is implementable.

### 6.4 `forbiddenRoots` / prospective destination containment / no-follow

All derived from the canonical root and Gateway resolvers
(`createRootPathResolver` = realpath-backed, typed failures); no-follow
descriptor verification is exercised by the probe (`O_NOFOLLOW` honored on
APFS). The `gitHome`/`gitTmpdir` outside-workspace check compares resolved
paths (doctor `gitIsolationProblem`), unaffected by case semantics since
all inputs are canonical.

## 7. Unicode / normalization semantics

- Contracts inspected: the artifact canonicalization lane is the
  Gateway's (digests over **byte-exact** canonical UTF-8, RFC 8785 JCS —
  `identity.ts`, `destination-request.ts` "Unicode is accepted on the
  supported UTF-8 lane **without normalization**; malformed input is never
  silently normalized"). Filesystem pathname identity is
  **filesystem-canonicalized** (realpath), never string-normalized.
- APFS stores names in NFD (decomposed) form; a user-supplied NFC
  spelling (`é` composed) resolves to the same object and realpath returns
  the on-disk (NFD) spelling → one canonical string → one identity. Two
  differently normalized operator spellings of the same path therefore
  **already resolve to one project through realpath**; no pi-shuttle
  Unicode normalization exists or is needed, and none may be introduced
  without contract authority (none is requested).
- Byte-exactness inside the digest pipeline is unaffected: the canonical
  string is what it is; identity is per-machine (stores are machine-local
  and lane-bound, documented — no cross-machine portability claim exists).
- Classification: **closed by existing canonicalization; severity: none;
  no contract decision required.** Lane B adds a Unicode-spelling test
  (NFC vs NFD input of one project name → identical identity) as evidence.

## 8. macOS filesystem permissions

- 0600/0700/0755 POSIX bits are identical on APFS; `chmod` semantics hold.
  `writeFileAtomic` (0600 + fsync + rename + dir fsync), locks (0600),
  layout/operator dirs (0700), `normalize-cli-mode` (0755) all map
  unchanged.
- **ACL caveat (recorded, not a blocker):** on macOS, `chmod` does not
  strip existing/inherited ACL entries; a file whose mode is 0600 can
  still be readable via an ACL grant. pi-shuttle creates its own directory
  chain (`~/.local/share/pi-shuttle/...`) with `mkdirSync` 0700, and
  default macOS user homes carry no inherited ACLs, so exposure is
  theoretical. Doctor's stat-mode checks do not observe ACLs. Mitigation
  options (optional hardening, PS5-LINUX-002-class): Lane B records
  `ls -le`/ACL presence on the created chain; doctor could add a darwin
  ACL-presence probe (read-only) later. **Not required for v0.1.0
  evidence.**
- **PS5-LINUX-002 (npm-pack 0775 package dirs):** npm-pack's mode
  emission is platform-independent behavior of the same npm; the 0700
  `packages/` parent mitigation holds identically on macOS. **Unchanged
  significance; stays optional.**
- **Parent 0700 remains an adequate confinement boundary** on APFS
  (standard user homes have no group/world access; the store chain is
  operator-owned 0700/0600). No generalized ACL management is justified.

## 9. Executable / package portability

- **PS5-LINUX-001 correction is portable as-is:** `scripts/
  normalize-cli-mode.mjs` is Node-core, cross-POSIX (lstat + chmod 0755 +
  shebang verify + fail-closed re-verify); it has no Linux assumption.
  `#!/usr/bin/env node` is valid on macOS.
- npm-pack on macOS preserves file modes in the tarball exactly as on
  Linux (same npm implementation; mode is recorded in the tar header);
  extraction by BSD tar preserves them; the committed regression tests
  (`build-executable.test.ts`: clean build, npm-pack artifact, installed
  symlink direct exec) are platform-neutral and become Lane B evidence.
- Symlink creation (bin link) is POSIX-identical.
- **Quarantine/xattr:** locally built and CI-built artifacts never carry
  `com.apple.quarantine` (that attribute is applied by LaunchServices on
  browser/AirDrop downloads; `curl` does not set it). The release-lane
  installer's future public-URL fetch is where quarantine could appear;
  platform-support-contract §3.7 already mandates strip-after-SHA-verify.
  **No code-signing/notarization is required for v0.1.0**: the product is
  a bash + Node CLI composed locally; Gatekeeper applies to GUI/installer
  bundles, not to `curl | bash`-installed scripts. Classified separately:
  code-signing/notarization = out of scope for v0.1.0; quarantine strip =
  conditional darwin installer line, only if Lane B evidence shows a
  quarantine-bearing fetch path (CI-built artifacts will not carry it).

## 10. Installer macOS preflight delta

Current preflight (`src/installer/preflight.ts`): platform lane (manifest
gated), node lane (exact 22.23.2), tar on PATH, Pi 0.83.0 policy, root
refusal (uid), layout writability. Exact darwin delta:

- **Manifest promotion** (the single normative flip):
  `supportedLanes = [linux-x86_64-posix-utf8-node22,
  darwin-arm64-posix-utf8-node22]`; `gatedLanes` emptied (or the darwin
  entry removed). Then: darwin+arm64 → install proceeds; darwin+x64 →
  `ERR-PS3-UNSUPPORTED-PLATFORM`, exit 2 (`UNSUPPORTED`); linux x64
  unchanged; windows unchanged unsupported. No probe changes needed for
  refusal correctness.
- **Node arch probe (new, darwin-only):** platform-support-contract §3.9 —
  on darwin, doctor and (optionally) the installer must confirm the node
  binary is arm64 (`node -p process.arch`), so a Rosetta/x64 node under
  arm64 macOS fails closed rather than producing unverified evidence.
  Small branch: run only when `platform === 'darwin' && arch === 'arm64'`.
- **No Homebrew dependency**: executable discovery stays PATH-based
  (node/git/pi/tar); macOS ships tar; git 2.45.4 and Pi 0.83.0 remain
  operator-provided, PATH-discovered, version-probed (identical to the
  Linux lane).
- UID/root refusal: `process.getuid()` works on macOS; `sudo` installs
  are refused identically (no sudo path exists anywhere).
- Writable per-user paths: `ensureWritableLayout` already probes by
  creating the layout dirs (0700) — same behavior on macOS.

## 11. Git lane on macOS

- **The contract wording is resolved by Gateway code, not by guesswork:**
  `src/git/host-lane.ts` `initializeGitHostLane` **hard-fails at runtime**
  (`wrong-version`) unless `git --version` contains `2.45.4`, and
  fingerprints the binary (dev/ino/mode/size/mtime + SHA-256). This runs
  at every `start` and at every `bootstrap` (via `buildWorkspaceLanes`).
  So **Git 2.45.4 is an exact globally required version at runtime** — it
  is not merely "an exact validated Linux evidence lane with a broader
  compatibility requirement." The manifest pin is the runtime
  requirement.
- macOS default Git is the Apple CLT shim `/usr/bin/git` (2.39.x) or a
  Homebrew current git — **neither satisfies the runtime lane.** The
  operator must provide 2.45.4 (source build like the PS-5 Linux lane
  (`~/.local/git-2.45.4`), or a pinned formula/tap). This is an explicit
  **product/release requirement to document in the macOS install docs**
  (and a Lane B provisioning step — see §15); it is not a silent
  broadening of supported Git versions (none is proposed or permitted).
- Ownership/permission checks (`uid 0 or current uid`, not
  group/world-writable, executable) are satisfied by a user-built binary;
  on macOS the fingerprint fields are all available on APFS (st_ino,
  mtime) — Lane B records the fingerprint evidence.
- **PS-6 validates the selected Git binary by** the exact probe the
  product itself uses: `git --version` (LC_ALL=C) containing 2.45.4, plus
  the Gateway fingerprint; the CI lane installs/points at a 2.45.4 build
  and records origin+version (platform-support-contract §3.8).

## 12. Pi 0.83.0 on macOS arm64

Inspected npm metadata (read-only; no real-Pi mutation, no 0.84.x claims):

- `@earendil-works/pi-coding-agent@0.83.0`: **no `os` and no `cpu`
  restriction fields** in the registry metadata; engines `>=22.19.0`.
- The only native-looking dependency, `@silvia-odwyer/photon-node@0.3.4`,
  is **WASM-based** (`photon_rs_bg.wasm`; no `.node` binary, no prebuilds,
  no node-gyp) → platform-neutral. All other deps (jiti, undici,
  proper-lockfile, cross-spawn, TUI, etc.) are pure JS/WASM.
- pi-guard v0.1.2: pure TypeScript (spawn of `git`, fs operations only —
  `git-inspect.ts` is POSIX-neutral); no platform-specific code, no
  native deps.
- **Conclusion: a macOS arm64 CI install of the exact Pi 0.83.0 lane and
  pi-guard v0.1.2 is technically feasible (CI-verifiable)** — `npm
  install` resolves the same tree; the extension loader (jiti) is
  platform-neutral; PS-5's extension-load probe methodology transfers to
  the darwin lane. Full interactive runtime behavior (TUI, provider auth)
  remains physical-UAT evidence (Lane D); CI proves install/load/version
  facts. Classification: **CI-verifiable** (install + load); interactive
  runtime = physical-UAT-only.

## 13. Process / signal behavior on darwin

- `spawn` argv-only (no shell), bounded capture, `SIGKILL` timeout,
  `child.kill(signal)` forwarding for SIGINT/SIGTERM/SIGHUP, exit-code
  passthrough (`code as-is`; signal → `128 + constants.signals[sig]`),
  inherited stdio only on the `start` path: **all portable unchanged** —
  the three signals exist with identical semantics on macOS;
  `node:os` `constants.signals` includes them on darwin; `spawn` with
  `env`/`cwd` behaves identically.
- PATH executable checks (`accessSync X_OK`) — identical.
- **No redesign; `SIR-PS3-012` stays deferred** (no darwin-specific
  failure is identified by code inspection; Lane B process tests provide
  the evidence).

## 14. Lock and atomic-write semantics on APFS

- `openSync('wx')` (O_CREAT|O_EXCL): supported on APFS; the Gateway's own
  compatibility probe verifies exclusive creation **at every store
  bootstrap** and records the result — the built-in fail-closed evidence
  for this primitive on the actual volume.
- Atomic rename: `rename(2)` is atomic on APFS (same volume); the
  installer's activate-via-rename and `writeFileAtomic`
  (tmp + fsync + rename + dir fsync) hold. Replacing an **empty**
  reserved directory via rename (component activation) is POSIX-identical.
- fsync: APFS supports file and directory fsync; durability is weaker
  than ext4 in edge configurations — the probe records
  `regularFileFsync`/`directoryFsync` and the storage crash suite
  (`test:storage-crash`) is mandated on the darwin lane by
  platform-support-contract §3.6. Any divergence gets **recorded, not
  assumed**.
- Symlink no-follow: probe-verified (`O_NOFOLLOW` honored on APFS).
- Lock unlink/release (unlink-before-close): POSIX-identical.
- Case-insensitive target collisions: impossible for the fixed-lowercase
  store layout (§6.3); exclusive-create collision of `.lock` siblings is
  case-exact (same string).
- **No closed race findings are reopened:** the PS-2/PS-3/PS-4 lock
  design and the Gateway's own primitives are exactly what the probe
  exercises on the target volume at runtime.

## 15. CI lane design (proposed exact matrix)

All workflows are written locally under the PS-6 envelope; execution is
the external human gate (§16). Proposal — **three workflow files**:

| Lane | Runner (real, current labels) | Purpose | Jobs |
|---|---|---|---|
| **A — Linux x86_64 regression** | `ubuntu-24.04` (or `ubuntu-latest` pinned to a major) | regression confidence on the validated lane | (1) `build`: checkout (pinned SHA), `npm ci` (lockfile), `npm run build`, `npm run typecheck`, `npm test` (self-contained, 187 tests — no external artifacts, no secrets); (2) `package`: `npm pack` + PS5-LINUX-001 executable regressions (already in the suite); (3) focused lifecycle/conformance against fixtures **only when a fixture source is configured** (see §18) — default skip with an explicit `skipped: fixture-source not configured` outcome. No full PS-5 manual E2E rerun per invocation (documented: Lane A physical E2E remains the release evidence; CI is regression). |
| **B — macOS arm64 first-class evidence** | `macos-15` (arm64 — Apple Silicon; current GA label; see §16) | first-class support evidence | (1) `build`: exact Node 22.23.2 arm64 from the official nodejs.org tarball (SHA-pinned, deterministic — no setup-node floating), `npm ci`, build, typecheck, full test suite; (2) `package-executable`: npm pack + extraction + direct exec (PS5-LINUX-001 transfer); (3) `apfs-path-cases`: case-variant identity test (add `Project`/re-add `project`), symlink alias test, NFC/NFD spelling test, realpath/dev+ino evidence, volume case-sensitivity record (`diskutil info /` or probe output), `/tmp`/`/private/tmp` canonicalization note; (4) `installer+lifecycle` (real stack): batch installer, project add/list/remove/re-add, doctor, start, Gateway MCP handshake, store owner/mode/no-follow, storage crash suite — **runs only when fixtures are configured** (§18); (5) `pi-guard`: Pi 0.83.0 lane install (npm tarball, SHA-pinned) + extension-load probe (PS-5 methodology) + version facts. |
| **C — macOS Intel compatibility-only** | `macos-15-intel` (explicit Intel label) | compatibility/focused evidence ONLY — **creates no support claim** | (1) `build` (same node tarball x64); (2) `package` + static portability checks; (3) selected unit tests; (4) **refusal honesty test**: installer on darwin-x64 → `UNSUPPORTED`, exit 2, no receipt; doctor → `unsupported` platform verdict, exit 2. Installer/product runtime steps are **absent by policy**. |

Optional fourth lane (local, no workflow): **Lane D physical UAT** (§24).

Node acquisition: exact `node-v22.23.2-darwin-arm64.tar.gz` /
`-darwin-x64.tar.gz` / `-linux-x64.tar.gz` from nodejs.org with pinned
SHA-256 recorded in the workflow constants — satisfies "deterministic
package installation from lockfiles" for npm and "no floating component
refs" for node (the runner preinstalled node is never trusted for the
evidence lane; exact-version tarball is).

Git 2.45.4 on Lane B/C: built from source into the workspace
(`~/git-2.45.4`) following the PS-5 Linux lane method (no sudo, no
floating refs — exact tag `v2.45.4` pinned), or a pinned formula; recorded
origin+version per platform-support-contract §3.8. This is the one
provisioning step with build time; it is a documented macOS requirement,
not an abstraction.

## 16. GitHub Actions feasibility (verified against current documentation)

- **Native arm64 (Apple Silicon) hosted runners are real and GA.**
  Current GitHub-hosted runner labels: `macos-14`, `macos-15`,
  `macos-26` (and `macos-latest`) are **arm64** images; Intel images are
  the explicit `macos-15-intel` / `macos-26-intel` labels. macOS 15 GA
  was 2025-04-10; macOS 26 GA 2026-02-26. **Do NOT assume a label: the
  arm64 labels above are the current documented reality; the workflow
  pins the label explicitly.**
- Availability/billing: arm64 macOS runners are available for **public**
  repositories (free, unlimited) and **private** repositories (billed
  minutes at macOS rates).
- **Project limitation:** pi-shuttle currently has **no GitHub remote**
  (repo creation is an external human gate — test-and-release-plan §3).
  Therefore Lane B/C **execution** requires: (1) pi-shuttle repository
  creation (human gate), (2) GitHub Actions authorization (human gate).
  No service tier blocks arm64 **for a public repo**; a private repo pays
  macOS minutes. The readiness analysis records both paths; the workflow
  design is tier-neutral.
- Local verification before any push (§16 of the task): the workflow
  files can be (1) written and (2) committed locally under the PS-6
  envelope. Local verification without GitHub: YAML syntax check,
  action-ref pin audit (all `uses:` pinned to full commit SHAs with
  comment), shell-step review, and — where `act`-style local runners are
  unavailable for macOS arm64 images — the workflow's steps are kept
  thin wrappers around **the same Node scripts the test suite already
  runs locally**, so the logic is locally executable and CI adds only
  runner/artifact plumbing. (3) push and (4) GitHub execution remain
  external, human-gated actions — never assumed.

## 17. Workflow security

- No secrets for the basic build/test lanes (fixture-based real-stack
  jobs also use no secrets — see §18).
- No release publication: no npm publish, no GitHub release, no artifact
  hosting, no deployment steps anywhere in the proposed workflows.
- No untrusted pull-request shell interpolation: all steps use argv-array
  or fixed strings; `workflow_dispatch` string inputs, if any, are
  validated and never concatenated into shell.
- Actions pinned by full commit SHA (checkout, upload/download-artifact)
  with a comment naming the tag; no floating `@main`/`@v4` refs.
- Minimal permissions: `permissions: contents: read` at workflow level;
  no token scopes beyond checkout; no `GITHUB_TOKEN` writes.
- No sudo: git 2.45.4 source build and node tarball extraction are
  user-space operations under the workspace.
- Deterministic package installation: `npm ci` from the committed
  lockfile; node/git from pinned-SHA tarballs/tags; artifacts SHA-pinned
  against the manifest.

## 18. Cross-repository CI composition (verified against repo state)

Facts: the **Gateway repository has no remote (local-only)**; pi-guard is
a **private** GitHub repo (`mfx-labs/pi-guard`, private, MIT, package
private); the Gateway package is `UNLICENSED`/private; public artifact
hosting is an unexecuted human gate. Consequently:

| Option | Feasibility today | Tradeoff |
|---|---|---|
| Checkout exact GitHub repo + commit (Gateway) | **BLOCKED** — no remote exists; adding one is the Gateway project's own authorization | Strongest provenance; also blocked for pi-guard (private → checkout needs credentials = secrets, violating §17) |
| Repository variables/constants pinned to exact SHA | **Partially usable** — pins (already in `manifest.ts`) are fine as single source of truth, but variables cannot convey binaries; remote reachability is still required | Complement, not a solution |
| **Package fixtures prepared from exact commit** | **FEASIBLE** — the PS-5 discipline: clean clone at pinned HEAD → `npm ci` → build → `npm pack` → SHA-256; fixture manifest records commit + digest | No secrets; matches the approved "distribution unified through pi-shuttle" and "no component-monorepo" decisions; provenance = pinned commit + digest recorded in the fixture manifest, verified by the installer against the pins |

**Decision for the implementation gate:** the workflows implement a
`fixture-source` switch. Default (no remote, no secrets): self-contained
jobs run; the real-stack jobs report an explicit
`skipped: fixture-source not configured — real-stack evidence requires
Lane A/D physical runs or authorized component remotes`. When a fixture
source is configured (future: authorized Gateway remote; or an approved
fixture staging location), the same jobs activate with
checkout@exact-commit or SHA-verified fixture download. **Remote
acquisition is a test/release concern only; the production installer
never acquires component source from a remote (it installs SHA-pinned
artifacts) — unchanged.** No component-monorepo architecture is
introduced; the three repositories stay independent; pi-shuttle remains
the unified distribution point.

## 19. Exact Gateway implementation inventory (A)

Files likely affected (all inside the approved PS-6 envelope):

1. `src/trusted/host-lane.ts` — closed accepted-lane set
   (`linux-x86_64-posix-utf8-node22` + `darwin-arm64-posix-utf8-node22`);
   `isSupportedHostLane` set membership; updated lane-contract comment.
2. `src/trusted/types.ts` — `hostLane` type widened to the two-lane union.
3. `src/trusted/validate.ts` — validated configuration stamps the
   validated operand (`options.hostLane`) instead of the constant (line
   ~731).
4. `src/trusted/containment-validate.ts` — `isSupportedHostLane(configuration.hostLane)` (line ~172).
5. `src/control-plane/storage-bootstrap-action.ts` — `StorageBootstrapActionInput` gains `hostLane`; `bootstrapStore` uses it as the operand (line ~171).
6. `src/bootstrap/run.ts` — derives the lane from the host at the CLI
   boundary and passes it into `bootstrapStore`.
7. `src/runtime/mcp/lanes.ts` — `buildWorkspaceLanes` accepts the lane
   operand (line ~252); threaded from the CLI composition.
8. `src/runtime/mcp/cli.ts` — the single host observation point
   (`process.platform`/`process.arch` → lane), used by both `bootstrap`
   and runtime modes so identity is stable across both.
9. `src/conformance/runner.ts` — operand (line ~874) for the darwin-lane
   conformance run.
10. `tests/trusted/host-lane.test.ts` — accepted-lane set changes
    (darwin-arm64 accepted; `macos-arm64-…`, `darwin-x86_64-…` remain
    rejected); lane-bound identity tests; cross-lane identity-difference.
11. New tests: containment-validate darwin-lane; storage replay
    cross-lane rejection (Linux metadata under darwin lane →
    fail closed); storage suite + crash suite on darwin (evidence lane).
12. Docs: **new Gateway ADR** (accepted-lane set; APFS case-insensitivity
    assessment of the fixed-lowercase layout — the probe records
    `caseSensitive:false` without failing, and the metadata/profile model
    already captures it; fsync-evidence acceptance); runbook host-lane
    row update.

No change: `src/storage/probe/probe.ts` (host-lane-neutral; records the
case profile), `src/storage/initialization/*` (identity binding already
lane-bound via `configurationIdentity`), `src/runtime/mcp/config.ts`
(lane stays a trusted operand, never a config field), MCP surface,
authority semantics, package version.

## 20. Exact pi-shuttle implementation inventory (B)

1. `src/compat/manifest.ts` — promote `DARWIN_ARM64_HOST_LANE` from
   `gatedLanes` to `supportedLanes` (the single normative flip; the
   manifest remains the only claim source).
2. `src/command/doctor.ts` — darwin-only node-arch check (probe
   `process.arch` of the discovered node on `darwin+arm64`; Rosetta node →
   `unsupported`); optional darwin volume case-sensitivity **note**
   (observation, not verdict; the claim stays manifest+probe bound).
3. `src/installer/preflight.ts` — message wording (the gated-lane suffix
   becomes stale once promoted; keep the refusal text for darwin-x64).
4. `src/installer/install.ts` — quarantine-xattr strip line, **only if**
   Lane B evidence shows a quarantine-bearing artifact path; otherwise no
   change.
5. `src/host/environment.ts` — no change expected (mapping already
   correct); possibly a comment update.
6. Tests (see §23): manifest-lane promotion pins; doctor darwin
   supported/unsupported taxonomy (existing gated-state pins at
   `manifest.test.ts:45`, `doctor.test.ts:305`, `installer-preflight.test.ts:18`
   flip to supported/refused respectively); darwin node-arch probe;
   APFS case-variant lifecycle test (runs on any platform where
   `realpath` behaves, parameterized for the darwin lane).
7. No change: identity derivation, registry, writer/lock, runner,
   lifecycle, receipt (already lane-string-generic), start.

## 21. CI / document inventory (C/D)

- `.github/workflows/lane-a-linux-regression.yml` (Lane A)
- `.github/workflows/lane-b-macos-arm64.yml` (Lane B)
- `.github/workflows/lane-c-macos-intel-compat.yml` (Lane C)
- `scripts/prepare-fixtures.sh` (local, human-run: clean-clone at pinned
  commits → build → pack → SHA fixture manifest; the PS-5 evidence
  method as a repeatable script)
- Docs: `docs/platform-support-contract.md` (Lane B/C evidence rows +
  macOS git/Node provisioning requirements), `docs/test-and-release-plan.md`
  (CI lane definitions + fixture-source policy), this report.

## 22. No-change components (E)

- **pi-guard: NO source change required — verified.** v0.1.2 (tag ==
  HEAD `7a7580cc…`) is pure TypeScript with no platform-specific code, no
  native dependencies, no os/cpu-restricted packages; pi-shuttle's
  detect/install/verify path (ADR-037 predicate) is platform-neutral.
- No change: pi-shuttle identity formula, registry semantics, lock
  design, process boundary, receipt model, install/rollback semantics,
  Gateway MCP surface, Gateway authority semantics, storage engine.

## 23. Proposed tests for the implementation gate

**Platform:** linux x64 supported (unchanged pins); darwin arm64
supported (manifest promotion + installer proceeds + doctor `supported`);
darwin x64 unsupported (installer `UNSUPPORTED` exit 2, doctor
`unsupported` exit 2, no receipt); windows unsupported (existing).

**Path identity (Lane B, real APFS):** case variants (`Project` vs
`project` → same realpath, same workspaceId/storeId, second add = exact
replay, registry still 1 surface); symlink alias (add via symlinked path →
canonical root recorded; both spellings deregister identically); Unicode
spelling variants (NFC vs NFD input → one object → one identity);
dev+ino pair evidence; `gitHome`/`gitTmpdir` containment unchanged.

**Installer:** direct executable (0755 + shebang + direct exec of
installed symlink — PS5-LINUX-001 transfer); artifact digests
(digestVerified both components); root refusal (uid 0 fixture); mode
audit (0600/0700, no group/world bits); Pi policy unchanged (0.83.0
accepted, 0.84.x refused on darwin too).

**Lifecycle (real stack, fixture-gated):** add/list/remove/re-add;
Gateway bootstrap verb (initialized → verification-replay, metadata
byte-identical); configuration identity derived by the Gateway (never
pi-shuttle); store-v1 shape; doctor exit 0 healthy; start → MCP handshake
(initialize, nine tools, clean EOF, protocol-clean stdout); confinement
negatives (out-of-workspace refuse).

**Gateway:** darwin-arm64 lane accepted and bound into identity;
cross-lane identity differs (linux vs darwin canonical bytes);
cross-lane replay rejection (Linux store metadata under darwin lane →
fail closed, no repair); `macos-arm64-…`/`darwin-x86_64-…` still TCF-028;
containment-validate under darwin lane; storage + crash suites on the
darwin lane; conformance runner on the darwin lane.

**CI:** Lane A green (self-contained); Lane B green (self-contained +
APFS cases + refusal honesty); Lane C green (compat-only + refusal
honesty); real-stack jobs report explicit skip when fixtures are absent.
**No brittle global test-count pins** (assert suite exit 0, not totals —
the existing 187/187 baseline is a historical record, not a CI pin).

## 24. Physical macOS arm64 UAT boundary

- **CI can close:** implementation correctness — build, install
  (batch), lifecycle, doctor, Gateway conformance, APFS path/case
  evidence, Pi 0.83.0 install + extension-load, crash-suite results,
  refusal honesty. All of these are mechanical facts verifiable on a
  hosted arm64 runner.
- **Physical Apple Silicon UAT (Lane D) remains required before final
  release (PS-8):** the interactive installer experience, real operator
  HOME/network conditions, Gatekeeper/quarantine reality of a real
  download, Pi interactive runtime under 0.83.0, tunnel/ChatGPT journey
  (PS-7), and the authoritative recorded journey per
  platform-support-contract §4/test-and-release-plan Lane D. This matches
  the normative plan: PS-6's own gate is "Lane B green + Lane D journey
  recorded"; PS-8 requires the zero-state pilot on Lane D. **No
  emulator/CI evidence is presented as physical-device evidence.**
- What PS-6 can close **before PS-7**: everything above except the
  tunnel/ChatGPT journey; the PS-6 report records Lane D as required,
  not done, if no Apple Silicon host is available at gate time.

## 25. Contract escalations

**NONE required.** Verified against the escalation list:

- Project identity formula: **unchanged** (sha256 of canonical root;
  realpath canonicalization is the existing contract, not a new
  case-folding semantic).
- Path case-folding: **not introduced** — no string normalization
  anywhere; filesystem canonicalization only (contract §5 step 1 already
  mandates it).
- Artifact canonicalization: unchanged (Gateway byte-exact JCS lane).
- Authority/trusted-identity semantics: unchanged (host lane already
  participates in identity; the darwin lane is a new accepted operand
  value, which is the approved PS-6 change, not a semantic change).
- Case-sensitive APFS requirement: **not introduced** — analysis shows
  the fixed-lowercase layout + realpath identity maintain the invariants
  on default APFS; the Gateway ADR + Lane B evidence is the approved
  closure (platform-support-contract §3.2).
- Pi compatibility broadening: none (0.83.0 only; 0.84.x refusal
  unchanged).
- macOS Intel broadening: none (rejected; Lane C is compatibility-only
  evidence, never a claim).
- Privileged installer behavior: none (no sudo, per-user only).
- Gateway architecture: host-lane parameterization only — the exact
  approved envelope.

Ordinary platform branches/tests/CI files are in-envelope; the only
human-attention items are the pre-approved ones: the Gateway ADR review
(APFS/fsync evidence acceptance) and GitHub Actions/repo authorization.

## 26. Remaining release risks (carried forward)

- **PS5-LINUX-002 — OPTIONAL HARDENING (npm-pack 0775 component dirs):**
  unchanged significance on macOS (same npm-pack shape, 0700 parent
  mitigation); optional 0700 normalization at activation remains a
  later-gate option. Not elevated by macOS evidence.
- **PS5-LINUX-003 — RELEASE-PIPELINE EVIDENCE (Gateway dependency
  materialization):** becomes **more important on macOS** only in the
  operational sense that every release lane (A and B) needs the same
  pinned `npm install --no-save --omit=dev` step; the step itself is
  platform-neutral. Unchanged classification (release-pipeline, not a
  product defect).
- **macOS Git 2.45.4 provisioning** is a new explicit release/ops
  requirement (§11) — the single most concrete macOS-only burden; it must
  appear in the install docs and the Lane B/C provisioning scripts.
- Secure MCP Tunnel / ChatGPT onboarding remains **PS-7** (docs only;
  no tunnel code).
- Public artifact hosting (installer URL, Gateway/pi-guard artifact
  distribution) remains an external human gate; it is also the upstream
  dependency of any future in-CI real-stack job without local fixtures.
- Component source reachability for CI (§18) — Gateway remote creation /
  pi-guard access are external authorizations; until then the fixture
  path is the evidence lane.
- Physical macOS arm64 UAT (Lane D) remains later evidence; CI evidence
  is not a substitute.
- pi-shuttle repository creation + Actions authorization (external
  human gates) before any workflow executes remotely.

## 27. Exact Git status (end of this gate)

- pi-shuttle (`master`, HEAD `42c1e5b3bd53c5b922b9635c86ecdceb123c9847`):
  exactly one untracked, unstaged file —
  `docs/reports/pi-shuttle-ps-6-macos-ci-readiness-analysis.md` (this
  report). No tracked changes; no commits; no push.
- Gateway (HEAD `7f3b4afdb43704e7dac82da7b086d8367347c641`): no tracked
  changes; the 4 pre-existing WP-13D untracked entries unchanged.
- pi-guard (HEAD `7a7580cc4cbd7926797564c72269394fc29a860a` = `v0.1.2`):
  no tracked changes; the 8 pre-existing v0.1.1 review-doc untracked
  entries unchanged.
- No production code modified in any repository; no real-Pi mutation; no
  network writes beyond read-only registry metadata inspection for this
  analysis.

## 28. Readiness verdict

Implementation scope is exact, mechanical, and fully inside the
human-approved PS-6 envelope. Code inspection confirmed: the Gateway host
lane is already an explicit trusted operand (the change is the closed
accepted-lane set + operand threading + ADR — precisely what the contract
named); store identity is lane-bound so cross-lane replay fails closed by
construction; pi-shuttle's platform gate is manifest-driven (one
promotion + small darwin doctor branch + tests); default APFS maintains
the identity/confinement invariants through existing realpath
canonicalization and the fixed-lowercase layout (no case-folding
semantic, no case-sensitive volume requirement); Pi 0.83.0 and pi-guard
0.1.2 are platform-neutral (WASM-only native dep; pure-TS extension);
native arm64 GitHub-hosted runners are currently real (macos-15/macos-26
arm64 labels) with explicit Intel labels for Lane C; the CI design needs
no secrets and no publication. The only environmental constraints are
external human gates by design (repository creation, Actions
authorization, component-source reachability for the real-stack CI jobs,
physical Lane D UAT) — none of them blocks the implementation itself,
and the workflow design degrades honestly (explicit fixture-source skip)
until those gates open.

`PS-6 IMPLEMENTATION — READY`
