# PS-8A — v0.1.0 Release Distribution Implementation — Report

**Date:** 2026-08-14
**Gate scope:** implement the release-distribution path for pi-shuttle
v0.1.0 (local only — no push, no tag, no GitHub Release, no upload, no
npm publish, no deployment). No Gateway or pi-guard source changes; no
MCP authority/security semantics changes.
**Final classification:** `PS-8A RELEASE DISTRIBUTION — READY FOR SENIOR
REVIEW` (no commit created in this gate; all changes left uncommitted
for independent review).

---

## 1. Starting state (frozen)

- **pi-shuttle HEAD:** `59b092ae9800f65fc1492b8bd7d4138960a0b756`
  (PS-7R policy commit; clean working tree except pre-existing
  untracked files).
- **origin/master:** `b178169a45f6c26758c9bda077c40eba4789d389`
  (unchanged during this gate; no fetch happened beyond the baseline).
- **package version:** `0.1.0`, `private: true`, `license: UNLICENSED`.
- **Gateway source pin:** `55f764290a4567a20557f1db19d2a6fb97572a97`
  (verified at build time; `@project-gateway/artifact-core` 0.1.0).
- **pi-guard source pin:** `7a7580cc4cbd7926797564c72269394fc29a860a`,
  tag `v0.1.2` (verified at build time).
- **Runtime compatibility policy:** compat/manifest.ts — Node >= 22.19.0
  (lane 22.23.2), Git >= 2.30.0 (lane 2.45.4), Pi 0.83.0 baseline
  (minimum 0.83.0), configuration v2 / format 1, gateway deps pinned
  exact (`@modelcontextprotocol/server@2.0.0`, `ajv@8.20.0`,
  `zod@4.4.3`).
- **Supported host lanes:** `linux-x86_64-posix-utf8-node22`,
  `darwin-arm64-posix-utf8-node22`, `darwin-x86_64-posix-utf8-node22`.
- Component source pins were **not moved** during this gate.

## 2. Files changed

Modified:
- `src/compat/manifest.ts` — added `PI_GUARD_TAG = 'v0.1.2'` (constant
  addition only; the tag was already pinned in prepare-fixtures.sh and
  PS-5 evidence).
- `src/installer/install.ts` — release-lane self-activation of the
  pi-shuttle package (`releasePackageTgz` option: scan → extract →
  identity → atomic no-clobber activation → bin link retarget to
  persistent packages storage, rollback-tracked); stale
  "pending publication" refusal message updated.
- `src/installer/main.ts` — `formatOutcome`/`exitCodeFor` exported
  (reused by the release entry); interactive prompt block moved to
  selection.ts (`promptInteractive`); direct-execution guard now
  symlink-safe (realpath comparison).
- `src/installer/selection.ts` — `promptInteractive` shared helper;
  usage text mentions the official release lane.
- `src/installer/components.ts` — `PI_SHUTTLE_PACKAGE_NAME` constant.
- `tests/unit/static-guard.test.ts` — narrow, documented PS-8A
  carve-outs: network vocabulary confined to the release acquisition
  boundary; `process.env` allowed at the release installer entry (its
  own direct-execution CLI boundary); fs allowlists for acquire.ts /
  bootstrap.ts / main.ts. All other architectural invariants unchanged
  (and still asserted).
- `README.md` — "Official release (v0.1.0)" section (version-specific
  URL shape, explicitly NOT live yet) vs "Development from source".

New:
- `src/installer/release/envelope.ts` — closed release-envelope schema
  + exact-pin validation (v1).
- `src/installer/release/acquire.ts` — HTTPS-only acquisition with
  minimal redirect allowlist (F-04: only github.com +
  release-assets.githubusercontent.com, observed-necessity basis),
  truncation detection, digest verification before use, 0600 writes,
  cleanup of unverified bytes, redirect/error response-body disposal
  (F-08).
- `src/installer/release/bootstrap.ts` — release installer entry:
  handoff, envelope validation, package cross-check, per-selection
  acquisition, delegation to the existing install core; refuses
  local-artifact-lane options (F-05) and refuses interactive prompting
  without a terminal (F-01, no EOF-as-default).
- `scripts/install-release.template.sh` — version-specific release
  install.sh template (generated asset): integrity/authenticity
  wording (F-03), piped-stdin terminal binding + fail-closed guidance
  (F-01), QA override https:// validation + `curl --url` (F-07).
- `scripts/build-release.mjs` — deterministic release-candidate
  builder with build-time package identity verification (F-02).
- `tests/unit/release-envelope.test.ts`, `release-acquire.test.ts`,
  `release-bootstrap.test.ts`, `release-core-install.test.ts`,
  `release-shell-input.test.ts` (shell F-01/F-07),
  `release-builder-identity.test.ts` (F-02).

## 3. Release asset model

`dist-release/v0.1.0/` (generated, not committed):

```text
install.sh                                  version-specific bootstrap (trust root)
pi-shuttle-0.1.0.json                       release envelope (closed schema v1)
pi-shuttle-0.1.0.tgz                        pi-shuttle package (dist only, npm pack)
project-gateway-artifact-core-0.1.0.tgz     Gateway artifact WITH materialized
                                            pinned runtime dependencies
pi-guard-0.1.2.tgz                          pi-guard artifact (no deps)
SHA256SUMS                                  sha256 of every asset (generated last)
```

Design decisions:

- **Runtime compatibility manifest vs release envelope stay distinct.**
  The runtime manifest is embedded in the product (frozen source); the
  envelope is a release asset carrying distribution facts. The envelope
  carries NO URLs — only file names, which the bootstrap resolves
  against the code-constant, version-pinned release base URL. No
  untrusted manifest content can name a host.
- **No self-referential digest cycle.** The envelope contains the
  pi-shuttle package digest + component digests; the envelope's own
  digest is embedded in install.sh; nothing embeds install.sh's digest
  (SHA256SUMS covers it, generated last). Changing the runtime manifest
  would change the package, hence the package digest, hence the
  envelope, hence install.sh — but never a digest stored inside the
  bytes it identifies.
- **`package.json` stays `private: true`** (prevents accidental npm
  publication); the release path never touches npm publish.

## 4. Bootstrap trust chain (documented)

1. User fetches `install.sh` over HTTPS from the VERSION-SPECIFIC URL
   (`…/releases/download/v0.1.0/install.sh`). The AUTHENTICITY of
   install.sh itself is rooted in HTTPS/TLS + GitHub + the explicitly
   version-specific release URL (no floating `latest` endpoint). The
   SHA-256 digests embedded in install.sh are the INTEGRITY root for
   the downloaded assets — they do NOT cryptographically authenticate
   the already-downloaded install.sh itself, and no signing mechanism
   exists or is claimed (F-03).
2. install.sh embeds `ENVELOPE_SHA256` and `PI_SHUTTLE_TGZ_SHA256`,
   computed from the frozen release bytes by the builder.
3. install.sh downloads the envelope + pi-shuttle package, verifies both
   digests (shell string comparison of `shasum -a 256`), extracts the
   package into an owner-controlled `mktemp` dir (0700), and runs its
   release installer entry. HTTPS enforced at every hop
   (`curl --proto '=https' --tlsv1.2 --max-redirs 5` / `wget
   --https-only`). Any mismatch aborts before anything is extracted or
   executed.
4. The release entry re-validates the envelope against the closed
   schema + exact compiled-in pins (version/commit/tag/policy equality
   — a release built from different pins cannot validate), and
   cross-checks the package digest against the envelope.
5. Component artifacts (only those selected) are downloaded to an
   owner-controlled staging dir (0700), written 0600, digest-verified
   (mismatch → bytes removed, refusal), and handed to the EXISTING
   install core with `--artifact-dir` + expected digests. The core
   re-verifies digests, structurally scans every archive, verifies
   package identity, and activates with atomic no-clobber — unchanged
   PS-3 semantics, defense in depth.
6. The core activates the pi-shuttle package itself into
   `packages/pi-shuttle@0.1.0/` and points the `pi-shuttle` bin link at
   that persistent path (the release installer runs from an ephemeral
   shell extraction; linking to the running module would dangle after
   cleanup). Receipt written last; rollback preserves prior state.

There is no generic arbitrary-download facility: acquisition is
reachable only from the release installer entry; the static guard
confines all network vocabulary to `acquire.ts`.

## 5. Generated candidate asset inventory (exact digests)

Verified 2026-08-14 — FINAL values from the CORRECTED candidate,
rebuilt from exact clean component checkouts after the senior-review
correction pass (F-01..F-08; see §10.5 and §11). The pre-correction
install.sh row observed as stale by the senior review (4550 B /
`c267cb01…`) was superseded by the corrected template rebuild. Every
digest below equals the actual generated bytes (SHA256SUMS re-verified
against every asset; the digests embedded in install.sh equal the
envelope/package rows below):

| Asset | Size | SHA-256 |
|---|---|---|
| install.sh | 6980 | `b2e6f2137fb707edb8e62973af7539ff841a866a50e2f2147854973fe71e7a6e` |
| pi-shuttle-0.1.0.json | 1302 | `de27dd310eb23618b93ee9e555aa014befa04f5fbe4725b24161f06bb7c94602` |
| pi-shuttle-0.1.0.tgz | 92043 | `fe504f2048cba8826220bb09ba15cd7888fc0619898238894373ab562877a42e` |
| project-gateway-artifact-core-0.1.0.tgz | 3551096 | `ab765e043ce2892788fb0d9282e57e143ae99c12ab50328363add8459baacde9` |
| pi-guard-0.1.2.tgz | 24785 | `057f1b636328e8c77857a4b590d051fcc52c0c9b015ca5dd1a773c21d7d24d01` |

Component source SHAs (envelope-bound and verified at build time):
- Gateway `55f764290a4567a20557f1db19d2a6fb97572a97` (clean, exact tag
  n/a — commit pin), package `@project-gateway/artifact-core@0.1.0`.
- pi-guard `7a7580cc4cbd7926797564c72269394fc29a860a` @ `v0.1.2`
  (clean).

Every asset passes the installer's own structural archive scan
(pi-shuttle 66 members, gateway 2022 members, pi-guard 12 members); the
Gateway artifact's `node bin --help` smoke exits 0 against the
materialized artifact (the receipt's `installed-verified` bar).

### Gateway dependency materialization (PS5-LINUX-003 closure)

The Gateway artifact is built from the exact clean checkout, then its
pinned runtime dependencies are materialized into the artifact at build
time (exact lockfile, `npm ci --omit=dev`): `@modelcontextprotocol/server@2.0.0`
(+ `@modelcontextprotocol/core`), `ajv@8.20.0` (+ fast-deep-equal,
fast-uri, json-schema-traverse, require-from-string), `zod@4.4.3` — no
floating versions. `.bin` symlink trees and npm's `.package-lock.json`
metadata are stripped (the installer's archive policy accepts only
regular files and directories). This makes a fresh release install
reach `installed-verified` on the FIRST run — no manual second step.
The re-tar is deterministic (ustar, sorted members, mtime 0, gzip level
9).

## 6. Negative cases (release acquisition, §8)

All covered by focused tests (see §8 below) or by the unchanged core:

- HTTP source refused before any fetch (protocol check, fetcher never
  called) — tested.
- Redirect to non-HTTPS / unexpected host refused (fixed allowlist:
  github.com, www.github.com, objects.githubusercontent.com,
  release-assets.githubusercontent.com, codeload.github.com) — tested.
- Redirect loops / > 5 hops refused — tested.
- Manifest malformed / unknown fields / duplicate keys / wrong types /
  version mismatch / source-commit mismatch / pin mismatch — tested.
- Missing artifact (404/500) — tested; truncated download
  (content-length mismatch) — tested; body stream failure mid-download
  — tested, bytes removed.
- SHA mismatch → refusal + unverified bytes removed — tested.
- Wrong package identity/version (envelope pin equality + core identity
  verification) — tested.
- Corrupted tarball → fail closed before any activation — tested.
- Interrupted acquisition → no mutation, staging cleaned — tested.
- Pre-existing healthy installation preserved: core rollback semantics
  unchanged (receipt-last, foreign-entry refusal) — covered by the
  existing installer-flow suite (273 tests green).

## 7. One-command installer behavior (§9)

The release `install.sh` provides the same interactive experience
(Gateway? default yes; pi-guard? default yes; installation directory;
bin directory; configure project now?) via the shared
`promptInteractive` path; batch mode (`--batch --gateway/--pi-guard`)
remains supported; `--artifact-dir`/`--expect-*` are refused in release
mode (artifact verification is managed internally). The end user never
needs artifact filenames, SHA values, or component repository paths.

## 8. Tests run (final, after the correction pass)

Build + typecheck green. The focused release suites (final):

- `release-envelope.test.ts` (18 tests): closed-schema validation,
  duplicate keys, unknown fields, sha/file-name grammars, version /
  commit / tag / deps / lanes / policy pin equality, type refusals.
- `release-acquire.test.ts` (12 tests): success, truncated, HTTP
  refusal (fetcher never called), two-hop redirect policy (allowed
  host accepted; disallowed and non-HTTPS refused), redirect loops,
  HTTP error statuses, mid-body failure cleanup, filename traversal
  refusal, digest-mismatch refusal + byte removal, redirect
  response-body disposal (F-08), minimal allowlist shape (F-04).
- `release-bootstrap.test.ts` (18 tests): handoff contract, --help,
  malformed envelope, version mismatch, package digest cross-check,
  non-HTTPS base URL, acquisition failure → no activation + staging
  cleanup, digest mismatch, per-selection acquisition, digest
  expectation forwarding, interactive prompts, argument forwarding,
  unknown-flag refusal, local-lane option refusal (F-05), non-TTY
  interactive refusal (F-01), batch-under-non-TTY acceptance (F-01),
  injected prompt session preserved.
- `release-shell-input.test.ts` (6 pass + 1 conditional skip): shell
  F-01 piped-stdin refusal (no controlling terminal), batch piped
  acceptance, both-selections bypass, --help under pipe, piped-with-
  terminal binding (skipped when the test host has no controlling
  terminal), F-07 adversarial QA-override refusal + valid override
  acceptance.
- `release-builder-identity.test.ts` (6 tests): F-02 build-time
  package identity verification helpers — read from packed artifact,
  exact acceptance, wrong name/version refusal, malformed/missing
  identity refusal, missing/malformed package.json refusal.
- `release-core-install.test.ts` (5 tests): release-lane core behavior
  — pi-shuttle package activation + persistent bin link (never into the
  temp extraction), idempotent rerun, corrupted package → FAILED with
  no mutation, identity mismatch refusal, SIR-PS3-006 digest
  truthfulness without expectations.

Focused verification totals: **65 pass / 0 fail / 1 conditional skip**
in the release suites, plus static-guard 10 pass and the directly
affected installer-flow + installer-preflight suites 40 pass; `git
  diff --check` clean. The full 273-test historical suite was not
rerun in the correction pass (out of scope; the implementation pass
ran it green before corrections).

## 9. Security/static review (§14)

- **Shell injection:** no `eval`; args forwarded as `"$@"`; filenames
  are embedded constants, never downloaded/user data.
- **URL injection:** URLs are code-constant prefix + validated version
  (or documented operator QA env override, still HTTPS-only); envelope
  carries file names only, validated against a closed grammar.
- **Path traversal:** file-name grammar (`[A-Za-z0-9._-]+`, no slashes)
  enforced before any path join.
- **Symlink races:** staging via mktemp/mkdtemp (0700, owner-only);
  downloads written with exclusive `wx` + 0600; component archives
  structurally scanned (symlinks/specials rejected) before extraction;
  activation is atomic no-clobber.
- **Redirect trust:** HTTPS at every hop (shell and Node), minimal
  fixed host allowlist for redirect destinations (github.com +
  release-assets.githubusercontent.com only, F-04), bounded redirect
  count; digest verification makes even a hostile redirect harmless
  (bytes must match known digests).
- **Executing unverified bytes:** digests verified before extraction
  and before exec (shell and Node layers); core re-verifies.
- **TOCTOU:** verified bytes live in owner-controlled dirs; hash → use
  happens within one attempt; the core re-hashes the same paths.
- **Credential leakage:** no credentials in the product or the release
  assets; static user-agent; nothing logs URLs.
- **Temp permissions:** 0700 dirs, 0600 files; cleanup on failure and
  on exit (shell trap now survives — see §10).
- **Accidental publication:** `private: true` retained; builder never
  publishes; static guard asserts single bin / private / zero runtime
  deps.
- **Floating versions:** none — every pin exact; version-specific URL.
- **No generic download facility:** acquire.ts reachable only from the
  release installer entry; static guard confines network vocabulary.

## 10. Findings fixed during the gate

1. **Tar writer payload padding** (builder): file payloads were not
   512-padded, so readers consumed the next header as padding →
   checksum failures. Fixed; artifacts re-verified.
2. **Dangling bin link (release lane)**: the release installer runs
   from an ephemeral extraction; linking the bin to the running module
   would dangle after cleanup. Fixed by core-side self-activation into
   `packages/pi-shuttle@0.1.0/` (scan → identity → atomic activation →
   rollback-tracked), verified by smoke + tests.
3. **Symlinked-TMPDIR entry guard**: `process.argv[1]` keeps the raw
   path while `import.meta.url` is canonical (macOS `/tmp` →
   `/private/tmp`); the direct-execution guard silently no-oped for
   symlinked invocations, making release installs exit 0 without doing
   anything. Fixed with realpath comparison in both installer entries.
4. **Temp cleanup leak**: `exec node` replaced the shell so the EXIT
   trap never fired, leaking verified release bytes in TMPDIR. Fixed by
   running node as the last command (trap fires; exit code preserved).
   Verified: no leftover release temp dirs after the smoke installs.

### 10.5 Senior-review correction pass (F-01..F-08)

Applied 2026-08-14 after the independent senior review; all mechanical,
within the approved v0.1.0 release-distribution architecture. No
component pins, lanes, compatibility policy, authority semantics, or
npm publication policy changed.

- **F-01 (piped stdin, no EOF-as-default)** — the release install.sh
  now detects a non-terminal stdin; when interactive prompts are
  needed it binds the installer stdin to the controlling terminal
  (`</dev/tty`, probed via `exec 3<>/dev/tty`) when one exists, and
  otherwise refuses with guidance ("must pass explicit selections,
  e.g. --batch --gateway yes --pi-guard no"). The Node release entry
  additionally refuses interactive prompting when stdin is not a TTY
  (`ERR-REL-INTERACTIVE-TTY`) unless a prompt session is injected
  (test seam). EOF can never become Gateway=yes/pi-guard=yes.
  Tests: `release-shell-input.test.ts` (6 pass + 1 conditional skip),
  `release-bootstrap.test.ts` (non-TTY refusal, batch acceptance,
  injected-prompt preservation).
- **F-02 (build-time identity verification)** — `build-release.mjs`
  now reads each packed artifact's `package/package.json` and fails
  closed unless pi-shuttle == `pi-shuttle@0.1.0`, gateway ==
  `@project-gateway/artifact-core@0.1.0`, pi-guard ==
  `pi-guard@0.1.2` (identity constants from the built product; the
  artifact's own package.json is the source of truth). Missing or
  malformed package.json also fails closed. Install-time identity
  verification is unchanged (defense in depth). Tests:
  `release-builder-identity.test.ts` (6 tests); exercised in the final
  builder run (all three identities verified).
- **F-03 (trust wording)** — install.sh header and report §4 now
  distinguish install.sh AUTHENTICITY (HTTPS/TLS + GitHub + the
  version-specific URL) from the embedded digests as the INTEGRITY
  root for downloaded assets; no signing mechanism is invented.
- **F-04 (minimal redirect allowlist)** — `acquire.ts` now allows only
  `github.com` and `release-assets.githubusercontent.com`. Removed:
  `www.github.com`, `objects.githubusercontent.com`,
  `codeload.github.com` (archive flow not used; observed necessity
  basis — release downloads redirect only to
  release-assets.githubusercontent.com). Redirect count stays bounded
  (5); non-HTTPS redirects stay refused. Tests updated (allowed
  accepted; removed hosts refused).
- **F-05 (local-only flags refused in release mode)** — the Node
  release entry now refuses `--artifact-dir` / `--expect-gateway-
  sha256` / `--expect-pi-guard-sha256` with `ERR-REL-ARGS` (previously
  parsed-and-silently-dropped); the shell layer already refused them.
  The developer entry (main.ts + `--artifact-dir`) is unchanged.
  Tests: 3 negative cases in `release-bootstrap.test.ts`.
- **F-06 (evidence synchronization)** — the corrected candidate was
  rebuilt from exact clean checkouts (gateway
  `55f764290a4567a20557f1db19d2a6fb97572a97`, pi-guard
  `7a7580cc4cbd7926797564c72269394fc29a860a` @ `v0.1.2`, freshly
  cloned from the authoritative repositories; the builder re-verified
  commit, tag, clean tracked state, and package identities). §5 holds
  the FINAL sizes/SHA-256; SHA256SUMS and embedded digests re-verified
  against actual bytes.
- **F-07 (QA override option safety)** — the shell now validates
  `PI_SHUTTLE_BASE_URL` as an `https://` URL before use (an
  adversarial value such as `-K <file>` or `--version` is refused with
  exit 2 before any downloader runs) and curl receives the URL via its
  `--url` data operand. The seam remains QA-only and HTTPS-only.
  Tests: adversarial values + valid-https acceptance in
  `release-shell-input.test.ts`.
- **F-08 (redirect body lifecycle)** — `downloadToFile` now destroys
  the previous response body on redirect and on error responses
  before continuing/returning; redirect-count and trust checks
  unchanged. Test: body-disposal assertion in `release-acquire.test.ts`.
- **F-11 (INFO)** — no correction manufactured; the builder was
  re-executed in this pass from fresh exact checkouts.

## 11. Reproducibility

Two independent builder runs produced **byte-identical SHA256SUMS**
(and byte-identical Gateway/pi-guard artifacts across all runs). The
CORRECTED rebuild (post F-01..F-08) reproduced the Gateway and
pi-guard artifacts **byte-identically** (`ab765e…` / `057f1b…`
unchanged); the pi-shuttle tgz changed only because the corrected
source (bootstrap/acquire) ships in it, and install.sh changed with
the corrected template — both re-verified against the fresh bytes.
Deterministic by construction: exact lockfiles, sorted ustar members,
mtime 0, gzip level 9, envelope JSON generated from frozen constants.
Recorded limitation: the materialized Gateway node_modules depends on
npm/lockfile/registry state — deterministic in practice (lockfile
integrity hashes pin bytes), not a formal byte-for-byte guarantee
across npm major versions. The pi-shuttle tgz preserves source-tree
mtimes (npm pack behavior) — deterministic per tree state.

## 12. Live end-to-end smoke (local QA, not committed)

The full release path was executed twice: at implementation time and
again after the correction pass against the CORRECTED candidate
served from a local HTTPS server (self-signed CA; TLS validation ON
via `CURL_CA_BUNDLE`/`NODE_EXTRA_CA_CERTS`; the QA base-URL override
`PI_SHUTTLE_BASE_URL=https://127.0.0.1:8443` — a documented test
seam, https-enforced): `install.sh --batch --gateway yes --pi-guard
no` into a throwaway HOME:

- envelope + package digests verified by the shell; bootstrap validated
  the envelope and cross-checked the package; gateway artifact
  acquired, digest-verified, installed by the unchanged core.
- Result: `PARTIAL INSTALLATION — not installed: pi-guard` (exit 1,
  truthful — pi-guard was not selected), gateway
  `installed-verified`, `digestVerified: true`, artifact SHA recorded =
  envelope SHA (`ab765e…`); receipt 0600; bin link →
  `packages/pi-shuttle@0.1.0/dist/cli.js` (persistent); installed
  `pi-shuttle --version` works; rerun idempotent (same link, same
  result); `--help` and `--artifact-dir` refusal work; temp dirs
  cleaned (no `pi-shuttle-release.*` leftovers).
- F-01 non-TTY behavior verified in the focused shell tests (piped
  stdin + no selections + no controlling terminal → refusal with
  guidance; piped + explicit selections → proceeds). Interactive
  terminal behavior is unchanged local-lane semantics (shared
  promptInteractive; existing installer-flow tests).
- The full pi-guard path could not be exercised on this host (real
  `pi` 0.84.1 candidate fails the pi-guard compatibility probe without
  the extension installed) — this is the known honest host state, not a
  release defect; the pi-guard install path is unchanged core code
  covered by the existing suite with the fake-pi harness.

This remains LOCAL QA HTTPS smoke — not an official public GitHub
Release installation (no release exists yet).

## 13. Licensing disposition (§10)

Audited (no guessing):
- pi-shuttle: `package.json` `private: true`, `license: UNLICENSED`;
  **no root LICENSE file**; no human-approved license decision exists
  in repository evidence.
- Gateway: `MIT` (package.json); pi-guard: `MIT` (package.json).
- Materialized Gateway dependencies: ajv MIT, fast-deep-equal MIT,
  fast-uri BSD-3-Clause, json-schema-traverse MIT, require-from-string
  MIT, zod MIT, @modelcontextprotocol/server/core (MIT; LICENSE files
  ship inside the bundled packages).
- `private: true` retained to prevent npm publication (independent of
  the source/distribution license question).

Recorded: **`V0.1.0 LICENSE DECISION REQUIRED`** — a human-approved
pi-shuttle source/distribution license (and any aggregated
third-party-notices requirement) must be decided before public
distribution. This did not block any release-distribution engineering
in this gate.

## 14. Remaining external actions

- Publication gate: host the v0.1.0 assets, create the GitHub Release +
  tag, and make the version-specific URL live (explicitly NOT done in
  this gate; separate human authorization).
- `V0.1.0 LICENSE DECISION REQUIRED` (see §13).
- Live ChatGPT custom-app E2E on an eligible workspace (PS-7R:
  `EXTERNAL QUALIFIED ACCEPTANCE EVIDENCE`, not a v0.1.0 blocker).
- Lane D physical journey and final zero-state pilot remain PS-8
  evidence items.
- No push, tag, GitHub Release, upload, or npm publish was performed.

## 15. Secrets

None recorded. No tokens, credentials, or personal identifiers appear
in this report, the release assets, or the diff. The release assets
contain no secrets by construction (envelope is public metadata;
digests are public).

---

`PS-8A RELEASE DISTRIBUTION — READY FOR SENIOR REVIEW`
