# ADR-004: Manifest-Native Production Trust Root Establishment

**Status:** Accepted (production signing ceremony, 2026-08-19)

**Applies to:** pi-shuttle / Project Gateway manifest-native release system.

## Context

The manifest-native trust core established a compiled production root policy
(`GATEWAY_TRUST_POLICY`) under the key ID `pgw-root-2026-01`. Investigation of
the original Linux development machine and the current macOS preparation found
**no evidence that a private key for `pgw-root-2026-01` was ever created**, and
no documented key-generation ceremony. The manifest-native generation has never
been released (the only tags, v0.1.0/v0.1.1, predate the trust core and are the
previous generation), so no installed production population is bound to that
root.

Therefore `pgw-root-2026-01` is classified as **provisional / unbacked
production trust material**. This ADR records the establishment of the first
genuine production signing hierarchy to replace it.

## Decision

Establish a new Ed25519 production signing hierarchy and bind its real public
root into pi-shuttle. The protocol, signature domain, JCS/I-JSON rules, keyring
schema, release schema, state lifecycle, Fresh-Install behavior, and package
durability are **unchanged** — this is trust-material provisioning only.

### Key hierarchy

| Role | Key ID | Public-key fingerprint (SHA-256 of the SPKI public key, first 16 hex) |
|------|--------|--------------------------------------------------------------------------|
| Root (signs production keyrings) | `pgw-root-2026-08` | `39f1c6d02a7edfe3` |
| Channel signer (signs stable-channel) | `pgw-channel-2026-08` | `fa3a8de248d1da64` |
| Release signer (signs Gateway release manifests) | `pgw-release-2026-08` | `cec4d78ede9e544a` |

The root ID `pgw-root-2026-08` reflects the actual ceremony epoch (2026-08),
distinct from the unreleased provisional `pgw-root-2026-01`, to avoid identity
ambiguity. Each pair was generated as Ed25519 and the private/public
correspondence was verified by signing a fixed non-secret challenge and
verifying it with the derived public key.

### Custody model

- Private keys live in a **dedicated operator-controlled signing directory
  outside the pi-shuttle and Project Gateway repositories**, outside `/tmp`,
  outside generated release directories, and never in Git.
- The signing directory is mode **0700**; private key files are mode **0600**.
- The root private key is used only to sign production keyrings. After the
  initial keyring is generated, the root private key is **not** required for
  ordinary Gateway release signing — the channel and release signers are
  authorized by the root-signed keyring.
- The channel and release signer private keys are used for the ordinary
  release signing flow (stable-channel and Gateway release manifest signing).

### Production keyring

The root-signed production keyring authorizes:
- `pgw-channel-2026-08` with role `channel`;
- `pgw-release-2026-08` with role `release`;

both `active`.

### Signing roles

- **Root:** signs the production keyring only.
- **Channel signer:** signs the stable-channel document (selects the exact
  `releaseId` + `releaseManifestSha256`; no semver "latest" authority).
- **Release signer:** signs Gateway release manifests (exact release identity
  and artifact/package-tree digests).

### First production Gateway release (bound by this ceremony)

- releaseId: `gateway-macos-release-002`
- releaseManifestSha256: `6c09b30097d192abdb3575c5d9b882f45816b7c21d3966facf3d4a22ccfd6630`
- artifactSha256: `57d0ea0d722c20f63cbf71b85ab7034e01ee7b5e2de7181f926f501b80fc4f79`
- packageTreeSha256: `4a66a118585d8e3e6bf80db5288809269c9516d0e9e1c7599ba09dc9c2802fa1`
- signer: `pgw-release-2026-08`

### Artifact provenance and reproducibility record

The originally prepared signed artifact bound `artifactSha256 76730e48…` (3,573,629 bytes). Investigation and clean reproduction established:

- The package TREE (`packageTreeSha256 4a66a118…`) is **exactly reproducible** from the pinned release inputs (Gateway source commit `f6f1bd71…`, `package-lock.json` `eee2ea67…`, full build step, `npm ci --omit=dev` prod-only materialization, `.bin`/`.package-lock.json` stripping, RC-01 bin normalization, 0700/0600 mode normalization).
- The artifact BYTES (`76730e48…`) are **NOT byte-reproducible** in the available environment: the gzip deflate output is zlib-implementation-specific (the closest local Node-zlib level-9 output is 3,573,636 bytes, 7 bytes over the original; a parameter matrix did not match). The original zlib/environment is not available.

Therefore the signed identity was corrected: the release manifest and stable channel were re-signed (with `pgw-release-2026-08` / `pgw-channel-2026-08`, root keyring unchanged) binding the fully reproducible deterministic artifact `57d0ea0d…` (3,573,636 bytes) with the same tree `4a66a118…` and same unpublished releaseId `gateway-macos-release-002`. Two independent clean builds are byte-identical. Production-signed local Fresh Install reaches INSTALLED → resolve VALID → exact releaseId/tree/bin binding.

#### Reproducible Gateway artifact pipeline (pinned inputs)

- source commit: `f6f1bd71c940707b159d59b87143e45132de50ba`
- package-lock SHA-256: `eee2ea6761006d6794aa32e3686b4065ffcd5ab3e047e1777dda2ec836865232` (lockfileVersion 3)
- Node: 22.23.1; npm: 10.9.8; target: darwin (x64 host)
- build: `npm ci` (full) → `npm run build` (generate + tsc)
- pack: `npm pack` → extract `package/`
- prod reinstall: `npm ci --omit=dev --ignore-scripts`
- materialize: copy clean prod `node_modules` into the package; strip `node_modules/.bin` and `.package-lock.json`
- bin normalization (RC-01): package.json `bin` value `./dist/runtime/mcp/cli.js` → `dist/runtime/mcp/cli.js`
- mode normalization: dirs 0700, files 0600 (owner-private)
- archive: deterministic ustar (mtime 0, uid/gid 0, sorted entries), gzip level 9
- result: artifact `project-gateway-macos-core-0.1.0.tgz` = `57d0ea0d…`, tree = `4a66a118…`, 3,573,636 bytes

This procedure is sufficient for a clean environment to reproduce the corrected release candidate (byte-identical across two clean builds).

### Backup / recovery policy (high level)

- A backup of the private keys is retained under the same custody discipline
  (encrypted, operator-controlled, outside repositories) for disaster
  recovery. The exact backup mechanism and location are recorded only in the
  operator custody log, never in this repository.
- If a private key is lost, rotation follows the protocol's keyring/reissue
  process (a new keyring signed by the root). No special recovery machinery is
  invented for this ceremony.

### Non-negotiable rule

**Private keys are never committed to any repository, never printed by shell
commands, never placed in `/tmp`, generated release directories, or Git, and
never included in logs or reports intended for commit.**

### Publication-layout correction (2026-08-19): v0.1.2 stop + v0.1.3 flat release-asset naming

The v0.1.2 publication attempt discovered that **GitHub Release assets cannot
represent slash-bearing names**: REST `%2F`/raw uploads sanitize `/` to `.`, and
the multipart API rejects the request (`Invalid name for request`); the download
router performs no path expansion, so a `…/download/v0.1.1/x/y/install.sh` URL
returns 404. The originally committed `GATEWAY_RELEASE_ORIGIN` used a
slash-bearing `metadataBaseUrl`
(`…/download/v0.1.2/gateway-meta` + `…/releases/<releaseId>/<sha>.json`), which
is therefore unsatisfiable.

Correction:

- **pi-shuttle advances to 0.1.3.** The v0.1.2 tag is preserved as
  **ABANDONED / UNPUBLISHED** (the draft release was deleted); no v0.1.2
  production population exists and none is expected.
- The compiled origin is now fully flat:
  `metadataBaseUrl`/`artifactBaseUrl` = `https://github.com/mfx-labs/pi-shuttle/releases/download/v0.1.3`.
- Every Gateway signed-metadata document is published as **ONE flat
  release-asset filename directly under the release tag**:
  - `gateway-meta-keyring.json`
  - `gateway-meta-stable-channel.json`
  - `gateway-meta-release-<releaseId>-<releaseManifestSha256>.json`
  (e.g. `gateway-meta-release-gateway-macos-release-002-6c09b300….json`)
- The Gateway artifact stays a single flat asset:
  `…/download/v0.1.3/project-gateway-macos-core-0.1.0.tgz`.
- The release-manifest file name is derived by the pure fail-closed
  constructor `releaseManifestAssetName` (`src/manifest-native/release-assets.ts`)
  from the **already-validated signed selection** — releaseId and digest grammars
  exclude separators/traversal, and the result is validated against the shared
  safe-file-name grammar. No caller-supplied file name or URL ever reaches the
  transport.
- **Trust boundaries are unchanged.** The keyring/channel/release-manifest
  payload schemas contain no pi-shuttle version, GitHub tag, metadata URL, or
  asset file name, so the signed metadata bytes prepared for v0.1.2 are reused
  **unchanged** (no re-signing, no root change, no schema change). This is a
  transport-representation correction only.

## Consequences

- pi-shuttle's compiled `GATEWAY_TRUST_POLICY` root is now the genuine
  `pgw-root-2026-08` public key.
- Fresh installs verify the production keyring/channel/release chain against
  the new root.
- `pgw-root-2026-01` (provisional/unbacked) is retired and replaced; no
  installed population was bound to it.
- Future Gateway releases require only the channel + release signers (root
  private key not needed after keyring establishment).

## References

- Manifest Trust Core (Slice 0) — introduced the trust protocol and the
  provisional root.
- `src/installer/release/trust.ts` — compiled `GATEWAY_TRUST_POLICY`.
- Production signing ceremony record (this ADR) — provenance, hierarchy,
  custody, and the first production keyring/channel/release-manifest bindings.
