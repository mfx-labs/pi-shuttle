# Platform Support Contract

## 0. v0.1.0 support disposition (human-approved, Linux-only)

pi-shuttle v0.1.0 supports **Linux x86_64 only**. macOS support is
DEFERRED beyond v0.1.0 until Project Gateway has a reviewed,
contract-preserving Darwin descriptor-relative controlled-write primitive
(PS8B-DEFECT-001; Gateway darwin-controlled-write escalation report). The
installer refuses macOS in v0.1.0 BEFORE any component activation;
doctor reports macOS as unsupported (exit 2). Historical macOS
engineering evidence (PS-6/PS-6I, ADR-042/043) remains valid historical
evidence but is NOT v0.1.0 supported-product evidence.

## 1. v0.1.0 support matrix (claims are evidence-bound)

| Platform | Arch | Status | Evidence required |
|---|---|---|---|
| Linux | x86_64 | **supported** (first-class) | Lane A physical/local E2E on the exact lane |
| macOS | arm64 (Apple Silicon) | **deferred** (NOT supported in v0.1.0; installer refuses) | Gateway Darwin controlled-write correction + real arm64 lane evidence (future) |
| macOS | Intel (x86_64) | **deferred** (NOT supported in v0.1.0; installer refuses) | Gateway Darwin controlled-write correction + real Intel lane evidence (future) |
| anything else (incl. Windows) | — | **unsupported** (installer refuses; doctor exit 2) | none |

Supported lane constants (inherited, never reinterpreted):

- Gateway host lane: `linux-x86_64-posix-utf8-node22` (Linux — the ONLY
  v0.1.0 claimed lane). The darwin lane constants
  `darwin-arm64-posix-utf8-node22` (PS-6) and
  `darwin-x86_64-posix-utf8-node22` (PS-6I) are RETAINED in the manifest
  as gated lanes (historical/component-level meaning) and are NOT v0.1.0
  claims; the `node22` suffix is a frozen opaque protocol label, never an
  exact Node runtime equality requirement;
- Node: runtime minimum `>=22.19.0`; `22.23.2` is the validated
  deterministic CI baseline (reported, never an equality gate; the
  package floor `>=22.0.0` is not a support claim);
- Git: runtime minimum `>=2.30.0`; `2.45.4` is the validated
  deterministic CI baseline (operator-provided, never `/usr/bin/git`;
  Gateway executable safety/fingerprint checks remain fail-closed,
  unchanged);
- Pi: `pi-0.83.0-extension-api-v1` (`SUPPORTED_PI_LANE`); `0.83.0` is the
  known-good baseline; candidates `>=0.83.0` (e.g. the current Linux
  host's Pi 0.84.1) are accepted only on committed pi-guard
  compatibility-probe PASS — never claimed, never substitute release
  evidence (Gateway runbook §1/§8; P3A-WP15-006 remains open);
- pi-guard: `0.1.2` (commit `7a7580cc...`, tag `v0.1.2`);
- locale: UTF-8.

## 2. Directory layout assessment (Linux AND macOS)

Preferred product directories, kept **identical on both platforms**:

- `~/.local/share/pi-shuttle` — durable data (stores, packages, git
  isolation dirs);
- `~/.local/state/pi-shuttle` — disposable state (receipt, staging, logs);
- `~/.config/pi-shuttle` — operator configuration (runtime.json);
- `~/.local/bin/pi-shuttle` — CLI entry.

Assessment: `~/.local/*` is a de-facto standard on Linux (XDG) and a
well-understood, harmless convention on macOS (where XDG is not native).
The macOS-native alternatives (`~/Library/Application Support`, `~/Library/
Caches`, `~/Library/Preferences`) add platform divergence and hidden
symlink/case behavior for zero product value. **Decision: keep the same
layout on both platforms; do not substitute Library directories.** This is
a documented product choice, not an XDG-compliance claim on macOS.

Portability rules (binding):

- All paths derive from `$HOME` at runtime; no hardcoded home paths.
- No hardcoded `/usr/bin/git` (the Gateway's compile-time default is
  operator-overridable; pi-shuttle always writes an explicit discovered
  `gitPath`). On macOS `/usr/bin/git` may be absent or an Apple CLT shim.
- No hardcoded `/usr/bin/node`; node discovered via PATH, pinned by
  version probe.
- Pi discovered via PATH/package store, pinned by version probe.
- POSIX-oriented only: no Windows paths, no case-insensitive assumptions,
  no `spawn` shell tricks.

## 3. macOS-specific risks and required evidence (HISTORICAL — deferred beyond v0.1.0)

1. **Gateway host lane is Linux-only today.** `TRUSTED_HOST_LANE` is a
   compile-time constant hard-coded in the WP-6 validator and containment
   checks; the lane participates in configuration identity. First-class
   macOS support therefore requires the PS-6 Gateway change (closed
   accepted-lane set + `darwin-arm64-posix-utf8-node22`) plus a Gateway
   ADR. **No amount of pi-shuttle-side work can claim macOS without it.**
2. **APFS case-insensitivity.** Default macOS APFS is case-insensitive;
   the Gateway lane contract says case-insensitive filesystems are
   unverified/unsupported. The store layout is fixed lowercase, so
   collision risk is low, but the contract text must be addressed, not
   waved through. Evidence required: (a) record the volume's case
   sensitivity in Lane B/C/D; (b) either validate on a case-sensitive volume
   or obtain a reviewed Gateway ADR assessing the fixed-lowercase layout;
   (c) the compatibility probe (`runCompatibilityProbe`) must run green on
   the darwin lanes. **Decided in ADR-042/043: default case-insensitive
   APFS is supported; identity derives from the filesystem-canonical
   spelling, so case/Unicode aliases of one object never create duplicate
   authority (PS6-MAC-001).** This is architecture-independent: Intel
   APFS uses the same dev+ino object identity (PS-6I verified on
   MacBookPro13,3).
3. **`/tmp` canonicalization.** macOS `/tmp` is a symlink to `/private/tmp`
   and Node's `os.tmpdir()` returns per-user `/var/folders/...` paths. The
   store never lives under `/tmp` (locator under `~/.local/share/
   pi-shuttle/stores/`), and the Gateway probe uses store-owned `tmp/`
   dirs, so exposure is limited — but `doctor` must verify the store
   parent is canonical and not under a symlinked tmp, and Lane D must
   record the canonical paths.
4. **UID behavior.** `process.getuid()`/`setuid` semantics exist on macOS
   but differ from Linux (no `getuid` granularity changes; effective-uid
   behavior; no `chown` by unprivileged users — the Gateway never chowns,
   it requires ownership match). Evidence: Lane B/D must run the storage
   suite (owner/mode checks, `test:storage-crash`) and record UID
   behavior; no sudo-based install path.
5. **Symlink and canonical-path behavior.** APFS supports symlinks;
   Gateway resolvers handle them with typed failures. The trusted-store
   root validation uses no-follow descriptor verification — Lane B must
   run the store security/integrity tests to confirm no-follow and
   identity capture behave on APFS.
6. **Atomic rename / fsync semantics.** `rename(2)` is atomic on APFS
   (same volume) — the atomic-write design holds. APFS fsync durability
   guarantees are weaker than ext4 in some configurations; the crash
   suite (`test:storage-crash`, Gateway Lane 3) must run on macOS arm64 as
   release evidence, and any divergence must be recorded, not assumed.
7. **Gatekeeper/quarantine.** Downloaded artifacts may carry
   `com.apple.quarantine`; the installer must strip quarantine attributes
   after SHA verification and before activation. Notarization/signed
   packages are out of scope for v0.1.0 (no GUI, bash + node CLI); the
   docs must say so (no false security claims).
8. **Git on macOS.** Git is not preinstalled; a Git satisfying the minimum
   runtime version (>= 2.30.0) must be provided by the operator (homebrew
   etc.) and discovered by version probe. The validated CI baseline is
   exactly 2.45.4 (Lane B/C digest-pinned provision). `/usr/bin/git` (Apple
   shim) is never assumed. Lane D must record the git origin (brew vs.
   custom build) and version. The physical Intel smoke (PS-6I) records
   Apple Git 2.37.1 as an accepted >= 2.30.0 operator-provided runtime,
   subject to the Gateway Git binary safety/fingerprint checks.
9. **Node on macOS.** On the darwin-arm64 lane a native arm64 Node
   satisfying the minimum runtime version (>= 22.19.0) is required; the
   version probe must confirm the version AND that the binary is arm64 (a
   Rosetta/Intel node under arm64 macOS would be unverified for the
   darwin-arm64 lane — arch mismatch fails closed in doctor). The
   darwin-Intel lane requires no such probe: x64 is the lane's own native
   architecture, and the running interpreter is the runtime Node (PS-6I).
   The validated CI baseline is exactly 22.23.2 (Lane B/C).

## 4. What "supported" means

- The exact lane is declared in the manifest;
- the exact evidence lane(s) in test-and-release-plan ran green;
- `doctor` reports `supported` for it;
- anything else is `installed but unverified`, `missing`, or
  `unsupported` — never "supported".
- Claims are per-v0.1.0: the manifest IS the claim; silence is not
  support.

## 5. Unsupported-but-visible behavior

On unsupported platforms the installer refuses; a manually-run CLI prints
`unsupported platform` with exit 2 and never proceeds to compose a Gateway
process (fail closed, consistent with the Gateway's own lane contract).
