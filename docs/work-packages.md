# Work Packages (dependency-ordered)

Dependency structure (refined from inspection; PS-0 is this gate):

```text
PS-0 (this gate, done)
  → PS-1 (Gateway bootstrap verb)         [Gateway repo; release-blocking]
    → PS-2 (CLI/config model)             [pi-shuttle]
      → PS-3 (installer + pi-guard)       [pi-shuttle]   ──┐ parallel
      → PS-4 (lifecycle + doctor/start)   [pi-shuttle]   ←─┘
        → PS-5 (Linux E2E)                [pi-shuttle; Lane A]
        → PS-6 (macOS + CI lanes)         [Gateway + pi-shuttle; Lanes B/C/D]  (parallel to PS-5)
        → PS-7 (ChatGPT/tunnel onboarding)[pi-shuttle; docs]
          → PS-8 (zero-state pilot + release readiness)
```

PS-3 and PS-4 both depend on PS-2's config model and can proceed in
parallel. PS-6 contains the second Gateway change (host-lane) and is
independent of PS-3/PS-4 content, but its Lane D journey needs PS-4.

---

## PS-1 — Gateway operator provisioning surface

- **Objective:** make trusted-store initialization reachable through a
  supported production/operator workflow with the smallest correct
  surface; close the fresh-install bootstrap blocker.
- **Owning repo:** Project Gateway MCP.
- **Allowed mutations:** new `src/control-plane/storage-bootstrap-action.ts`
  (the pre-declared provenance consumer); CLI `bootstrap` verb branch in
  `src/runtime/mcp/cli.ts`; optional `configurationIdentity` per surface in
  `src/runtime/mcp/config.ts` (absent = bootstrap derives; `start` requires
  present); static-guard edges in `tests/unit/storage/static-guard.test.ts`;
  new tests; docs (new ADR-041; runbook §2/§4 corrections incl.
  **PILOT-WP15-001** storage-layout wording). No package version change, no
  MCP surface change, no authority semantics change, no store engine change.
- **Prerequisites:** closure tree `0720476b...` (clean clone), PS-0 contract
  (this document).
- **Acceptance criteria:** `project-gateway-mcp bootstrap --config <f>
  [--output <o>]` initializes an absent store (state INITIALIZED, both
  namespaces, digests); re-runs replay verification-only (zero writes);
  PARTIAL/FOREIGN/UNSUPPORTED_VERSION/identity-mismatch fail closed with
  typed diagnostics; `--output` file 0600 with resolved configurationIdentity
  and digests; stdout carries no output; `start` behavior unchanged; static
  guard green; runbook layout corrected.
- **Focused tests:** bootstrap verb unit/integration (fresh/replay/partial/
  foreign/mismatch), config loader optional-identity cases, static-guard
  edges, output contract.
- **Human/external gates:** senior review confirming operator-only
  authority (no MCP/model reach); commit in the Gateway repo requires the
  Gateway project's own authorization.

## PS-2 — pi-shuttle CLI / config model

- **Objective:** the pi-shuttle skeleton: layout, manifest embedding,
  runtime-config read/write (atomic, 0600), identity derivation helpers,
  version/lane constants, `--help`/`--version`, doctor skeleton with the
  status taxonomy.
- **Owning repo:** pi-shuttle.
- **Allowed mutations:** new CLI source, manifest file, layout creation,
  tests. No Gateway/pi-guard repo access; no installer yet.
- **Prerequisites:** PS-1 output contract frozen (bootstrap verb CLI/IO
  contract).
- **Acceptance criteria:** config model round-trips the Gateway startup
  document with closed-field validation; identity derivation deterministic
  and unit-pinned; doctor reports every status vocabulary value correctly on
  synthetic states; layout creation matches platform-support-contract §2.
- **Focused tests:** config round-trip, atomic-write/mode checks, identity
  determinism, doctor verdicts.
- **Human/external gates:** none external; CLI contract review.

## PS-3 — Interactive installer + pi-guard composition

- **Objective:** the one-command installer (`install.sh`), pinning,
  interactive + batch modes, partial-install reporting, rollback, and the
  pi-guard detect/install/verify path.
- **Owning repo:** pi-shuttle.
- **Allowed mutations:** installer script, receipt model, artifact staging
  logic, pi package-store discovery (read-only), tests. pi-guard repo: none.
- **Prerequisites:** PS-2 (layout + manifest), pi-guard v0.1.2 artifact
  packaging confirmed (tarball from `plan_spec_guard` — already packable:
  `files: [src, extensions]`).
- **Acceptance criteria:** batch install/rerun/uninstall on throwaway HOME;
  SHA-pin failure aborts before activation; partial receipt flags and doctor
  reporting; rollback restores prior receipt; unsupported platform/node/Pi
  refused with honest messages; pi-guard installed via the supported
  package-store path and verified against the ADR-037 predicate.
- **Focused tests:** installer lifecycle tests (scripted), pin-verification
  negative tests, receipt/rollback tests, pi-guard detection/verification
  on Pi 0.83.0.
- **Human/external gates:** artifact hosting decision (gateway tarball is
  private/UNLICENSED — distribution authorization required); public URL
  authorization.

## PS-4 — Project lifecycle + doctor/start

- **Objective:** `project add/list/remove`, full `doctor`, `start`
  composition, bootstrap subprocess integration.
- **Owning repo:** pi-shuttle.
- **Allowed mutations:** CLI lifecycle commands, bootstrap/config
  subprocess orchestration, runtime-config writes, tests. Gateway repo:
  none (consumes the PS-1 verb).
- **Prerequisites:** PS-1 (verb), PS-2 (model), PS-3 layout (packages
  present for subprocess paths).
- **Acceptance criteria:** `project add` full operator bootstrap path
  (verify → derive → init/replay → isolation dirs → register → persist →
  verify) with idempotence and re-add-after-remove store reuse; `remove`
  deregisters and preserves the store; `start` composes the Gateway process
  with stdio inheritance and exit-code propagation; `doctor` full checklist
  with honest ChatGPT/tunnel unobservable report; zero Gateway internals
  surfaced to the user.
- **Focused tests:** lifecycle E2E against a real gateway package on a
  throwaway HOME; replay/idempotence; remove-preserves-store; start
  passthrough; doctor on partial/complete/unsupported states.
- **Human/external gates:** none external.

## PS-5 — Linux installation/E2E (Lane A)

- **Objective:** release evidence on the exact Linux lane; zero-state
  install → full journey.
- **Owning repo:** pi-shuttle (evidence), Gateway (only as pinned
  artifact).
- **Allowed mutations:** test scripts, lane reports. No source changes to
  components.
- **Prerequisites:** PS-3, PS-4; Pi 0.83.0 provisioned on the Lab host
  (the 0.84.1 host state is not evidence).
- **Acceptance criteria:** Lane A checklist green (installer → add → Pi+
  pi-guard → start → handshake → nine tools → persistence → confinement →
  read-only Git → no authority tools → restart → malformed input);
  evidence bundle recorded.
- **Focused tests:** the Lane A E2E suite as defined in
  test-and-release-plan §1.
- **Human/external gates:** none (local only).

## PS-6 — macOS portability + CI lanes

- **Objective:** first-class macOS arm64 via the Gateway host-lane change;
  Lane B/C workflow files (designed locally; executed only after external
  authorization); Lane D physical journey.
- **Owning repos:** Gateway (host-lane parameterization + ADR + lane
  evidence) and pi-shuttle (CI workflow files, macOS installer/CLI fixes).
- **Allowed mutations:** Gateway: closed accepted-lane set +
  `darwin-arm64-posix-utf8-node22`, validator operand, tests, ADR;
  pi-shuttle: `.github/workflows/*.yml` (local only), macOS-specific
  fixes. No remote Actions, no push.
- **Prerequisites:** PS-1 (same repo, must land first); Lane A evidence
  as the Linux lane reference.
- **Acceptance criteria:** Gateway darwin lane green on macOS arm64
  (storage + crash + integrity suites); Lane B green (installer batch,
  CLI, confinement, focused E2E, APFS case-sensitivity + node arch
  recorded); Lane D journey recorded; macOS Intel reported honestly
  (Lane C focused only); platform-support-contract claims match evidence.
- **Focused tests:** Gateway darwin-lane suite; pi-shuttle macOS batch
  install/E2E; doctor honesty on macOS Intel.
- **Human/external gates:** Gateway ADR review (APFS case-insensitivity
  decision, fsync evidence acceptance); GitHub Actions authorization.

## PS-7 — ChatGPT / Secure MCP Tunnel onboarding

- **Objective:** the end-user getting-started path: Local `pi-shuttle` →
  Gateway stdio MCP → Secure MCP Tunnel → ChatGPT custom MCP app /
  Developer Mode → Scan Tools → use Gateway tools. Documentation explains
  the integration; implements no tunnel protocol, invents no OpenAI
  commands.
- **Owning repo:** pi-shuttle (docs).
- **Allowed mutations:** docs only.
- **Prerequisites:** PS-4 (runnable product), PS-6 (macOS claims final).
- **Acceptance criteria:** docs verified against official OpenAI sources
  (verified at implementation time — current behavior must be re-checked,
  not assumed); nine-tool discovery guidance matches WP-14B §4; credential
  placement matches WP-14B §6; no invented syntax; `pi-shuttle start` vs
  tunnel-launch distinction documented.
- **Focused tests:** doc review checklist; example transcripts are
  explicitly marked conceptual where platform-dependent.
- **Human/external gates:** OpenAI official-source verification sign-off.

## PS-8 — Final zero-state pilot and release readiness

- **Objective:** clean-room one-command install on fresh HOMEs (Lane A
  physical, Lane D physical), final evidence bundle, release readiness
  review.
- **Owning repo:** pi-shuttle (evidence/report).
- **Allowed mutations:** release evidence docs; manifest finalized with
  real SHAs.
- **Prerequisites:** PS-5, PS-6, PS-7; P3A-WP15-006 disposition.
- **Acceptance criteria:** zero-state pilot green both platforms; doctor
  honesty audit (partial and complete installs; no false claims); manifest
  SHAs match artifacts; rollback drill executed once; release-readiness
  verdict recorded; external authorization gates listed and unexecuted.
- **Focused tests:** the zero-state pilot transcript; rollback drill.
- **Human/external gates:** final human release authorization (push/tag/
  publish/deploy) — outside this gate by definition.
