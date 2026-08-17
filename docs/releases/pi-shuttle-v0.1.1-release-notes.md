# pi-shuttle v0.1.1 — Release Notes (PRE-PUBLICATION)

**Status: PRE-PUBLICATION.** These notes are prepared before final
release materialization. v0.1.1 is NOT yet published: no public assets,
no GitHub Release, and no Git tag exist at the time these notes were
written. Final artifact digests are intentionally absent — they become
authoritative only after the final materialization from the exact
release commit.

## 1. Version

`pi-shuttle v0.1.1` — installer correctness hotfix on top of v0.1.0.
No other product behavior changes.

## 2. What this hotfix fixes

v0.1.1 fixes the acceptance of non-absolute `HOME`, `installDir`, and
`binDir` values. In v0.1.0 a relative path (for example `y` or `~/share`
entered at an interactive directory prompt) could be accepted and
finalized into an installation state whose own receipt validation
rejects — self-invalidating state.

In v0.1.1 invalid path inputs now fail closed at the earliest
applicable boundary:

- a relative `HOME` is rejected before any installation mutation,
  prompting, artifact acquisition, staging, or Pi-side mutation;
- relative `--install-dir` / `--bin-dir` values are rejected at the
  argument boundary;
- interactive directory prompts reject relative and `~`-prefixed
  answers with guidance and re-prompt instead of advancing;
- direct/programmatic calls into the install core are refused before
  the first mutation.

Valid absolute paths and the established interactive defaults behave
exactly as in v0.1.0.

## 3. Unchanged component pins

| Component | Repository | Pin |
|---|---|---|
| Linux Gateway 0.1.0 | `mfx-labs/project-gateway` | `55f764290a4567a20557f1db19d2a6fb97572a97` |
| macOS Gateway 0.1.0 (shared) | `mfx-labs/project-gateway-macos` | `a18bd287c9ccada7fd31932dbe9937062d0b6bc1` |
| pi-guard 0.1.2 | `mfx-labs/pi-guard` | tag `v0.1.2` |

Gateway versions and pins, pi-guard 0.1.2, runtime minimums, lanes, and
compatibility policy are unchanged from v0.1.0.

## 4. Unchanged platform support

- **Linux x86_64** — product-supported.
- **macOS Intel x86_64** — product-supported.
- **macOS Apple Silicon arm64** — NOT product-supported; not known
  incompatible; no physical acceptance claimed. The unified macOS
  installation journey is unchanged.
- Code signing and Apple notarization remain OUT OF SCOPE; this release
  must not be described as signed or notarized.
- The Secure MCP Tunnel product boundary is unchanged.

## 5. Release topology

Identical eight-asset structure to v0.1.0; only the pi-shuttle
versioned names and digests change:

| Asset | Purpose |
|---|---|
| `install.sh` | one common public installer entry |
| `pi-shuttle-0.1.1-linux-x86_64.json` | Linux release envelope |
| `pi-shuttle-0.1.1-macos.json` | shared macOS release envelope (both Darwin targets) |
| `pi-shuttle-0.1.1.tgz` | common pi-shuttle package |
| `project-gateway-artifact-core-0.1.0.tgz` | Linux Gateway package (unchanged) |
| `project-gateway-macos-core-0.1.0.tgz` | shared dual-architecture macOS Gateway package (unchanged) |
| `pi-guard-0.1.2.tgz` | common pi-guard package (unchanged) |
| `SHA256SUMS` | SHA-256 of every published asset |

Final SHA-256 values are NOT recorded here: they are authoritative only
after final materialization from the exact release commit.

## 6. Immutability of v0.1.0

The v0.1.0 tag, GitHub Release, and published assets remain immutable
and are not modified or superseded by this hotfix. v0.1.1 is an
additive release.

## 7. License

The repository is now distributed under the **MIT License**
(see the root [`LICENSE`](../../LICENSE) file). This is a
licensing/metadata change only — it does not alter installer runtime
behavior, authority boundaries, component pins, or distribution
machinery. The MIT license covers the pi-shuttle repository and the
v0.1.1 source distribution; it does not relicense historical v0.1.0
artifacts, and it does not change the licenses of Project Gateway,
Project Gateway macOS, pi-guard, or any third-party dependency — those
components retain their own existing licenses.

## 8. Upgrade behavior

v0.1.1 does NOT introduce an in-place upgrade mechanism for existing
v0.1.0 installations. The installer refuses to modify installation
state recorded under a different pi-shuttle version (fail closed),
unchanged from v0.1.0. v0.1.1 targets new installations.
