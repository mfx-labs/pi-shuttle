# PS-6I — macOS Intel Support: Focused Senior Review

Review scope (gate §12, exactly): platform classification; host-lane
identity isolation; cross-lane replay; Intel CI semantics; PS-6R
compatibility preservation; physical Intel smoke evidence.
Review date: 2026-08-13. Reviewer: focused senior review pass over the
PS-6I reattached chain on the authoritative baseline (pi-shuttle `5b0e60d`
+ `afd7f75` + reports commit on `5efff90e`;
Gateway `55f76429`; pi-guard unchanged `7a7580cc` v0.1.2).

## 1. Platform classification — PASS

- The one new lane is `darwin-x86_64-posix-utf8-node22`, following the
  frozen lane naming convention (`darwin-<arch>-posix-utf8-node22`); the
  protocol vocabulary uses `x86_64` (TrustedHostLane), the process
  vocabulary uses `x64` (Node) — consistent with the existing
  linux/darwin-arm64 lanes. No new vocabulary invented.
- pi-shuttle acceptance is manifest-bound: `supportedLanes` gains the
  Intel lane; install preflight, `project add`, `doctor`, and `start`
  all classify through the same `hostLane()` mapping + manifest check —
  no per-command drift. `doctor` reports `platform: supported — darwin
  x64 (lane darwin-x86_64-posix-utf8-node22)` on the physical host.
- The darwin-arm64 native-arm64 Node requirement is untouched (still
  enforced in doctor and unchanged in tests); the Intel lane correctly
  requires no arch probe beyond the running interpreter.
- Unsupported hosts still fail closed: win32 remains the covered
  negative case in doctor/start/project-add tests; the Gateway CLI exit-2
  path and TCF-028/TCP-011 predicates remain for every non-member
  string (including `macos-*` spellings).

## 2. Host-lane identity isolation — PASS

- `hostLane` remains a first-class member of the canonical configuration
  projection; the Intel lane yields its own deterministic digest for
  identical inputs (tested: determinism + pairwise inequality with both
  existing lanes).
- The nine POUV2 oracle fixtures carry lane-keyed expected identities;
  the Intel entries were derived with the committed JCS/domain-prefix
  method, whose correctness was demonstrated by exactly reproducing all
  nine committed darwin-arm64 literals before computing the Intel
  values. MODERATE-2 independently re-derives every lane's literal from
  the fixture oracles and passes.
- Existing Linux and darwin-arm64 identity vectors are byte-preserved:
  fixture diffs are surgical (4 lines per fixture: one map entry + one
  literal + two commas); the linux entry must equal the preserved
  single-lane value (asserted). Conformance corpus passes 648/648 under
  each of the three lanes with zero expected-failure allowance.

## 3. Cross-lane replay — PASS

- Store metadata binds the lane-derived configuration identity;
  replaying a store under a different accepted lane fails closed with
  `ERR-STO-INTEGRITY` and no mutation. New tests cover:
  darwin-arm64 ↔ darwin-Intel (both directions) and darwin-Intel ↔
  Linux (both directions), including metadata byte-unchanged assertions
  and own-lane replay success afterwards.
- Physical store created under the Intel lane remains usable under the
  Intel lane across add → remove → re-add (verification-replay).

## 4. Intel CI semantics — PASS (ready; not executed)

- Lane C is transformed to first-class supported evidence on the
  existing GitHub Intel runner (`macos-15-intel`): exact Node 22.23.2
  darwin-x64 (SHA-pinned, `process.arch` ASSERTED x64), full suite,
  mandatory APFS evidence invocation (skip = red), exact Git 2.45.4
  digest-pinned provision, exact public component checkouts with HEAD
  assertions, fixture construction via the committed helper, real-stack
  evidence (installer COMPLETE → doctor → lifecycle → MCP 9/9 → Pi
  0.83.0 isolated lane). The real-stack orchestrator is
  architecture-neutral (label parameterized); Lane A/B behavior
  unchanged.
- Workflow static security invariants pass (permissions read-only,
  owner/repo@40-hex actions, no dispatch inputs, no fixture transport,
  helper scripts exist, exactly three lane workflows).
- Remote execution remains a separate human-gated action (not
  authorized in this gate) — consistent with prior gates.

## 5. PS-6R compatibility preservation — PASS

- Runtime policy unchanged and re-verified on the physical host:
  Node 22.23.1 ≥ 22.19.0 accepted; Git 2.37.1 ≥ 2.30.0 accepted (subject
  to the Gateway's own Git binary safety checks — unchanged); Pi 0.84.1
  treated as a non-baseline candidate and accepted only because the
  committed pi-guard compatibility probe PASSED (installer + doctor).
- Exact CI baseline versions (22.23.2 / 2.45.4 / 0.83.0) remain
  reporting-only; no equality gates introduced. The `node22` lane suffix
  remains a frozen opaque label (frozen-constant tests extended, not
  relaxed).
- No Intel-specific Git semantics were added (no evidence required);
  ownership/mode/fingerprint/sanitized-env/no-shell/read-only Git
  surfaces are untouched.

## 6. Physical Intel smoke evidence — PASS

Full journey on MacBookPro13,3 (macOS 12.7.6, APFS, Node v22.23.1 x64,
Git 2.37.1, Pi 0.84.1; disposable canonical HOME): installer PARTIAL →
materialize → COMPLETE (digestVerified, installed-verified); doctor exit
0; project add/list/exact-re-add (exact replay); APFS alias tests —
case alias and Unicode NFC/NFD alias both `ERR-PS4-REG-DUPLICATE-OBJECT`,
symlink alias exact replay, one store per object, no duplicate
authority; `pi-shuttle start` launches the real installed Gateway; MCP
exactly 9/9 tools (no authority/exec surfaces); bounded
`inspect-registry` read OK; pi-guard loads through Pi 0.84.1's own
loader with `guard` command + required events; remove preserves the
store; re-add reuses the same locator (one history); fresh-shell doctor
exit 0. Quarantine: release-download path not exercised (recorded;
strip-after-verify ordering code-enforced and unit-tested).

## 7. Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | Info | Default login shell on this host resolves `node` to v20.20.2 (< minimum); doctor refuses truthfully (exit 2). Operator's effective session (nvm v22.23.1) is healthy. | Operator-environment note; no product change. |
| F2 | Info | Two pre-existing Gateway bootstrap-action tests fail on macOS tmpdir canonicalization (`/var`→`/private/var`); reproduced on pristine baseline; unrelated to PS-6I. | Separate Gateway-repo fix recommended; not a PS-6I defect. |
| F3 | Info | pi-shuttle remote authority resolved at the publication gate: master HEAD verified `5efff90e…`; archive baseline tree-identical; PS-6I reattached by cherry-pick (no force push). | Resolved. |
| F4 | Info | Lane C CI not executed (remote Actions require separate authorization). Workflow exact-pinned + statically checked. | Executed at the authorized remote gate. |

No correctness, security, or identity findings. No contract escalation
triggered: the change is one independent lane with unchanged existing
lane semantics.

## 8. Verdict

Implementation and focused review are clean. Coordinated LOCAL baseline
commits exist (pi-shuttle, Gateway); pi-guard unchanged. Nothing is
pushed, tagged, published, or deployed.

PS-6I — LOCALLY BASELINED
