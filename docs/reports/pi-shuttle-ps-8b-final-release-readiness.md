# PS-8B — v0.1.0 Clean-Room Pilot + Final Release Readiness — Report

**Date:** 2026-08-14
**Gate type:** final local release-readiness evidence (no product
mutation; no push/tag/release/upload/publication).
**Starting HEAD:** `bc41338b4158d2499195581d43e5c45c8c298e4a`
(`feat: prepare v0.1.0 release distribution`).
**Final classification:** `PS-8B — CORRECTION REQUIRED` — a genuine,
release-blocking product defect was discovered by the pilot:
`persist-artifact` (one of the nine public Gateway MCP tools) fails
deterministically on every macOS lane because the Gateway's controlled
write executor is Linux-only (`/proc/self/fd` descriptor anchoring).
See §17. No commit was created (product defect present).

---

## 1. Baseline verification (§1)

| Check | Result |
|---|---|
| HEAD | `bc41338b4158d2499195581d43e5c45c8c298e4a` ✓ |
| Working tree | no unexpected tracked changes (only pre-existing untracked: `dist-release/`, PS-6I report, `.DS_Store`) ✓ |
| origin/master | `b178169a45f6c26758c9bda077c40eba4789d389`; merge-base == origin/master; local master 2 commits ahead (59b092a, bc41338), no divergence ✓ |
| dist-release/v0.1.0 | rebuilt in this gate from exact clean component checkouts; **byte-identical** to the PS-8A baselined candidate ✓ |
| Gateway pin | `55f764290a4567a20557f1db19d2a6fb97572a97` (clean checkout) ✓ |
| pi-guard pin | `7a7580cc4cbd7926797564c72269394fc29a860a` @ tag `v0.1.2` (clean checkout) ✓ |

Rebuild performed once from fresh clones at the pins (builder re-verified
commit, tag, clean tracked state, and package identities for all three
packages). Asset inventory is exactly the six expected files.

## 2. Frozen candidate evidence (§2)

pi-shuttle HEAD `bc41338`; Gateway `55f764290a4567a20557f1db19d2a6fb97572a97`;
pi-guard `7a7580cc4cbd7926797564c72269394fc29a860a` @ `v0.1.2`.

| Asset | Size | SHA-256 |
|---|---|---|
| install.sh | 6980 | `b2e6f2137fb707edb8e62973af7539ff841a866a50e2f2147854973fe71e7a6e` |
| pi-shuttle-0.1.0.json | 1302 | `de27dd310eb23618b93ee9e555aa014befa04f5fbe4725b24161f06bb7c94602` |
| pi-shuttle-0.1.0.tgz | 92043 | `fe504f2048cba8826220bb09ba15cd7888fc0619898238894373ab562877a42e` |
| project-gateway-artifact-core-0.1.0.tgz | 3551096 | `ab765e043ce2892788fb0d9282e57e143ae99c12ab50328363add8459baacde9` |
| pi-guard-0.1.2.tgz | 24785 | `057f1b636328e8c77857a4b590d051fcc52c0c9b015ca5dd1a773c21d7d24d01` |

SHA256SUMS re-verified against every asset (and again after all evidence
runs — unchanged). No release asset changed after the freeze.

## 3. Lane A — Linux physical clean-room pilot (§3)

**BLOCKED — no verifiable physical Linux release-evidence host in this
gate.** The previously used Linux host (PS-5 E2E host, user `chef`) at
`157.245.52.253` presents a CHANGED SSH host key (stored ed25519
fingerprint `SHA256:Z8HYzQYXIkW6Gb8KjkP9MgWpzJn3pw/dDMv5OTeBWNg` vs
offered `SHA256:2x8a7oQ7yx2Tp16NImCoW603tz3ZvufgXJKY2w9BiMY`); its
identity cannot be verified and it was NOT used for authoritative
evidence. The PS-5 Linux physical E2E report exists but was produced at
an older pi-shuttle baseline (PS-4 era) and does not cover the v0.1.0
release-distribution delta; it is recorded as prior-baseline evidence
only. Docker Desktop is installed but its daemon is not running and a
container is not a physical host in any case. **Lane A remains an
unresolved evidence item for v0.1.0.**

## 4. Lane D — macOS arm64 (Apple Silicon) (§10)

`PS-8B LANE D — BLOCKED: PHYSICAL APPLE SILICON EVIDENCE UNAVAILABLE`

No physical Apple Silicon machine is available to this gate. Intel
evidence is NOT substituted for Lane D. (Independently, §17 shows the
persist defect would block the Lane D runtime journey regardless of
hardware.)

## 5. macOS Intel physical pilot (this host, fresh clean-room) (§3/§13)

Physical host: MacBookPro13,3, macOS 12.7.6, **x86_64**, **APFS**,
Node **22.23.1**, Git **2.37.1** (Apple Git), Pi **0.83.0** (isolated
npm lane, `@earendil-works/pi-coding-agent@0.83.0`, PATH-first; the
host's 0.84.1 candidate was never used).

Public-release simulation shape: fresh `HOME`
(`/Users/serene/ps8b-pilot/home`), disposable git project, local HTTPS
fixture serving the EXACT future layout
`/releases/download/v0.1.0/<asset>` (TLS validation ON via
`CURL_CA_BUNDLE`/`NODE_EXTRA_CA_CERTS`; wrong-path requests 404),
`PI_SHUTTLE_BASE_URL` pointing at that layout, the exact generated
`install.sh`, no developer-only flags:

1. `install.sh --batch --gateway yes --pi-guard yes` → **COMPLETE —
   all selected components installed and verified** (exit 0) ✓
2. receipt exists, **mode 0600** ✓
3. persistent bin link → `packages/pi-shuttle@0.1.0/dist/cli.js` ✓
4. `pi-shuttle --version` works ✓
5. `pi-shuttle doctor` after `project add` → **exit 0** (all checks
   supported) ✓
6. Gateway `installed-verified`, `digestVerified: true`, artifact SHA
   recorded == envelope SHA (`ab765e…`) ✓
7. pi-guard `installed-verified`, `verifiedBy: pi-list`, piVersion
   0.83.0 ✓

Project lifecycle (§4): `project add` → registration, trusted store
initialized (`store-v1` + `config-v1`), runtime config **0600**, git
isolation dirs (`git-home`/`git-tmp`), `project list` shows the surface;
re-add → exact idempotent replay, no duplicate, same store;
`project remove` → deregistration only (project dir + git repo + store
preserved); re-add → same store reused. ✓

Gateway runtime (§5): real MCP stdio handshake through `pi-shuttle
start` — `initialize` OK (server `@project-gateway/artifact-core`
0.1.0); **exactly nine tools** (`validate-artifact`,
`inspect-stored-record`, `inspect-registry`, `inspect-audit-history`,
`verify-record`, `enumerate-class`, `draft-artifact`,
`persist-artifact`, `inspect-changes`); NO shell/exec/push/approval/
issuance/grant/admin tools. Operations:

- registry/read: `inspect-registry` OK ✓
- Git/change inspection: `inspect-changes` OK — fresh changed set
  (README.md, `M`), bounded diff ✓
- validation: `validate-artifact` OK ✓
- bounded draft: `draft-artifact` OK (valid, TaskSpec fixture) ✓
- bounded persist: `persist-artifact` **FAILED — `write-failed /
  missing-parent`** (see §17 — THE DEFECT)
- workspace confinement: out-of-set path (`/etc/passwd`) rejected ✓
- read-only Git: gateway made no git mutation (no staging/commits;
  only the operator's own file edit appeared in the changed set) ✓

pi-guard lane (§6): installed through the REAL Pi package path on the
Pi 0.83.0 known-good lane — `pi list` shows the exact pinned source
(`packages/pi-guard@0.1.2`); the committed compatibility probe run
directly against the real 0.83.0 loader: **PASS** (`guard` command +
`session_start`/`session_shutdown`/`before_agent_start`/`tool_call`
events); extension entry present; no unrelated Pi extension modified
(fresh lane store) ✓

## 6. Doctor honesty audit (§7)

- **A. Complete healthy install** (pilot HOME): doctor **exit 0**,
  every check `supported` ✓
- **B. Partial install** (fresh HOME, gateway only): installer
  `PARTIAL — not installed: pi-guard` (exit 1); receipt records
  `PARTIAL` + `omitted: ["pi-guard"]`; doctor reports
  `pi-guard component: missing` and exits 1 — never claims complete
  health ✓
- **C. Broken condition** (corrupted receipt on a disposable HOME):
  doctor fails closed (`installation receipt is invalid … not valid
  JSON`, exit 1) with **no auto-repair** — receipt bytes untouched;
  disposable state restored ✓

## 7. Rollback drill (§8)

Fresh disposable HOME + tampered Gateway artifact served from a second
fixture (same layout, same envelope, corrupted
`project-gateway-artifact-core-0.1.0.tgz`): the release acquisition
layer refused with `ERR-REL-ACQUIRE-DIGEST-MISMATCH` (computed
`59ea44e5…` vs expected `ab765e04…`), exit 2, **before any activation**;
no receipt, no packages dir, no staging residue, no temp leftovers;
"no installation changes were made; prior installation state (if any)
is preserved". Trusted stores untouched (none existed). ✓

## 8. Installer idempotence (§9)

Same v0.1.0 installer rerun on the healthy pilot HOME: **COMPLETE**
again, same package dirs (no duplicates), `project list` still 1
surface, runtime config **byte-identical** before/after, receipt
coherent, project/store state intact. ✓

## 9. Release candidate reproducibility (§12)

Second independent builder run from the same exact clean checkouts:
**SHA256SUMS byte-identical**; all five assets byte-identical
(`cmp`-verified). This is the third consecutive byte-identical build
(PS-8A baseline + PS-8B rebuild + PS-8B reproducibility run).
**No unexplained release-byte drift.** ✓

## 10. Public-release simulation (§13)

The §5 pilot IS the final local rehearsal: version-specific acquisition
(`/releases/download/v0.1.0/<asset>`), HTTPS, envelope + package
verification, component acquisition, complete installation, persistent
executable, receipt, doctor. This is **local QA only** — explicitly not
a public GitHub Release installation.

## 11. Existing Intel evidence reuse (§11)

The PS-6I macOS Intel physical report (same physical host, older
baseline) remains applicable for the unchanged installer-core surface;
the v0.1.0 release-distribution delta is covered by this gate's pilot
on the same host. Recorded as reused, not rerun. Lane B (macOS arm64)
CI evidence was previously recorded as never-executed (PS-6 report §4);
no arm64 runtime evidence exists anywhere.

## 12. PS-7 external status

Live ChatGPT custom-app E2E remains `EXTERNAL QUALIFIED ACCEPTANCE
EVIDENCE` (PS-7R), not a v0.1.0 release blocker when blocked solely by
eligible workspace availability. It is NOT claimed passed.

## 13. License blocker (§15)

`V0.1.0 LICENSE DECISION REQUIRED` — pi-shuttle remains `private: true`,
`license: UNLICENSED`, no root LICENSE; no license chosen in this gate.
Public distribution must not proceed without a separate human license
decision. `private: true` is not itself a blocker and remains unchanged.

## 14. Documentation audit (§14)

- README: official URL explicitly **"not live yet"**; version-specific
  URL shape; end users never clone Gateway/pi-guard after release;
  no live-E2E claim ✓
- installation-contract: no `latest`, no floating versions ✓
- operator-cli-contract §5: `project remove` deregisters only —
  matches observed behavior ✓
- platform-support-contract: lane matrix accurate as written, but the
  darwin-arm64 support row cites "Lane B CI + Lane D physical journey"
  evidence that has never been produced — already true before this
  gate; the §17 defect additionally invalidates the README's
  "currently validated supported platforms" claim for macOS until the
  persist path works on darwin.
- test-and-release-plan / work-packages: PS-8 gate and UNLICENSED
  distribution-authorization provisions match this gate's outcome.
- No documentation was rewritten (a genuine discrepancy exists only as
  a consequence of §17; recorded here, not silently edited).

## 15. Release-readiness security audit (§16)

No secrets/credentials/private keys/personal paths in any asset; no
`.git`/`.DS_Store`/node_modules debris in any artifact (0 matches);
no unexpected executables or network hosts (allowlist still
github.com + release-assets.githubusercontent.com); no floating
version references; no `latest`; no unverified component path;
no authority/tool-surface expansion (9/9 tools, no tenth). SHA256SUMS
and embedded digests re-verified after all evidence runs — unchanged. ✓

## 16. Final state / no-mutation confirmation

No push, no tag, no GitHub Release, no upload, no npm publish, no
deploy. Component checkouts remain clean and unmuted (gateway
`55f76429…`, pi-guard `7a7580cc…` @ `v0.1.2`). No product mutation was
performed. pi-shuttle HEAD unchanged (`bc41338`).

## 17. DEFECT — PS8B-DEFECT-001 (release-blocking, CRITICAL)

**`persist-artifact` fails on every macOS lane in the v0.1.0 candidate.**

- **Affected path:** Gateway `src/writing/executor.ts` (also
  `src/completion/writer.ts`, same pattern) — the trusted controlled
  write executor anchors every filesystem mutation through Linux-only
  `/proc/self/fd/<fd>/…` descriptor paths (11 references; `fdRelativePath`
  always returns `/proc/self/fd/…`). There is **no darwin branch and no
  `/dev/fd` fallback** anywhere in the executor / lanes / compose chain.
- **Evidence:** macOS 12.7.6 x86_64 physical pilot — real MCP handshake
  via `pi-shuttle start`; `draft-artifact` OK (valid); `persist-artifact`
  → `{"ok":false,"error":{"code":"write-failed","reason":"missing-parent"}}`,
  deterministically reproduced (two independent runs). Root cause: on
  macOS `/proc` does not exist; the descriptor-anchored open fails with
  ENOENT which the executor maps to `missing-parent`.
- **Invariant violated:** the darwin-x86_64 lane is a declared supported
  lane (ADR-043, PS-6I) and darwin-arm64 likewise (ADR-042, the
  authoritative Lane D); the installer accepts macOS, doctor reports a
  healthy installation, the receipt says COMPLETE — but one of the nine
  public tools (a core bounded-write operation, required by the pilot
  contract: "one bounded draft/persist operation inside the approved
  project") cannot complete. macOS support is claimed but not
  functional at the persistence boundary.
- **Why it was not caught earlier:** the Gateway checkout contains no
  CI workflows; the pi-shuttle PS-6 Lane B (macOS arm64) evidence was
  never executed; PS-6I verified the 9/9 tool SURFACE on Intel but no
  real persist write; the Linux PS-5 E2E (where persist works) is the
  only runtime persist evidence.
- **Required correction (separate focused gate, NOT this gate):** a
  darwin-capable controlled-write strategy in the Gateway (e.g.,
  openat-equivalent descriptor anchoring available on macOS, or a
  darwin executor preserving the same no-follow/exclusive-create/
  resolution-identity invariants), verified on both darwin lanes,
  followed by a NEW Gateway pin, envelope rebuild, and full re-evidence.
  This requires moving the frozen Gateway pin — a human-authorized
  contract decision.
- **Contract escalation:** required (component pin movement after a
  Gateway correction).

## 18. Verdict

`PS-8B — CORRECTION REQUIRED`

A real product defect (PS8B-DEFECT-001) blocks the macOS lanes of the
v0.1.0 release candidate. Per the gate contract, the release-readiness
verdict is STOPPED; no commit was created.

Remaining blockers after the correction: `V0.1.0 LICENSE DECISION
REQUIRED`; Lane A (Linux physical) evidence for v0.1.0; Lane D
(physical Apple Silicon) evidence — `BLOCKED: PHYSICAL APPLE SILICON
EVIDENCE UNAVAILABLE`; live ChatGPT E2E (external qualified acceptance);
public push/tag/release/upload authorization. v0.1.0 is NOT released.
