# pi-shuttle v0.1.0 — Release Notes (PRE-PUBLICATION)

**Status: PRE-PUBLICATION.** These notes are prepared before final
release materialization. v0.1.0 is NOT yet published: no public assets,
no GitHub Release, and no Git tag exist at the time these notes were
written. Final artifact digests are intentionally absent — they become
authoritative only after the final materialization from the exact
release commit.

## 1. Version

`pi-shuttle v0.1.0` (no version bump in this release).

## 2. Supported targets

Product-supported in v0.1.0:

- **Linux x86_64** — `linux-x86_64-posix-utf8-node22`
- **macOS Intel x86_64** — `darwin-x86_64-posix-utf8-node22`

## 3. Unified macOS journey

macOS Intel and Apple Silicon use the SAME normal macOS installation
journey: one `install.sh` with internal host detection. There is NO
public architecture, lane, target, experimental, or acceptance selector.

## 4. Apple Silicon claim boundary

- The shared macOS Gateway package contains BOTH native candidates:
  the accepted x86_64 addon and the provenance-complete arm64 addon.
- The arm64 installation/routing path is structurally available: the
  darwin-arm64 target resolves the shared macOS distribution identity
  and is technically eligible to attempt installation.
- Apple Silicon physical/runtime acceptance has NOT been established
  (MAC-5 remains open; no physical Apple Silicon evidence exists).
- macOS arm64 is NOT product-supported in v0.1.0.
- macOS arm64 is not known incompatible; no incompatibility or
  execution prohibition is claimed.

## 5. Release content (intended public topology)

One release root serves Linux and the shared macOS path:

| Asset | Purpose |
|---|---|
| `install.sh` | one common public installer entry |
| `pi-shuttle-0.1.0-linux-x86_64.json` | Linux release envelope |
| `pi-shuttle-0.1.0-macos.json` | shared macOS release envelope (both Darwin targets) |
| `pi-shuttle-0.1.0.tgz` | common pi-shuttle package |
| `project-gateway-artifact-core-0.1.0.tgz` | Linux Gateway package |
| `project-gateway-macos-core-0.1.0.tgz` | shared dual-architecture macOS Gateway package |
| `pi-guard-0.1.2.tgz` | common pi-guard package |
| `SHA256SUMS` | SHA-256 of every published asset |

Final SHA-256 values are NOT recorded here: they are authoritative only
after final materialization from the exact release commit.

## 6. Security / distribution

- Every release artifact is SHA-256 digest-verified before any use.
- On macOS, `com.apple.quarantine` handling occurs AFTER digest
  verification and before activation.
- Code signing and Apple notarization are OUT OF SCOPE for v0.1.0.
- This release must NOT be described as signed or notarized.

## 7. Provenance / pinned components

| Component | Repository | Pin |
|---|---|---|
| Linux Gateway | `mfx-labs/project-gateway` | `55f764290a4567a20557f1db19d2a6fb97572a97` |
| macOS Gateway (shared) | `mfx-labs/project-gateway-macos` | `a18bd287c9ccada7fd31932dbe9937062d0b6bc1` |
| pi-guard v0.1.2 | `mfx-labs/pi-guard` | `7a7580cc4cbd7926797564c72269394fc29a860a` (tag `v0.1.2`) |

## 8. Publication state

PRE-PUBLICATION: v0.1.0 is not yet published; no public assets, no
GitHub Release, and no Git tag exist. Support promotion for macOS
x86_64 is a product-support claim only — it does not imply public
release availability, which requires the separate human-authorized
publication gate.

## 9. Historical evidence

The physical acceptance and materialization evidence reports
(`docs/reports/pi-shuttle-d-macos-intel-e2e-acceptance-report.md`,
`docs/reports/pi-shuttle-e2b-multi-platform-materialization-evidence.md`)
and the historical ADRs remain unchanged historical evidence and are
not rewritten by these notes.
