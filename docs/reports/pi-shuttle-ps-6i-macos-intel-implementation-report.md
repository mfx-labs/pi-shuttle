# PS-6I — macOS Intel Support Readiness → Implementation Report

Status: implementation complete; focused senior review follows in
`pi-shuttle-ps-6i-macos-intel-focused-review.md`.
Date: 2026-08-13 (physical session, MacBookPro13,3).

## 1. Physical host facts

| Fact | Value |
|---|---|
| macOS | 12.7.6 (Build 21H1320) |
| Hardware | MacBook Pro, MacBookPro13,3 — Intel Core i7-6700HQ @ 2.60 GHz |
| `uname -m` | `x86_64` (native Intel; NOT a Rosetta case) |
| Filesystem | APFS (default, case-insensitive) — `/` and test volume |
| Shell | `/bin/zsh`; user UID 501 |
| Node | v22.23.1, `process.arch = x64`, platform `darwin` (native Intel) |
| Git | 2.37.1 (Apple Git-137.1), `/usr/bin/git` |
| Pi | 0.84.1 (`/Users/serene/.nvm/versions/node/v22.23.1/bin/pi`) — non-baseline candidate |

## 2. Baselines

| Component | Baseline | Verification |
|---|---|---|
| pi-shuttle | Authoritative `mfx-labs/pi-shuttle` master @ `5efff90e932547caf442777d09f3fb4e9423a2f9` (verified by fetch at the PS-6I publication gate). The archive-derived local baseline `2acc8183…` was proven tree-identical to `5efff90e…` (zero-diff tracked trees) and is therefore historical evidence ancestry only; the PS-6I chain was reattached onto the authoritative history by cherry-pick (PS-6I publication gate §4). Pre-existing untracked Lane D report separated to `/tmp/ps6i/backup/` per gate §1. | tree diff `5efff90e…` vs `2acc8183…` = 0 files |
| Gateway | `mfx-labs/project-gateway` @ `28f1d3a12382bc145376c8d8a2d87d89495785ec` cloned; clean. PS-6I change committed locally as **`55f764290a4567a20557f1db19d2a6fb97572a97`** (ADR-043). | `git rev-parse HEAD`, clean tree |
| pi-guard | `mfx-labs/pi-guard` @ `7a7580cc4cbd7926797564c72269394fc29a860a` = `v0.1.2`, clean. **Unchanged by PS-6I.** | `git rev-parse HEAD`, `describe --tags` |

## 3. Prior unsupported behavior (inventory)

Authoritative locations that treated macOS Intel as unsupported before PS-6I:

- **Gateway `src/trusted/host-lane.ts`**: closed two-member accepted set;
  `trustedHostLaneForPlatformArch('darwin','x64') → null`; doc comment
  explicitly named `darwin-x86_64-*` unsupported.
- **Gateway `src/runtime/mcp/cli.ts`**: unsupported-host message listed
  `linux-x86_64, darwin-arm64`; Intel exited 2 before any validation.
- **Gateway `src/conformance/runner.ts`**: `staticIdentityByLane`
  completeness required exactly the two lanes.
- **Gateway docs**: ADR-042 decision 2 ("macOS Intel remains
  unsupported"); operator runbook accepted-lane row.
- **pi-shuttle `src/host/environment.ts`**: `hostLane('darwin','x64')`
  fell through to the unclaimed `darwin-x64` spelling.
- **pi-shuttle `src/compat/manifest.ts`**: `supportedLanes` = Linux +
  darwin-arm64 only.
- **pi-shuttle CI `.github/workflows/lane-c-macos-intel-compat.yml`**:
  Lane C purpose = refusal honesty (installer/doctor MUST refuse Intel).
- **pi-shuttle docs**: platform-support-contract §1 matrix row
  "unsupported unless evidence"; installation-contract §4;
  operator-cli-contract status vocabulary; component-boundaries §3/§4.2;
  work-packages PS-6; test-and-release-plan Lane C; README.
- **pi-shuttle tests**: host.test.ts, manifest.test.ts,
  installer-preflight.test.ts, doctor.test.ts, lifecycle.test.ts,
  start.test.ts pinned Intel refusal.

Canonical architecture vocabulary (verified, not guessed):
`x64` at process-facing boundaries (Node `process.arch`),
`x86_64` at protocol boundaries (TrustedHostLane). The `node22` suffix is
a frozen opaque protocol label (PS-6R), never a runtime equality gate.

## 4. New host-lane design (Gateway, ADR-043)

One new accepted trusted lane, exactly:

```
darwin-x86_64-posix-utf8-node22
```

- Closed accepted set is now exactly three members; the predicate remains
  set membership (TCF-028 / TCP-011 / CLI exit 2 for everything else).
- `trustedHostLaneForPlatformArch` maps `darwin + x64` → the new lane;
  the mapping remains the ONE derivation at the operator CLI boundary.
- The lane inherits the existing POSIX/UTF-8 protocol semantics
  byte-for-byte; no Intel-specific Git/filesystem/identity semantics.
- Existing lanes `linux-x86_64-posix-utf8-node22` and
  `darwin-arm64-posix-utf8-node22` are NOT renamed or modified.
- Cross-lane replay fails closed, including darwin-arm64 ↔ darwin-Intel
  (`ERR-STO-INTEGRITY`, no repair/migration) — proven by new
  bootstrap-action tests.
- The darwin-arm64 native-arm64 Node rule is unchanged; the Intel lane
  requires no arch probe (x64 is its native architecture).

## 5. Exact paths changed

**Gateway (commit `55f76429`):**
- `src/trusted/host-lane.ts` — third lane constant, type, set, predicate,
  mapping; doc comment.
- `src/trusted/index.ts` — export `DARWIN_X86_64_HOST_LANE`.
- `src/runtime/mcp/cli.ts` — supported-host message lists all three lanes.
- `src/conformance/runner.ts` — lane-map completeness requires all three.
- `fixtures/pointofuse-v2/POUV2-{003,004,009,011,012,018,022,024,031}.json`
  — `staticIdentityByLane` gains the Intel entry + `oracle.
  intelConfigurationIdentity` literal (surgical 4-line edits per fixture;
  all existing Linux/darwin-arm64 vectors byte-identical).
- `src/generated/corpus-bundle.ts` — regenerated (embeds fixture content).
- `tests/trusted/host-lane.test.ts`, `tests/trusted/containment-host-lane.
  test.ts`, `tests/unit/bootstrap-action.test.ts`, `tests/integration/
  conformance.test.ts` — three-lane acceptance, Intel identity
  determinism, Intel ≠ arm64 identity, cross-lane replay both directions,
  containment under all three lanes, Intel corpus 648/648, MODERATE-2
  Intel derivation.
- `docs/decisions/ADR-043-darwin-x86-64-macos-intel-trusted-host-lane.md`
  (new); `docs/decisions/ADR-042-…md` (PS-6I addendum);
  `docs/operations/project-gateway-operator-runbook.md` (accepted-lane
  row).

**pi-shuttle (authoritative reattached chain on `5efff90e…`):**
- `src/host/environment.ts` — `hostLane('darwin','x64')` →
  `darwin-x86_64-posix-utf8-node22`; canonical-vocabulary doc comment.
- `src/compat/manifest.ts` — `DARWIN_X86_64_HOST_LANE`; `supportedLanes`
  = three lanes; `GATEWAY_PS1_BASELINE_COMMIT` → `55f76429…` (PS-6I
  local baseline: the exact source closure of the packaged Gateway
  artifact; supersedes the PS-6R public pin `28f1d3a…`, which predates
  the Intel lane; public push is a separate human-gated action).
- `src/installer/preflight.ts`, `src/command/doctor.ts` — comments only;
  behavior is manifest-bound (darwin arm64 native-arm64 rule untouched).
- `.github/workflows/lane-c-macos-intel-compat.yml` →
  **`lane-c-macos-intel.yml`**: transformed from refusal honesty to
  first-class Intel real-stack evidence (`macos-15-intel`; exact Node
  22.23.2 darwin-x64 SHA-pinned, arch ASSERTED x64; full suite; mandatory
  APFS evidence invocation; exact Git 2.45.4 provision; exact public
  Gateway/pi-guard checkouts with HEAD assertions; fixture construction;
  installer COMPLETE; doctor healthy; MCP 9/9; Pi 0.83.0 isolated lane).
  Lane A and Lane B workflows unchanged in behavior (only the Gateway
  pin moved with the coordinated baseline).
- `scripts/prepare-fixtures.sh` — expected Gateway baseline →
  `55f76429…` (exact SHA, fail-closed).
- `scripts/ci-lane-b-real-stack.sh` — architecture-neutral; closing
  label parameterized via `EVIDENCE_LABEL` (LANE B / LANE C).
- `tests/unit/{host,manifest,installer-preflight,doctor,lifecycle,start,
  runtime-compat,ci-workflow-security}.test.ts` — Intel acceptance,
  win32 as the unsupported case, frozen-lane assertions include the
  Intel constant, workflow pins.
- Docs: `platform-support-contract.md` (matrix + §2/§3/§4),
  `installation-contract.md`, `operator-cli-contract.md`,
  `component-boundaries.md`, `work-packages.md`, `test-and-release-plan.
  md` (Lane C), `README.md`.

## 6. Identity consequences

- Configuration identity already binds `hostLane`; the Intel lane
  produces its own deterministic identity digest for identical inputs —
  proven distinct from both existing lanes (unit tests).
- POUV2 static-identity oracles are lane-keyed; the nine fixtures now
  carry all three lane entries. Intel values were derived by the same
  committed method (JCS + domain prefix) used for the darwin literals;
  the derivation was validated by first reproducing ALL nine committed
  darwin literals exactly, then computing the Intel literals.
- Existing Linux and darwin-arm64 identity vectors are byte-preserved
  (asserted by tests and by surgical fixture diffs: 4 changed lines per
  fixture).
- Cross-lane replay between darwin-arm64 and darwin-Intel fails closed
  (`ERR-STO-INTEGRITY`), both directions, with no store mutation —
  proven by bootstrap-action tests.
- No migration exists or is added; the new lane receives its own
  configuration identity naturally.

## 7. Focused verification (no broad regression re-runs)

**Gateway (commit `55f76429`):** `npm run build` + `npm run typecheck`
clean; `git diff --check` clean. Focused suites:
`trusted/host-lane`, `trusted/containment-host-lane`,
`trusted/containment-correlation`, `unit/bootstrap-action`,
`integration/conformance` — **61/63 pass**. The 2 failures
(`bootstrap action: workspace surface resolves canonical root…`,
`forbidden-root overlap…`) are PRE-EXISTING macOS environment
sensitivities (tmpdir `/var/folders` realpath → `/private/var/folders`),
reproduced identically on the pristine baseline (git stash check) and
unrelated to the lane change; recorded as remaining risk. Conformance
corpus: **648/648 under each of the three lanes** (linux, darwin-arm64,
darwin-Intel), no expected-failure allowance; MODERATE-2 lane-oracle
derivation test green.

**pi-shuttle (reattached chain):** build + typecheck clean;
`git diff --check` clean. Full unit suite: **225 pass, 0 fail, 3
truthful skips** (SIR-PS2-009 Gateway-CLI fixture skips — pre-existing
design). APFS evidence tests: **3/3 pass on this Intel host** (no skip).

## 8. Physical Intel smoke (this MacBookPro13,3, disposable HOME)

Disposable HOME `/private/tmp/ps6i/smoke/home` (canonical path — the
Gateway's WP-7 HOME validation rejects symlink path components, so the
first attempt under `/tmp/…` was re-run under `/private/tmp/…`;
documented macOS `/tmp` canonicalization, platform-support-contract
§3.3). Fixtures built on-machine from the exact Gateway
`55f76429…` + pi-guard `7a7580cc…` checkouts via the committed
`prepare-fixtures.sh` (fixture manifest: gateway
`2fff4316…`, pi-guard `057f1b63…`).

| Step | Result |
|---|---|
| Installer run 1 | truthful `PARTIAL` (dependency materialization pending), exit 1; **`platform lane: darwin-x86_64-posix-utf8-node22`**; pi 0.84.1 compatibility probe **PASS** before Pi-side mutation |
| Gateway deps materialized | exact pins `@modelcontextprotocol/server@2.0.0 ajv@8.20.0 zod@4.4.3` |
| Installer run 2 | **`COMPLETE — all selected components installed and verified`**; receipt: gateway + pi-guard `installed-verified`, `digestVerified: true` (both), piVersion 0.84.1, verifiedBy `pi-list` |
| doctor (pre-registration) | platform supported (lane `darwin-x86_64-posix-utf8-node22`); node 22.23.1 supported; git 2.37.1 supported; **pi 0.84.1 candidate — probe PASS**; exit 1 only for the expected missing-runtime-config finding |
| project add | registered; `pgw:w:a256c4c5…`; store initialized; exit 0 |
| project list | exactly 1 logical project |
| exact re-add | `already registered (exact replay; no registry change)`; no duplicate |
| doctor (post-registration) | **exit 0**; all rows supported; 1 registered surface |
| APFS case alias (`ALPHA`) | same dev+ino (16777221/60502866), different canonical spelling → **`ERR-PS4-REG-DUPLICATE-OBJECT`**; no second registration |
| APFS symlink alias (`alpha-link`) | same dev+ino, identical canonical → **exact replay**; no registry change |
| APFS Unicode alias (NFC↔NFD `café`) | same dev+ino (16777221/60503024), distinct canonical spellings → **`ERR-PS4-REG-DUPLICATE-OBJECT`**; no second authority |
| `pi-shuttle start` | launches the REAL installed Gateway composition (packages/…/dist/runtime/mcp/cli.js) |
| MCP surface | **exactly 9/9 public tools** (`validate-artifact`, `inspect-stored-record`, `inspect-registry`, `inspect-audit-history`, `verify-record`, `enumerate-class`, `draft-artifact`, `persist-artifact`, `inspect-changes`); no shell/exec/approval/issuance/grant tools; clean EOF exit 0 |
| Bounded read | `inspect-registry` against the test project surface → `ok:true` (registry generation + scanned entries) |
| pi-guard on real Pi 0.84.1 | loader loads pi-guard with zero load errors; `guard` command + required events (`session_start`, `session_shutdown`, `before_agent_start`, `tool_call`) registered; exact source confirmed in `pi list` |
| project remove | `deregistered`; **trusted store preserved** (metadata files intact); Git history untouched |
| project re-add | same workspace/store id, `verification-replay` — state reused, one history, no second store |
| Fresh shell | `env -i` + zsh (clean environment): `pi-shuttle` resolves from `~/.local/bin`, **doctor exit 0** — installation independent of transient shell state |
| Quarantine | locally built artifacts carry no `com.apple.quarantine` (verified via xattr); the installer's strip-after-digest-verify-before-extract ordering is code-enforced (`verifyArtifactFile → stripQuarantineAttribute → extractArtifact`) and unit-tested. **`QUARANTINE RELEASE-DOWNLOAD EVIDENCE — NOT EXERCISED`** (no release-download path exists yet; not a Lane D failure). |

## 9. Remaining risks / operator-visible friction

1. **Default login-shell Node shadowing (friction, product-correct):**
   a fresh login shell on this machine resolves `node` to
   `/usr/local/bin/node` **v20.20.2** (below the 22.19.0 minimum; nvm's
   v22.23.1 is not wired into `.zprofile`/`.zshrc`). `pi-shuttle doctor`
   truthfully refuses (unsupported, exit 2). The operator's effective
   session (nvm v22.23.1 first on PATH) is fully healthy (doctor exit 0).
   Recorded as an operator-environment note, not a product defect.
2. **Pre-existing Gateway test env sensitivity:** two bootstrap-action
   tests fail on macOS tmpdir canonicalization (`/var` → `/private/var`);
   reproduced on the pristine baseline; unrelated to PS-6I. Recommend a
   separate macOS-aware fix in the Gateway repo.
3. **Coordinated local baseline pinning:** `gatewayCommit` /
   `prepare-fixtures.sh` / lane workflows now pin Gateway
   `55f76429…` (exact SHA). Remote execution (Lane A/B/C on GitHub) is
   not authorized in this gate and requires the Gateway repo to be
   pushed first (separate human-gated action).
4. **pi-shuttle remote authority:** resolved at the PS-6I publication gate —
   `mfx-labs/pi-shuttle` was fetched and its master HEAD verified as the
   exact expected `5efff90e…`; the archive-derived baseline was proven
   tree-identical to it, and the PS-6I deltas were reapplied onto the
   authoritative history by cherry-pick (no force push; the archive
   chain `2acc8183… → 251bcae…` remains local evidence ancestry only).
5. **Lane C CI not executed** (remote Actions require separate human
   authorization; consistent with prior gates). The workflow is
   repository-owned, exact-pinned, and statically security-checked
   (ci-workflow-security tests green).
6. macOS 12.7.6 on MacBookPro13,3 is recorded as a validated physical
   evidence point, not a universal minimum macOS version.

## 10. Gate compliance notes

- No broad regression suites re-run (no full Gateway npm test, no
  POUV2 full corpus beyond the three-lane focused runs required by the
  identity change, no CI lane scripts). The pi-shuttle full unit suite
  was run once because it is the small lane-C-equivalent surface and
  includes the APFS evidence tests relevant to this host.
- No push/tag/release/publication/deployment performed. Local baseline
  commits only (PS-6I reattached chain): pi-shuttle `5efff90e…`
  (authoritative baseline, unchanged) + `5b0e60d` (implementation) +
  `afd7f75` (workflow rename) + reports commit (final SHA recorded at
  push); Gateway `55f76429`; pi-guard unchanged at `7a7580cc`.
- No product redesign; the change is a lane-additive supported-domain
  extension. Existing lane identity semantics unchanged → no contract
  escalation required.
