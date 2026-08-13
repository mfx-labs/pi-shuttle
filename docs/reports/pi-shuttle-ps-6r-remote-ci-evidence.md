# PS-6R — Remote CI Evidence Report

**Gate type:** COORDINATED PUBLICATION PUSH → REMOTE EVIDENCE.
**Pushed baselines:**

- Gateway (mfx-labs/project-gateway, `main`): `98d1b204…` →
  `28f1d3a12382bc145376c8d8a2d87d89495785ec` (fast-forward, normal push).
- pi-shuttle (mfx-labs/pi-shuttle, `master`): `2076575efb…` →
  `1c69beb718ba9907426cdb9ec931f9054962e9c7` (fast-forward, normal push).
- pi-guard: `7a7580cc4cbd7926797564c72269394fc29a860a` = `v0.1.2`,
  unchanged, no mutation.

**Outcome:** all three committed workflows triggered by the final
pi-shuttle push ran GREEN on the exact PS-6R composition; Lane B proved
the full 24-point PS-6R evidence checklist on a native macOS arm64
runner. No force push, no tag, no release, no publication, no
deployment, no source correction required.

---

## 1. Pre-push verification (all passed)

| Check | Result |
|---|---|
| Gateway HEAD == `28f1d3a12382bc145376c8d8a2d87d89495785ec` | ✓ |
| Gateway parent == `98d1b204a864596bda91bec1104b8a8d5e89e1cd` | ✓ |
| Remote `origin/main` == expected parent before push | ✓ `98d1b204…` |
| Gateway tracked tree clean; WP-13D debris untracked, not staged | ✓ |
| pi-shuttle HEAD == `1c69beb718ba9907426cdb9ec931f9054962e9c7` | ✓ |
| pi-shuttle ancestry contains `03afe5ab…` and provenance-sync `1c69beb…` | ✓ |
| Remote `origin/master` == `2076575…` (ancestor of local HEAD) | ✓ |
| pi-shuttle tracked tree clean | ✓ |
| Active Gateway pin == `28f1d3a…` at every active location (manifest, prepare-fixtures.sh, Lane B workflow env+ref, manifest tests, workflow-security test) | ✓ |

## 2. Pushes (normal fast-forward, verified post-push)

| Repo | Push | Remote after (fetched) |
|---|---|---|
| Gateway `main` | `98d1b20..28f1d3a` | `28f1d3a12382bc145376c8d8a2d87d89495785ec` == local ✓ |
| pi-shuttle `master` | `2076575..1c69beb` | `1c69beb718ba9907426cdb9ec931f9054962e9c7` == local ✓ |

## 3. Workflow runs (triggered by pi-shuttle push @ `1c69beb`)

| Lane | Run ID | Result | Duration |
|---|---|---|---|
| Lane A — Linux x86_64 regression | `31671798245` | **success** | 52s |
| Lane B — macOS arm64 evidence | `31671798257` | **success** | 3m17s |
| Lane C — macOS Intel refusal | `31671798284` | **success** | 38s |

## 4. Lane B — mandatory PS-6R evidence (run `31671798257`)

Observed from job logs (`Build + tests (darwin arm64)` +
`Real-stack integration (public multi-repo)`):

| # | Requirement | Observed evidence |
|---|---|---|
| 1 | native macOS arm64 runner | `Image: macos-15-arm64`; `uname -m` = arm64 assertion step green |
| 2 | exact CI Node baseline 22.23.2 | SHA-pinned `node-v22.23.2-darwin-arm64.tar.gz` (shasum -c OK); `real-stack: lane facts — node=darwin arm64 nodeVersion=v22.23.2` |
| 3 | exact CI Git baseline 2.45.4 | digest-pinned kernel.org source build; `GIT_VERSION = 2.45.4`; `git=git version 2.45.4` |
| 4 | exact public Gateway checkout `28f1d3a…` | checkout step + `GATEWAY_COMMIT: 28f1d3a…` env; `fixture: gateway baseline verified (28f1d3a12382bc145376c8d8a2d87d89495785ec)` |
| 5 | exact pi-guard checkout `7a7580c…` | `PI_GUARD_COMMIT: 7a7580cc4cbd7926797564c72269394fc29a860a`; checkout + tag fetch |
| 6 | Gateway HEAD assertion PASS | fixture `verify_checkout` fail-closed HEAD match (see #4) |
| 7 | pi-guard HEAD assertion PASS | `fixture: pi-guard baseline verified (7a7580cc…, v0.1.2)` (tag asserted) |
| 8 | on-runner fixture preparation PASS | `Build fixtures from exact public checkouts` step green; fixture manifest written |
| 9 | Gateway artifact provenance records new source commit | fixture manifest `"gateway": { "commit": "28f1d3a…" }`; `real-stack: fixture manifest commits match the repository-owned pins` |
| 10 | Gateway digest coherent with runtime fixture manifest | `real-stack: fixture digests verified against fixture-manifest.json` (shasum -c); runtime digest `ba929a6a7d5907d1d1b5b4f3db7b5e47451a3221753126bae20409a99b15db5e` — **identical to two independent local rebuilds** |
| 11 | installer result COMPLETE | `real-stack: installer COMPLETE` (run 1 truthful PARTIAL pre-materialization, run 2 COMPLETE) |
| 12 | Gateway installed-verified | `receipt: gateway + pi-guard installed-verified` |
| 13 | Gateway digestVerified = true | `--expect-gateway-sha256` matched fixture-manifest digest → receipt `digestVerified` |
| 14 | pi-guard installed-verified | `receipt: gateway + pi-guard installed-verified` |
| 15 | pi-guard digestVerified = true | `--expect-pi-guard-sha256` matched; pi-guard tgz `057f1b63…` (unchanged from PS-5 record) |
| 16 | APFS strict evidence PASS | `APFS evidence: PASS — 3 evidence tests executed and passed (case variant, Unicode NFC/NFD, symlink alias; one filesystem object ⇒ at most one registration) on darwin` (mandatory step, no silent skip) |
| 17 | PS6-MAC-001 duplicate-object guard PASS | `ok 2 - PS6: case variant on default APFS — one filesystem object, at most one registration (PS6-MAC-001)` |
| 18 | lifecycle PASS | `real-stack: lifecycle green (add → list → exact re-add → doctor → remove → re-add)` |
| 19 | doctor exit 0 | doctor run asserted non-zero-exit-fails; `platform: supported` grep |
| 20 | `pi-shuttle start` starts the real installed Gateway | MCP handshake probe executed through `pi-shuttle start` (ci-lane-b-real-stack.sh §9) |
| 21 | MCP exposes exactly 9 public tools | `MCP handshake OK: initialize + exactly 9/9 tools verified, clean EOF exit 0` |
| 22 | isolated Pi 0.83.0 + pi-guard loader evidence PASS | isolated lane `npm install @earendil-works/pi-coding-agent@0.83.0`; loader file test; `pi-guard compatibility probe: PASS — guard command + required events (session_start, session_shutdown, before_agent_start, tool_call) verified through pi's own loader; tools at load: 0` |
| 23 | no fixture_source transport | zero `FIXTURE_SOURCE` references in workflow or logs |
| 24 | no secrets/sudo/publication | no sudo usage; only the runner's standard `Secret source: Actions` header; no publish/release/deploy steps |

Lane B full suite on runner: **227 tests, 224 pass, 0 fail, 3 truthful
skips** (darwin truthfulness discipline). Lane B remains exact-baseline
evidence (Node 22.23.2 / Git 2.45.4 / Pi 0.83.0) — the deliberate
PS-6R design; broader runtime compatibility is not CI-tested here.

## 5. Lane A — Linux x86_64

**success** (run `31671798245`): full self-contained suite
**227 tests, 221 pass, 0 fail, 6 truthful linux-side skips**; no
PS-6R regression.

## 6. Lane C — macOS Intel

**success** (run `31671798245`'s sibling `31671798284`): job
`Build/package/refusal honesty (darwin x64)` —
`result: UNSUPPORTED — platform darwin x64 (lane darwin-x64) is not a
claimed supported lane; supported lanes: linux-x86_64-posix-utf8-node22,
darwin-arm64-posix-utf8-node22`; installer refused (exit 2, no receipt);
doctor `platform: unsupported`. Intel truthfully refused — not
reinterpreted as supported.

## 7. Recorded facts

- Gateway push SHA: `28f1d3a12382bc145376c8d8a2d87d89495785ec` (remote `main` verified equal)
- pi-shuttle push SHA: `1c69beb718ba9907426cdb9ec931f9054962e9c7` (remote `master` verified equal)
- Workflow run IDs: A `31671798245`, B `31671798257`, C `31671798284`
- Lane A result: GREEN; Lane B result: GREEN (24/24 PS-6R points); Lane C result: GREEN (truthful Intel refusal)
- Exact Gateway checkout observed by Lane B: `28f1d3a12382bc145376c8d8a2d87d89495785ec`
- Runtime Gateway artifact digest: `ba929a6a7d5907d1d1b5b4f3db7b5e47451a3221753126bae20409a99b15db5e` (reproducible across two local builds + on-runner build)
- Exact pi-guard checkout: `7a7580cc4cbd7926797564c72269394fc29a860a` = `v0.1.2` (digest `057f1b63…` unchanged)
- Installer: COMPLETE; Gateway installed-verified + digestVerified; pi-guard installed-verified + digestVerified
- Doctor: exit 0; MCP: 9/9 tools; lifecycle: green; APFS + PS6-MAC-001: PASS

`PS-6R REMOTE EVIDENCE — ACCEPTED`
