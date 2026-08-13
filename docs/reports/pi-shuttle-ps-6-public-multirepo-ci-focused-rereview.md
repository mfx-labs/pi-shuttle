# pi-shuttle PS-6 public multi-repo CI — focused rereview

Gate: `PS-6 — PUBLIC MULTI-REPO LANE B COMPOSITION → FOCUSED REREVIEW →
BASELINE → REMOTE REAL-STACK EVIDENCE`.

Baselines frozen before mutation:

- pi-shuttle local HEAD == remote master ==
  `c3eb4fdce85122f890b0d1be6167a7019d9d46fd` (uncommitted evidence §12
  record preserved in the working tree and carried into the correction
  commit as historical evidence).
- Gateway public remote main == `98d1b204a864596bda91bec1104b8a8d5e89e1cd`
  (mfx-labs/project-gateway, now public; MIT/license + repository metadata
  are the only source-byte changes vs. the pre-public pin).
- pi-guard public == `7a7580cc4cbd7926797564c72269394fc29a860a` = tag
  `v0.1.2` (mfx-labs/pi-guard).

## 1. Governing Gateway pin semantics resolved from existing authority?

YES. Product-contract §6 is the normative source: "`gatewayCommit` pins
the exact source closure for the packaged artifact; the packaged tarball
is the pilot-proven `npm pack` artifact … produced from the clean closure
checkout." The installer consumes the pin as `expectedCommit` for the
Gateway component (src/installer/install.ts) and records it in the
receipt. Semantic A (exact source commit used to build/package/install
the Gateway component) is therefore the governing rule — no new semantic
was invented.

## 2. pi-shuttle pins the exact public Gateway source commit it packages?

YES. `GATEWAY_PS1_BASELINE_COMMIT` updated to
`98d1b204a864596bda91bec1104b8a8d5e89e1cd` (src/compat/manifest.ts), the
exact public source closure now checked out, built, and packaged by
`scripts/prepare-fixtures.sh` and verified by the installer. The old
pre-public pin `1a454b61…` is superseded; its historical role is recorded
in the manifest comment and preserved reports.

## 3. pi-guard exact commit unchanged?

YES. `PI_GUARD_COMMIT = 7a7580cc4cbd7926797564c72269394fc29a860a` (=
`v0.1.2`) untouched in the manifest, the workflow, and
prepare-fixtures.sh. pi-guard artifact digest `057f1b63…` is byte-identical
to the historical PS-5/§12.1 record (deterministic pack).

## 4. Lane B no longer depends on external fixture hosting?

YES. The `fixture_source` workflow_dispatch input, the fixture-source
validation step, the curl download step, and the fixture-gate report job
are removed. `scripts/ci-validate-fixture-source.sh` and its test are
deleted (dead transport-only code). Real-stack evidence now builds on the
runner from exact public checkouts. The historical evidence describing
the earlier blocked hosting design (evidence report §5/§11.5/§12) is
preserved.

## 5. Gateway checkout is exact SHA?

YES. `actions/checkout` with `repository: mfx-labs/project-gateway`,
`ref: 98d1b204a864596bda91bec1104b8a8d5e89e1cd` (full 40-hex SHA).

## 6. pi-guard checkout is exact SHA?

YES. `actions/checkout` with `repository: mfx-labs/pi-guard`,
`ref: 7a7580cc4cbd7926797564c72269394fc29a860a` (full 40-hex SHA).

## 7. Both checked-out HEADs are asserted?

YES. The workflow's `Assert exact component HEADs` step runs
`git rev-parse HEAD` for both checkouts and compares each against the
repository-owned pins, failing the job on any mismatch.

## 8. prepare-fixtures remains the authoritative artifact-build/provenance boundary?

YES. The workflow invokes `scripts/prepare-fixtures.sh` with the two exact
checkouts; the script enforces exact HEAD (+ pi-guard tag), clean tracked
state, `npm ci`/build/pack, and emits fixture-manifest.json + SHA-256.
New fail-closed unit tests (tests/unit/ci-prepare-fixtures.test.ts) cover
wrong-commit, non-git, dirty-checkout, and usage failures. The real-stack
script additionally asserts the manifest's recorded commits equal the
workflow pins and verifies every artifact digest against the manifest
before install.

## 9. No branch/tag/floating component checkout?

YES. Both component `ref:` values are exact full SHAs; the only remote
action is `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683`
(full SHA). No `@v4`/`@main`/floating refs anywhere; no tags are checked
out as authority (pi-guard `v0.1.2` is asserted as a tag AT the pinned
commit by prepare-fixtures.sh, never checked out).

## 10. No secrets required?

YES. Both component repositories are public; `persist-credentials: false`
on all checkouts; no GITHUB_TOKEN/secrets usage; `permissions: contents:
read` on the whole workflow.

## 11. No publication/release/deployment behavior added?

YES. No npm publish, no GitHub Release, no tags, no deploy steps; the
fixture-gate report job (the only dispatch/report machinery) is removed.

## 12. Existing arm64/Node/Git/APFS evidence preserved?

YES. The build-test job is unchanged in substance: macos-15 arm64 runner
assertion, exact Node 22.23.2 darwin-arm64 (SHA-256-pinned, arch
ASSERTED), full test suite, dedicated mandatory APFS evidence invocation,
npm-pack direct-exec evidence, digest-pinned Git 2.45.4 source build with
exact version assertion, volume case-sensitivity record, clean-tree
sanity.

## 13. PS6-MAC-001 duplicate-object guard remains exercised?

YES. The dev+ino duplicate-object guard (projects.ts step 6b, under the
project lock, before any operator dir/store creation) is unchanged and the
mandatory APFS evidence (ci-apfs-evidence-strict.mjs + apfs-path-evidence
tests: symlink alias, case variant, Unicode NFC/NFD) runs on the real
darwin arm64 runner with zero-skip enforcement.

## 14. Pi policy remains exactly 0.83.0?

YES. `PI_COMPATIBILITY_BASELINE = 0.83.0`, `SUPPORTED_PI_LANE =
pi-0.83.0-extension-api-v1` unchanged; the real-stack job provisions an
isolated `@earendil-works/pi-coding-agent@0.83.0` lane with no real user
state; receipt records `piVersion: 0.83.0`.

## 15. macOS Intel remains unsupported?

YES. Lane C is untouched; no darwin-x64 claim anywhere (manifest test
still asserts it is never a claimed lane).

## 16. Gateway/pi-guard source repos unchanged?

YES. No Gateway or pi-guard source change was made; only pi-shuttle
consumers/pins/helpers were updated. Local rehearsal built the real
artifacts from the exact public commits (Gateway digest
`e41a3530…` — legitimately new because the public MIT/repository metadata
changed package.json bytes, per the gate; pi-guard digest `057f1b63…`
identical to history).

## Local correction evidence (pre-push rehearsal)

The complete multi-repo flow was executed on this host (Linux x86_64
lane, exact Node 22.23.2 + Git 2.45.4 + isolated Pi 0.83.0): public
checkouts at the exact SHAs → prepare-fixtures (baseline verified,
manifest + digests) → real-stack script end-to-end — installer run 1
PARTIAL → PS5-LINUX-003 dependency materialization → run 2 COMPLETE with
both components `installed-verified` and `digestVerified: true` →
exact-source `pi list` confirmation → pi-guard extension load OK
(`/guard` registered) → lifecycle add/list/re-add/doctor(0)/remove/re-add
→ real MCP handshake through `pi-shuttle start`: initialize, server
identity `@project-gateway/artifact-core@0.1.0`, exactly 9/9 public
tools, protocol-clean stdout, clean EOF. Three latent defects were found
and corrected (this was the first real execution of this path): the
pi-list exact-line match needed whitespace tolerance for pi 0.83.0's
indented absolute source line; the add1 `state:` grep needed the same
tolerance for column-aligned CLI output; the MCP probe sent
`notifications/initialized` with an id, colliding with the next dynamic
request id (the new public Gateway answers id-bearing notifications with
-32601, resolving the tools/list promise with an error).

Verification: full suite 217 pass / 0 fail (3 truthful APFS darwin-only
skips), typecheck, `npm ci --dry-run`, YAML parse, `git diff --check`,
script syntax checks all green.

## Verdict

`PS-6 PUBLIC MULTI-REPO CI FOCUSED REREVIEW — ACCEPTED`
