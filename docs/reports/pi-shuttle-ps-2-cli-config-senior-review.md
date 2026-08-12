# PS-2 — pi-shuttle CLI / Configuration Model — Senior Review

**Reviewer:** senior security / architecture reviewer (read-only gate).
**Status:** review complete. **Verdict:** CORRECTIONS REQUIRED (see §16, §20).
**Date:** PS-2 review gate. No production code, tests, contracts, or tooling
were modified; nothing staged, committed, pushed, tagged, or published.

---

## 1. Baseline / reviewed tree identity

| Item | Value |
|---|---|
| Repository | `/home/chef/Documents/pi-shuttle` |
| Baseline HEAD (expected) | `f190b32da520e890e72a8f59f8c250f3efeb2007` — `docs: establish pi-shuttle PS-0 product contract` |
| Baseline HEAD (observed) | `f190b32da520e890e72a8f59f8c250f3efeb2007` — **unchanged** |
| Implementation state | uncommitted, unstaged (see §19) |
| Gateway PS-1 baseline | `7f3b4afdb43704e7dac82da7b086d8367347c641` — **verified**: it is the current HEAD of `/home/chef/Documents/Project_Gateway_MCP` (`feat: establish pi-shuttle PS-1 operator bootstrap`); not modified |
| pi-guard | `7a7580cc4cbd7926797564c72269394fc29a860a` (tag `v0.1.2`) — verified present in the pi-guard repo; unchanged |
| Reviewed tree | `src/` (12 files), `tests/unit/` (8 files), `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.tests.json`, `README.md` delta, `docs/reports/pi-shuttle-ps-2-cli-config-implementation-report.md` |

## 2. Scope

Read-only, risk-focused senior review of the PS-2 CLI/configuration
foundation against the PS-0 normative contracts (`docs/product-contract.md`,
`docs/component-boundaries.md`, `docs/installation-contract.md`,
`docs/operator-cli-contract.md`, `docs/platform-support-contract.md`,
`docs/test-and-release-plan.md`, `docs/work-packages.md`,
`docs/decisions/ADR-001-operator-bootstrap-authority-and-product-boundary.md`).

Method: full source/test/package inspection, independent re-verification of
the implementation report's claims, focused test executions, two targeted
read-only concurrency experiments, and read-only cross-checks of the Gateway
PS-1 baseline (including its reviewed output writer) and the pi-guard pin.
No Gateway or pi-guard regression suites were run. No Gateway/pi-guard
source was modified.

## 3. PS-2 scope assessment — PASS

The approved PS-2 objective (work-packages §PS-2: skeleton, layout, manifest
embedding, runtime-config read/write, identity helpers, version/lane
constants, `--help`/`--version`, doctor skeleton) is respected. Verified by
source inspection, compiled-output inspection, and the static guard:

- **No installer/download/network code**: no `fetch`, no `node:http(s)`,
  `node:net`, `node:tls`, `node:dgram`, no network vocabulary anywhere in
  `src/` (guard-pinned and independently grepped).
- **No subprocess execution**: no `node:child_process` in `src/`
  (guard-pinned). The only `spawn` usage in the tree is inside tests, which
  invoke the compiled CLI as the review methodology's real-executable check.
- **No Gateway/pi-guard invocation or installation**: no reference to
  Gateway binaries, `project-gateway-mcp`, `initializeTrustedStore`, or
  pi-guard package vocabulary in `src/`.
- **No real `project add/remove` orchestration**: handlers fail closed
  (`deferred()` in `src/app.ts`) with exit 1, a typed PS-4 ownership note,
  and **no side effects** (dispatch is pure; nothing is written). The
  registry/persistence primitives exist as pure/model-layer components but
  are not wired to any command — verified in `src/app.ts`.
- **No Gateway startup composition**: `start` fails closed, exit 1.
- **No macOS host-lane implementation**: `darwin-arm64` exists only as a
  manifest **gated** lane constant; `hostLane()` maps darwin/arm64 to the
  proposed lane name but the manifest never claims it; doctor exits 2 on it.
- **No ChatGPT/tunnel logic**: no tunnel vocabulary, no OAuth, no
  credentials.
- **No auto-update, no daemon/service behavior**: none present.

Deferred-handler discipline is correct: deterministic message, deterministic
exit 1, zero partial side effects, no success reporting. The grammar/dispatch
seam is a clean, acceptable seam for PS-4 handlers.

## 4. CLI grammar and exit semantics

The exact public grammar is independently verified (source + tests + real
subprocess runs of the compiled CLI):

| Invocation | Result | Exit |
|---|---|---|
| `pi-shuttle --help` / `--version` | deterministic text; byte-stable across runs; zero filesystem/state reads | 0 |
| `pi-shuttle doctor` | skeleton report | 0/1/2 per state |
| `pi-shuttle project add <path>` | grammar OK; handler deferred | 1 |
| `pi-shuttle project list` | grammar OK; handler deferred | 1 |
| `pi-shuttle project remove <path-or-workspace-id>` | grammar OK; handler deferred | 1 |
| `pi-shuttle start` | grammar OK; handler deferred | 1 |
| no args | usage on stderr | 2 |
| unknown command / unknown `project` subcommand | typed error | 2 |
| extra operand on sole-operand commands (`doctor x`, `--help x`, `--version x`, `start x`) | typed error | 2 |
| `project add`/`remove` with 0 or 2+ operands | typed error | 2 |
| empty operand (`project add ""`) | rejected (length check) | 2 |
| operand starting with `-` (`project add -x`, `--help`) | rejected — paths may legally begin with `-` only if escaped, which is not in the approved grammar; fail-closed is correct here | 2 |
| `project list x` / `project add a b` / `project remove a b` | rejected | 2 |
| ambiguous nested forms (`project`, `project wat`) | rejected | 2 |

- Exact cardinality, empty/extra operand handling, and unknown-option
  handling are all closed and deterministic.
- Help/version are state-independent *with respect to product state*
  (no config/state reads) — one environment caveat: see finding SIR-PS2-010
  (HOME must be set even for `--help`/`--version`).
- Exit-code classification is the approved closed 0/1/2 set; exit 2's dual
  meaning (malformed invocation AND doctor unsupported-platform verdict) is
  the human-approved model (operator-cli-contract §2) and is unambiguous at
  the command level: for `doctor`, exit 2 always means
  unsupported-platform-or-invalid-invocation. No new exit-code model was
  introduced during review. Two classification defects found: doctor's
  `missing` verdict exits 0 (SIR-PS2-003) and the help text documents only
  the malformed-invocation half of exit 2 (SIR-PS2-004).

## 5. Configuration ownership and drift assessment — ACCEPTABLE (no duplicate Gateway authority)

`src/config/document.ts` is a closed-field **shape** model of the Gateway
startup document (`surfaces[]` with `surfaceId/locator/serviceUid/
forbiddenRoots/configurationIdentity/configurationVersion/limitProfile/
workspaces/gitPath/gitHome/gitTmpdir`), matching component-boundaries §3.
Verified facts:

1. **What pi-shuttle validates**: shape only — types, absolute-path form,
   non-negative safe-integer `serviceUid`, `sha-256:<64-hex>` syntax for
   `configurationIdentity` (REQUIRED, matching the post-PS-1 `start`
   profile — component-boundaries §4.1), number-valued `limitProfile`,
   closed field sets at document/surface/workspace level, unique
   `surfaceId`s.
2. **Intentionally shape-only**: no store verification, no digest checks, no
   WP-6 identity computation, no lane/semantic validation, no provenance or
   brand material. `configurationIdentity` is syntax-checked only — its
   *derivation* remains exclusively the Gateway's `bootstrap` verb
   (ADR-001 decision 2: pi-shuttle never computes trusted configuration
   identity).
3. **Exclusively Gateway-owned semantics**: WP-6 validation, store
   instance verification, lane containment, identity correspondence,
   initialization/replay — all remain inside the Gateway package at the
   pinned PS-1 baseline.
4. **Drift mechanics**: if the Gateway startup schema changes, divergence
   fails **closed at the Gateway loader** at `start`/`bootstrap` (a doc
   pi-shuttle accepts and Gateway rejects produces a typed Gateway error;
   the reverse produces a pi-shuttle rejection). Divergence is therefore
   never silent corruption — but it is discovered late (runtime, not
   build/test time). The manifest pins `gatewayCommit` to the PS-1
   baseline, giving the shape a fixed reference point.
5. **PS-4 composability**: PS-4 composes the bootstrap verb against the
   pinned manifest identity without duplicating Gateway validation — the
   verb resolves and emits the authoritative surface; pi-shuttle persists
   what the verb resolves (operator-cli-contract §3.5–3.7).
6. **Orchestration data, not trusted authority**: the document is
   ordinary operator-owned application config, written only by
   add/remove, read by list/doctor/start, passed verbatim to the Gateway
   CLI. Authority classes are visibly separated in code and comments.

**Assessment**: this is an acceptable operator-side typed composition
document under the approved contract, **not** a second authoritative Gateway
configuration schema and **not** a duplicate Gateway validator. Drift risk
exists but is bounded (fail-closed at the Gateway) and is tracked as
SIR-PS2-009 (optional hardening).

## 6. JSON intake and closed-document validation

`src/config/json.ts` independently verified:

- **1 MiB ceiling**: enforced twice — `fstatSync` size pre-check and a
  read loop that rejects `total > MAX`. The fd-bound loop also defeats
  file growth between `fstat` and read (a file that grows past the ceiling
  mid-read cannot exceed `MAX+1` bytes total, which is rejected). An exact
  1 MiB file is accepted; `MAX+1` rejected.
- **Duplicate-key scanner**: I traced the tokenizer against hostile inputs.
  - Scope tracking is correct: a stack of per-object key `Set`s with `null`
    for array levels; equal keys in different object scopes are never
    flagged; array elements are never treated as keys.
  - String contents containing braces/quotes/backslashes are consumed by
    the full escape-aware string reader, so `{"a}":1,"a}":2}`-style keys
    and `"a\":1"`-style values cannot corrupt scope or produce false
    positives.
  - Escaped-equivalent keys are caught: `\uXXXX` decoding makes
    `"\u0073urfaces"` ≡ `"surfaces"`; surrogate-pair escapes and literal
    astral characters decode to identical UTF-16 strings, matching
    `JSON.parse` key equality; `\u0022` (escaped quote) is consumed inside
    the escape path, not treated as a terminator.
  - Truncated/invalid escapes decode to garbage but those documents are
    rejected by `JSON.parse` afterwards — fail closed, no missed
    duplicates in the accepted domain.
  - String-followed-by-`:` is exactly the key condition in every
    *accepted* document; unknown escapes (`\x`), control chars, trailing
    garbage, and scope underflow all fail via `JSON.parse` or the scanner's
    own try/catch — never silently accepted.
- **Correlation**: the pre-scan and `JSON.parse` operate on the same
  UTF-8-decoded string (invalid UTF-8 bytes become U+FFFD identically in
  both), so scanner/parser key equality stays correlated.
- **Closed fields / types / numbers**: 15 closed-field rejection cases,
  wrong primitive types, negative/non-safe `serviceUid`, non-array
  `forbiddenRoots`, non-number `limitProfile` values, relative paths,
  malformed identity syntax, duplicate `surfaceId` — all rejected; nested
  unknown workspace fields rejected; empty `surfaces` accepted (valid
  empty runtime config). Verified in code and tests.
- **Gap**: the 1 MiB ceiling and fd-bound rejection have **no test**
  (SIR-PS2-005).

## 7. Filesystem / path model

`src/host/environment.ts` and all path-derived behavior verified:

- No hard-coded user-specific paths; layout derives entirely from the
  injected home (`~/.local/share|state|config/pi-shuttle`, `~/.local/bin`),
  identical on Linux and macOS, matching installation-contract §8 — no
  `~/Library` specialization.
- No `/usr/bin/git` or `/usr/bin/node` assumption anywhere; Git/Node
  discovery is explicitly deferred to PS-4 (PATH-based per
  platform-support-contract §2).
- `process.env` is confined to the host seam (guard-enforced, independently
  confirmed by grep); HOME is injected for tests.
- `canonicalizePath` (realpathSync) fails closed (null) on unresolvable
  paths; the security-relevant canonicalization seam exists and is
  documented as the PS-4 input gate.
- No path traversal grants authority: the document model requires absolute
  paths and rejects relative/`..`-shaped forms only as absolute-path
  syntax; no filesystem access follows any operator-supplied path anywhere
  in PS-2 (the registry treats paths as inert strings; only the writer
  touches pi-shuttle's own dirs).
- State/config layout stays under approved pi-shuttle-owned directories
  (writer creates parents 0700 under the injected home).
- Project paths are represented without implying write authority over
  project contents: `workspaces[].root` is an inert string in PS-2; no
  code writes into project roots.
- Symlinks/canonical roots: `realpathSync` resolution is the documented
  normalization; identity derives from the canonical form (see §8). macOS
  case semantics: PS-2 is **neutral** — it makes no case-handling claims;
  `darwin-arm64` stays gated and doctor exits 2 on it, so no APFS case
  equivalence is implied anywhere (platform-support-contract §3.2 satisfied
  by silence + gating; the PS-6 ADR remains the gate).
- One hardening item: a symlink at the *final config path* is silently
  replaced by `rename` rather than refused (SIR-PS2-006).

## 8. Project identity and registry invariants

Identity formula verified against operator-cli-contract §3 exactly:

```
storeId     = sha256(canonicalRoot).hex.slice(0, 32)      [32 hex chars]
workspaceId = "pgw:w:" + storeId
locator     = <shareDir>/stores/<storeId>
```

`src/registry/identity.ts` matches byte-for-byte (test re-derives the hash
independently). Facts:

- **Deterministic**: same canonical root → same id/locator (unit-pinned).
- **Collision domain**: 128-bit truncation of SHA-256 — the contract's own
  formula; acceptable per contract (not a review invention).
- **Input contract**: derivation assumes a canonical root; PS-4 owns
  canonicalization before derivation. Documented in the module header;
  no deviation.
- **Idempotent exact re-registration**: `registerSurface` no-ops on an
  exactly equal surface (returns the same document object; test-pinned).
- **Equivalent canonical roots** derive identical storeId/locator/
  workspaceId, so duplicate-by-equivalent-path is rejected by construction
  (`ERR-PS2-REG-DUPLICATE-STORE`), plus explicit duplicate-surfaceId and
  duplicate-workspaceId conflicts fail closed.
- **Deterministic list order**: code-unit sort by surfaceId
  (locale-independent; test-pinned).
- **Deregistration**: by surfaceId, workspaceId, or canonical root;
  unknown target → typed `ERR-PS2-REG-NOT-FOUND`, exit-class 1 at CLI
  level; **deregister-only by construction** — the model holds no fs
  capability and references store paths only as inert locator strings;
  no code path can delete project files, Git metadata, stores, or
  lifecycle evidence.
- **Re-add after remove**: PS-4 recomputes the same storeId from the
  canonical root, so the preserved store is found and replay-verified;
  the model loses no fact needed for safe re-add (the root is re-supplied
  by the operator). The contract's `registered-at (if recorded)` list
  field has no representation in the PS-2 model — acceptable ("if
  recorded"); PS-4 may add it.

## 9. Persistence and concurrency — MAJOR FINDING

`src/persistence/writer.ts` claims verified one by one:

| Claim | Verdict |
|---|---|
| same-directory temp file | verified (`${path}.tmp-${pid}`) |
| `wx` (exclusive create) | verified |
| mode 0600 via fchmod | verified (umask-immune) |
| complete-buffer write loop | verified (short writes looped; test-pinned) |
| zero progress fails closed | verified (throws → cleanup; test-pinned) |
| fsync (file) | verified before close |
| atomic rename | verified |
| directory fsync | verified after rename |
| idempotent exact-content no-op | verified (no rewrite; mtime preserved; test-pinned) |
| incompatible existing state fails closed | verified **sequentially** (predicate check; test-pinned) |
| no partial final-file exposure | verified (publication only via rename of a complete fsync'd temp) |
| failure-path tmp cleanup | verified (test-pinned, including unwritable parent and short-then-zero writes) |
| parent dirs 0700 created only when missing | verified |
| target mode 0600 after replace | verified |

**The concurrency invariant is NOT delivered.** The algorithm is
inspect → classify → write temp → `rename(temp, target)`, and POSIX rename
unconditionally replaces the target. The compatibility check and the
publication are not atomic with respect to each other. Two targeted
read-only experiments (run from `/tmp`, no repo modification) prove the
gap:

1. **Incompatible-overwrite race (deterministic, via the injected write
   seam — the exact window between check and rename):** an incompatible
   `{"foreign": true}` file created at the final path *after* the
   compatibility check was silently replaced; `writeFileAtomic` returned
   success. The identical sequential case correctly fails closed with
   `ERR-PS2-CONFIG-INCOMPATIBLE`. → The implementation report's claim
   "foreign/malformed content is never silently overwritten" is false
   under concurrency.
2. **Lost-update race (30 real concurrent processes, 3/3 runs):** all 30
   writers reported success; the final file contained **1** surface —
   29 registrations silently lost. The idempotent/no-op decision and the
   mutation race in the same way.

Conceptual comparison with the reviewed PS-1 scheme (Gateway
`src/bootstrap/run.ts`, `writeOutputFile`, SIR-PS1-002): PS-1 publishes via
`linkSync(tmp, path)` — an **atomic no-clobber** primitive whose module
comment explicitly says "The no-clobber guard is atomic (hard-link publish),
not a check-then-rename race." PS-2 mirrors the write-loop and the injectable
seam but **switched the publication primitive to `renameSync`, which always
clobbers**. (PS-2 legitimately needs *updates* — remove rewrites an existing
runtime.json — so PS-1's first-write-wins link scheme cannot be adopted
verbatim; the correction must serialize or guard the update path.)

The failing behavior can produce a silently dropped registration or a
silently destroyed foreign/malformed document — precisely what the
fail-closed posture exists to prevent. Findings: SIR-PS2-001 (MAJOR),
SIR-PS2-002 (MODERATE, same root cause).

## 10. Compatibility manifest truthfulness — PASS

`src/compat/manifest.ts` verified:

- `pi-shuttle 0.1.0` truthful; package version matches.
- Gateway `0.1.0` at commit `7f3b4afdb43704e7dac82da7b086d8367347c641` —
  **independently verified** to be the actual current HEAD of the Gateway
  repo (the PS-1 baseline; the pin is exact, not stale).
- pi-guard `0.1.2` at `7a7580cc4cbd7926797564c72269394fc29a860a` —
  verified present in the pi-guard repo; matches component-boundaries §1.
- Pi `0.83.0` (`pi-0.83.0-extension-api-v1`) is the only Pi claim; no
  `0.84` anywhere (test-pinned).
- Linux lane is the only `supportedLanes` entry; `darwin-arm64` is gated
  only — never claimed (test-pinned); macOS Intel is not mentioned at all
  (no claim = no support).
- Artifact digests are `null` — clearly unresolved release-time facts, not
  validated digests, and not placeholder strings (test-pinned).
- No `latest`, no semver ranges (`^`/`~` absent, test-pinned); exact pins
  only.
- `gatewayDependencies` pins are the contract-mandated compatibility
  assertion (product-contract §6), not an accidental second package
  manifest: installation-contract §3 freezes exactly these versions, and
  the Gateway package did not change its dependency set in PS-1. Drift
  would surface at PS-3 install verification. A single-source check at
  PS-3/PS-8 (compare against the installed package's own `package.json`)
  is recommended but not required now (SIR-PS2-009 note); no over-engineering.

## 11. Doctor skeleton truthfulness — PASS (one exit-classification defect)

- The closed vocabulary is exactly
  `supported / unsupported / installed but unverified / missing /
  partial installation` (test-pinned; used exactly; never embellished).
- Platform/architecture observation is truthful: Linux x64 → `supported`
  with the exact lane named (the contract's own verdict source for the
  platform check is OS/arch vs manifest matrix — no node/git/pi claim is
  made); darwin arm64 → `unsupported` with an explicit "gated: PS-6
  host-lane evidence required, not claimed" detail and exit 2 — the
  approved fail-closed verdict; macOS Intel and Windows → `unsupported`,
  exit 2.
- Missing config is differentiated from malformed config: absent →
  `missing` verdict; malformed/foreign → typed exit-1 finding message
  (the skeleton does not distinguish malformed from foreign — not
  required for PS-2).
- Deferred probes (node, git, pi, gateway component, pi-guard, trusted
  stores, ChatGPT/tunnel) are reported as a visible note ("deferred to
  PS-4"), never as verdicts — no fabricated success, no green-for-unprobed
  components.
- No check claims Gateway/pi-guard/Git/Pi/tunnel readiness.
- **Defect**: a `missing` runtime-config verdict exits **0** while the
  approved model classifies `missing` as a finding (exit 1) — SIR-PS2-003.

## 12. Host / process / security boundary — PASS

- `process.env` localization: confined to `src/host/environment.ts`
  (guard-enforced, independently grepped).
- No subprocess execution in `src/` (guard + grep).
- No network imports (guard + compiled-output grep: `dist/` imports only
  `node:*` builtins).
- No tunnel implementation; no daemon/service; no lifecycle authority
  vocabulary: no approval/issuance/activation/grant/receipt/
  `RuntimeGrant`/`TrustedReceipt`/`ExecutionResult`/
  `StorageBootstrapActionProvenance`/`initializeTrustedStore` references in
  `src/` (guard + grep). No Gateway trusted-bootstrap provenance recreated;
  no pi-guard authority logic copied.
- Filesystem mutation is confined to the single writer: `node:fs` named
  imports are allowlisted per module, and `renameSync`/`mkdirSync`/
  `unlinkSync` appear nowhere outside `src/persistence/writer.ts`
  (guard-enforced).
- Static guards are **meaningful architectural enforcement**, not
  superficial string pinning: per-module fs import allowlists, mutation
  vocabulary confinement, env/crypto localization, authority-vocabulary
  absence, package-surface checks. The package-surface guard reads
  `package.json` (single bin, private, zero runtime deps).

## 13. Package / toolchain surface

- Exactly one public executable: `pi-shuttle` → `dist/cli.js` (shebang
  preserved in compiled output; npm installs make it executable — the
  checked-in tree's `dist/cli.js` is 0644, which is normal for a
  not-yet-installed build).
- `private: true`; version `0.1.0`; `license: UNLICENSED` — truthful
  unpublished defaults. **Release-gate implication (recorded, not a PS-2
  defect):** public licensing and package-name decisions remain explicitly
  deferred; `UNLICENSED` blocks any public distribution until a human
  decision (test-and-release-plan §3 gate 5).
- Engine `>=22.0.0` is the contract-approved package floor, explicitly not
  a support claim (installation-contract §4).
- Zero runtime dependencies: `package.json` has none, and the compiled
  `dist/` imports only `node:` builtins (verified by grep).
- Dev pins exact: `typescript 7.0.2`, `@types/node 26.1.2`.
- No unexpected exports: `files: ["dist"]`, `bin` single entry.
- `dist/` is the only publication surface (package model matches
  `files`).
- Lockfile: `npm ci --dry-run` succeeds (reproducible install); the
  lockfile's root metadata records the dev pins with `^` ranges while
  `package.json` pins exactly — stale metadata only, installable either
  way (SIR-PS2-007). Lockfile is appropriate to commit as reproducible
  build metadata after regeneration.

## 14. Test / evidence quality

49 tests independently counted (7 CLI + 7 config + 6 registry + 9
persistence + 4 host + 6 doctor + 4 manifest + 6 static-guard) and run:
**49/49 pass, 0 fail, 0 skip** (`npm test`), `npm run typecheck` clean,
`git diff --check` clean (all re-run by this reviewer).

- **CLI grammar**: both pure-parser tests AND real-executable subprocess
  tests against the compiled `dist/cli.js` (help/version/unknown/deferred/
  doctor with injected HOME) — no helper-only false positives for the CLI
  path; exit classification 0/1/2 pinned at both layers.
- **Duplicate JSON handling**: duplicate keys at nested levels, escaped-key
  equivalents, false-positive freedom on valid documents.
- **Registry conflicts**: all three conflict codes + idempotence + list
  order + deregister-only semantics.
- **Atomic persistence**: 0600/0700, no-op idempotence, incompatible
  fail-closed, short-write loop, zero-progress cleanup, unwritable parent,
  directory target.
- **Doctor**: closed vocabulary set, all five renderings, lane verdicts
  incl. gated macOS, invalid-config finding, missing-config state.
- **Manifest truthfulness**: pins, gating, null digests, no-latest/no-range/
  no-0.84.
- **Static boundaries**: the six architectural guards described in §12.

Evidence gaps: no test exercises the 1 MiB ceiling (SIR-PS2-005); no test
covers symlink final targets (SIR-PS2-006); no concurrency test — the
check-then-rename race is unpinned and the tests currently pin the
sequential semantics only, and the doctor test pins the exit-0-on-missing
behavior that conflicts with the contract (SIR-PS2-003). The concurrency
findings were proven by this reviewer's read-only experiments (§9, §18).

## 15. Documentation truthfulness

- **README**: status line accurately describes the PS-2 gate (implemented,
  awaiting review, uncommitted, unpublished, no external mutations); layout
  section unchanged/accurate. No claims of working add/remove/start,
  installer, pi-guard installation, macOS support, ChatGPT configuration,
  or release.
- **Implementation report**: accurate on scope, grammar, identity, layout,
  manifest, static guards, and test counts. Three over-claims:
  1. "foreign/malformed content is never silently overwritten" (writer) —
     disproven by the concurrency experiments (SIR-PS2-001);
  2. "mirror the approved PS-1 output-writer pattern (SIR-PS1-002)" — true
     for the write-loop seam, but the publication primitive differs
     materially (rename clobber vs PS-1's atomic link no-clobber);
  3. "exit-code model ... consistent with the HUMAN-APPROVED contract" —
     the doctor `missing`-verdict-exits-0 case is inconsistent
     (SIR-PS2-003); the help text also omits the doctor half of exit 2
     (SIR-PS2-004).
- **CLI help text**: grammar listing is exact; exit-code line is
  incomplete (SIR-PS2-004). Help/version print truthful manifest facts
  ("pre-release, unpublished"; gateway/pi-guard commits; Pi baseline).

## 16. Findings

### SIR-PS2-001 — MAJOR — PRODUCT — check-then-rename race: incompatible existing state CAN be silently overwritten

- **Location**: `src/persistence/writer.ts` (`writeFileAtomic`; the
  `existingState`/`isCompatible` check phase vs the unconditional
  `renameSync` publication phase).
- **Violated invariant**: the writer's own documented and report-claimed
  fail-closed invariant — "incompatible existing state is never silently
  overwritten" — and the product's fail-closed posture
  (product-contract §7 "no weakening of fail-closed behavior").
- **Consequence**: a foreign/malformed document created at the target
  between the compatibility check and the rename is destroyed and replaced
  with pi-shuttle's content while the call reports success. Proven
  deterministically: sequential incompatible target → correctly refused;
  concurrent incompatible target → silently replaced (both demonstrated in
  §18). POSIX rename is a replace, not a no-clobber primitive.
- **Smallest safe correction**: serialize the check→publish interval among
  cooperating pi-shuttle writers — e.g. an exclusive `flock` on a sibling
  lockfile (`<path>.lock`) in the config directory taken before the
  compatibility read and held through the rename (Node's `fs` exposes
  `flockSync`/`flock`), re-running the check after acquiring the lock; or,
  for the absent-target case, PS-1's atomic hard-link publish
  (`linkSync(tmp, path)` → EEXIST = typed conflict) with the locked/checked
  update path for existing targets. ~15 lines; no API change; no new
  dependencies.
- **Envelope**: inside the HUMAN-APPROVED PS-2 envelope (pi-shuttle's own
  writer; no Gateway/pi-guard/authority change).

### SIR-PS2-002 — MODERATE — PRODUCT — concurrent writers lose updates while reporting success

- **Location**: same, `src/persistence/writer.ts`.
- **Violated invariant**: idempotent/no-op decisions must not race with
  mutation; a successful report must correspond to the published state
  (operator-cli-contract §3.8 failure semantics: no partial/misleading
  registration).
- **Consequence**: N concurrent pi-shuttle writers (e.g. two `project add`
  invocations in PS-4) each read the same base document, each rename over
  the others, each reports success; only the last writer's surface
  survives. Demonstrated with 30 real processes: 30/30 success, 1/30
  surfaces survived (3/3 runs, §18). A registration can be silently lost —
  and re-add idempotence ("verification replay + no duplicate") is not
  preserved under concurrency.
- **Smallest safe correction**: same flock serialization as SIR-PS2-001
  (single fix covers both). PS-4 must additionally re-read-verify after
  publish (contract §3.8 already requires a verification pass).
- **Envelope**: inside the PS-2 envelope.

### SIR-PS2-003 — MODERATE — PRODUCT / ARCHITECTURE — doctor exits 0 while reporting a `missing` verdict

- **Location**: `src/command/doctor.ts` (absent-config branch → `missing`
  verdict, final `exitCode 0` when no check is `unsupported`); pinned by
  `tests/unit/doctor.test.ts` ("linux x64 skeleton reports supported
  platform and missing config", asserts exit 0).
- **Violated invariant**: operator-cli-contract §2 — "1 findings
  (missing/partial/unverified)". `missing` is a finding-class vocabulary
  value; the report itself prints `runtime configuration: missing` while
  the process exits 0 ("all supported checks pass").
- **Consequence**: exit-code consumers (CI lanes use exit code + receipt
  per the contract) cannot distinguish "everything verified" from "config
  missing". The implementation report's claim of consistency with the
  human-approved exit model is inaccurate for this case.
- **Smallest safe correction**: exit 1 when any verdict is a finding-class
  value (`missing`/`installed but unverified`/`partial installation`),
  mirroring the existing `anyUnsupported` logic — or, if the fresh-install
  exit-0 behavior is the intended UX, ratify that interpretation in the
  operator-cli-contract at the human gate and adjust the vocabulary
  semantics. (The former is the smaller, contract-consistent change.)
- **Envelope**: inside the PS-2 envelope (code + test + optional contract
  note).

### SIR-PS2-004 — MINOR — DOCUMENTATION — help text exit-code model is incomplete

- **Location**: `src/command/help.ts` — "exit codes: 0 success; 1
  operational failure; 2 malformed invocation".
- **Violated invariant**: operator-cli-contract §2 (exit 2 = unsupported
  platform/architecture for `doctor`); the implementation report's claim
  that the model is "defined once in the dispatch and help text" (it is
  defined in two places, and the help text drops the doctor case).
- **Consequence**: a user seeing exit 2 from `pi-shuttle doctor` on an
  unsupported host gets help text that calls 2 "malformed invocation".
- **Smallest safe correction**: "exit codes: 0 success; 1 operational
  failure; 2 malformed invocation or unsupported platform (`doctor`)".
- **Envelope**: inside the PS-2 envelope.

### SIR-PS2-005 — MINOR — TEST / EVIDENCE — 1 MiB ceiling is implemented but untested

- **Location**: `src/config/json.ts` (`readBoundedTextFile`); no test in
  `tests/unit/config.test.ts` or elsewhere exercises
  `MAX_CONFIG_BYTES`, the `ERR-PS2-READ-TOO-LARGE` path, or the growth
  rejection loop.
- **Violated invariant**: none in the contract; the review's evidence
  bar — the implementation report lists bounded fd-read as covered.
- **Consequence**: the ceiling (a security-relevant bound on a parsed
  document) can regress silently.
- **Smallest safe correction**: two tests — exactly-MAX accepted;
  MAX+1 rejected; oversized-stat rejected; growth-mid-read rejected via
  the injected path.
- **Envelope**: inside the PS-2 envelope.

### SIR-PS2-006 — MINOR — OPTIONAL HARDENING — symlink final target is silently replaced

- **Location**: `src/persistence/writer.ts` — the compatibility read
  follows a symlink at `path`, but `rename` then replaces the *link*
  itself with a regular file (the linked-to file is untouched, the link is
  destroyed).
- **Violated invariant**: none binding in the contract; the fail-closed
  posture suggests refusing foreign shapes at the target.
- **Consequence**: a deliberately created symlink at `runtime.json`
  (e.g. a dotfiles-style link) is silently replaced; a stale foreign
  symlink is destroyed on the first write.
- **Smallest safe correction**: `lstat` the final path in the check phase
  and refuse symlinks with a typed error (or resolve and document).
  Not a release requirement.
- **Envelope**: inside the PS-2 envelope.

### SIR-PS2-007 — MINOR — TEST / EVIDENCE (tooling) — package-lock root metadata stale

- **Location**: `package-lock.json` root `packages[""].devDependencies`
  records `^26.1.2` / `^7.0.2` while `package.json` pins exactly
  `26.1.2` / `7.0.2`.
- **Violated invariant**: none functional — `npm ci --dry-run` succeeds and
  resolved versions are exact, so reproducibility is intact.
- **Consequence**: cosmetic metadata drift; a future `npm install` would
  rewrite the lock, confusing the commit diff.
- **Smallest safe correction**: regenerate the lockfile (`npm install
  --package-lock-only`) immediately before the PS-2 commit so the recorded
  declarations match the exact pins.
- **Envelope**: inside the PS-2 envelope.

### SIR-PS2-008 — MINOR — OPTIONAL HARDENING — ambiguous error after visible publication; stale tmp files

- **Location**: `src/persistence/writer.ts` — a directory-`fsync` failure
  after the successful `rename` returns `ERR-PS2-WRITE-FAILED` although
  the final file was published (the caller cannot distinguish
  "not written" from "written, durability unconfirmed"). Separately, a
  process killed between temp-open and rename leaves `<path>.tmp-<pid>`
  behind forever (no stale-tmp sweep; a recycled pid then fails `wx`).
- **Violated invariant**: none binding; error-reporting honesty after
  publication.
- **Consequence**: PS-4 callers may misreport a failure (or, with stale
  tmps, a spurious later failure).
- **Smallest safe correction**: return a distinct
  `ERR-PS2-WRITE-PUBLISHED-UNSYNCED` code after post-rename fsync failure;
  optionally unlink stale `.tmp-*` siblings of the target on entry. Not a
  release requirement.
- **Envelope**: inside the PS-2 envelope.

### SIR-PS2-009 — MINOR — ARCHITECTURE — config-shape drift is detectable only at Gateway runtime

- **Location**: `src/config/document.ts` vs the Gateway's
  `src/runtime/mcp/config.ts` loader (PS-1 baseline).
- **Violated invariant**: none — assessed as acceptable under the contract
  (see §5); this is a risk record, not a defect.
- **Consequence**: if the Gateway startup schema changes in a future
  pinned version, the divergence fails closed at the Gateway boundary but
  is discovered late (start/bootstrap time), not at pi-shuttle build/test
  time.
- **Smallest safe correction (PS-4, not PS-2)**: one black-box conformance
  test that runs the installed pinned Gateway loader against a
  serialized/deserialized PS-2 document (no private imports, no source
  coupling). Recommended as an optional check at PS-4 composition, not an
  over-engineered schema-sharing mechanism.
- **Envelope**: no PS-2 change required; the PS-4 test is inside the
  pi-shuttle envelope.

### SIR-PS2-010 — MINOR — PRODUCT — `--help`/`--version` require a valid HOME

- **Location**: `src/cli.ts` — `hostEnvironmentFromProcess()` runs before
  dispatch; `HOME` unset → exit 2 with "HOME is not set", even for
  `--help`/`--version`.
- **Violated invariant**: the report's claim that help/version "require
  zero initialized state" (they require an environment). Deterministic and
  fail-closed, but not state-free.
- **Consequence**: `pi-shuttle --help` fails in HOME-less contexts (su,
  cron-like shells) — hygiene commands should survive.
- **Smallest safe correction**: dispatch `--help`/`--version` before
  constructing the host environment (one-line reorder; they never touch
  the layout).
- **Envelope**: inside the PS-2 envelope.

## 17. Envelope exceptions

**None.** Every correction identified (§16) is a pi-shuttle-side change
inside the HUMAN-APPROVED PS-2 envelope: the persistence fix touches only
pi-shuttle's own writer, the doctor/help/exit fixes touch only pi-shuttle
code and tests, and the optional items require no Gateway, pi-guard,
authority, installer, network, macOS, or destructive-deletion semantics. No
contract escalation is required for any correction.

## 18. Focused verification performed

- Full source/test/package/tsconfig/lockfile/README read-through (all 12
  `src/` files, all 8 test files, both tsconfigs, `package.json`,
  `package-lock.json`, `.gitignore`, README diff).
- All PS-0 normative documents read as the review baseline.
- `npm test` → 49/49 pass (rebuilt `dist/`/`dist-test/`; both gitignored).
- `npm run typecheck` → clean. `git diff --check` → clean.
- `npm ci --dry-run` → succeeds (lockfile installable/reproducible).
- `npm pack --dry-run` → package surface = `dist/` + `package.json` only;
  26 files; single bin.
- Compiled-output inspection: `dist/` imports only `node:*` builtins;
  shebang preserved in `dist/cli.js`.
- Static-guard semantics audited against actual source (fs allowlists,
  env/crypto localization, mutation confinement, authority vocabulary
  absence) — meaningful enforcement confirmed.
- Read-only cross-repo verification: Gateway HEAD == manifest
  `gatewayCommit` (`7f3b4af…`); pi-guard commit `7a7580cc…` exists; Gateway
  PS-1 reviewed writer (`src/bootstrap/run.ts`) read for the atomic
  no-clobber comparison (its module comment: "The no-clobber guard is
  atomic (hard-link publish), not a check-then-rename race").
- **Targeted concurrency experiments (read-only, run from `/tmp`, no repo
  mutation; temp scripts deleted):**
  1. Deterministic check-then-rename demonstration via the writer's own
     injected write seam: sequential incompatible target → correctly
     refused (`ERR-PS2-CONFIG-INCOMPATIBLE`); target created between the
     compatibility check and the rename → **silently replaced**, success
     returned.
  2. Real-process lost-update demonstration: 30 concurrent `writeFileAtomic`
     processes with a document-compatibility predicate, 3/3 runs → 30/30
     success reported, 1 surface survived in the final file.
- No Gateway or pi-guard suites were run; no Gateway/pi-guard files were
  modified or staged.

## 19. Exact Git status

Baseline HEAD `f190b32da520e890e72a8f59f8c250f3efeb2007` unchanged; no
remote configured; nothing staged; no commits created by this review.

```
 M README.md
?? docs/reports/
?? package-lock.json
?? package.json
?? src/
?? tests/
?? tsconfig.json
?? tsconfig.tests.json
```

(`dist/`, `dist-test/`, `node_modules/` are gitignored build artifacts.)
The only file created by this review is
`docs/reports/pi-shuttle-ps-2-cli-config-senior-review.md`. The
implementation report was not modified. The report is left uncommitted and
unstaged.

## 20. Final verdict

PS-2 delivers a genuinely small, well-scoped, truthfully documented
foundation: the closed grammar and exit model (modulo SIR-PS2-003/004), the
operator-side composition document with clean authority separation, a
correct duplicate-key scanner, the exact approved identity formula,
deregister-only registry semantics, an honest manifest, a truthful doctor
skeleton, meaningful static guards, and a 49-test suite that mostly
pins what it claims. No scope absorption, no authority duplication, no
envelope exception.

However, the persistence writer's central fail-closed guarantee does not
hold under concurrency — proven, not hypothesized — and the doctor exit
classification deviates from the human-approved model. Both are inside the
PS-2 envelope and are small, well-understood corrections, but the
implementation report's own claims ("never silently overwritten",
"consistent with the HUMAN-APPROVED contract") are inaccurate until they
land.

`PS-2 SENIOR REVIEW — CORRECTIONS REQUIRED`
