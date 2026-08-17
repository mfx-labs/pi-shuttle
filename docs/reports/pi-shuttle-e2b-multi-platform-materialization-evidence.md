# PI-SHUTTLE E2B — Fresh Multi-Platform Release Materialization Evidence

Date: 2026-08-17

## Scope and claim boundary

This report records a single local E2A release-builder invocation from fresh,
provenance-bound inputs. It establishes that one pi-shuttle `0.1.0` version
root can serve Linux x86_64 and the shared macOS product path through the
normal generated installer topology.

It does not establish publication, GitHub Release availability, npm
publication, Apple Silicon native execution, or arm64 support promotion.

## Source baseline and input provenance

- pi-shuttle repository: `/Users/serene/Documents/pi-shuttle`
- pi-shuttle HEAD: `6fa0638767a1cc074cc1d0cce340ebe318b8a751`
- tracked and staged diffs before and after materialization: none
- Linux Gateway checkout:
  - path: `/private/tmp/pi-shuttle-e2b.WG4NTV/inputs/project-gateway`
  - origin: `https://github.com/mfx-labs/project-gateway.git`
  - HEAD: `55f764290a4567a20557f1db19d2a6fb97572a97`
  - status including untracked files: clean
- macOS Gateway checkout:
  - path: `/private/tmp/pi-shuttle-e2b.WG4NTV/inputs/project-gateway-macos`
  - origin: `https://github.com/mfx-labs/project-gateway-macos.git`
  - HEAD: `a18bd287c9ccada7fd31932dbe9937062d0b6bc1`
  - status including untracked files: clean
  - both native addons are tracked at that commit; no local addon was copied
    into the checkout or package
- pi-guard checkout:
  - path: `/private/tmp/pi-shuttle-e2b.WG4NTV/inputs/pi-guard`
  - origin: `https://github.com/mfx-labs/pi-guard.git`
  - HEAD: `7a7580cc4cbd7926797564c72269394fc29a860a`
  - exact tag: `v0.1.2`
  - status including untracked files: clean

The builder output root was empty before the invocation. The old repository
candidate at `dist-release/v0.1.0` was not used or modified.

## Single release-builder invocation

The committed E2A builder was invoked exactly once:

```text
node scripts/build-release.mjs \
  --linux-gateway-checkout /private/tmp/pi-shuttle-e2b.WG4NTV/inputs/project-gateway \
  --macos-gateway-checkout /private/tmp/pi-shuttle-e2b.WG4NTV/inputs/project-gateway-macos \
  --pi-guard-checkout /private/tmp/pi-shuttle-e2b.WG4NTV/inputs/pi-guard \
  --out /private/tmp/pi-shuttle-e2b.WG4NTV/output/v0.1.0
```

The invocation completed successfully after validating the source pins,
package identities, and packed archive boundaries.

## Final release inventory

Output root: `/private/tmp/pi-shuttle-e2b.WG4NTV/output/v0.1.0`

Exactly these eight files exist:

| File | Bytes | SHA-256 |
|---|---:|---|
| `install.sh` | 7,768 | `38dbccfbae7eeb932dbb8140c177a0305ac26f7f8262b9ded5101ee22f30d0c1` |
| `pi-shuttle-0.1.0-linux-x86_64.json` | 1,262 | `73185b1dd2b55c225051f02f634139cede8a80962cc84170503d965d0eee87a9` |
| `pi-shuttle-0.1.0-macos.json` | 1,259 | `895211fd797b1c81abab88cc26fe10cfc066f83d1949358a65e02d2885ce5a76` |
| `pi-shuttle-0.1.0.tgz` | 98,490 | `f3103eb8129b95b66fa614856094a9c281f4ac76ddce6a1770ddd20a575f77b9` |
| `project-gateway-artifact-core-0.1.0.tgz` | 3,551,096 | `ab765e043ce2892788fb0d9282e57e143ae99c12ab50328363add8459baacde9` |
| `project-gateway-macos-core-0.1.0.tgz` | 3,573,616 | `183ded3d1d4ca1870f32207519d0525af93f2cd07102dd86510c472fc77864b2` |
| `pi-guard-0.1.2.tgz` | 24,785 | `057f1b636328e8c77857a4b590d051fcc52c0c9b015ca5dd1a773c21d7d24d01` |
| `SHA256SUMS` | 653 | `3655c6d0d038b4a3eff2f3472f1c2607c104fda4b3a7a714821851875b56732d` |

`SHA256SUMS` has exactly seven entries: every non-checksum asset once, with
no foreign path. `shasum -a 256 -c SHA256SUMS` passed all seven entries.
An exact-set check also confirmed that removing an asset or adding a foreign
asset does not qualify as this release candidate.

## Envelope identities and policy

Both envelopes contain this exact supported-target policy:

```text
linux-x86_64-posix-utf8-node22
darwin-x86_64-posix-utf8-node22
```

Neither envelope lists `darwin-arm64-posix-utf8-node22` as supported.

The Linux envelope binds:

- Gateway commit: `55f764290a4567a20557f1db19d2a6fb97572a97`
- package: `@project-gateway/artifact-core@0.1.0`
- artifact: `project-gateway-artifact-core-0.1.0.tgz`
- artifact SHA-256: `ab765e043ce2892788fb0d9282e57e143ae99c12ab50328363add8459baacde9`
- bin: `project-gateway-mcp`

The shared macOS envelope binds:

- Gateway commit: `a18bd287c9ccada7fd31932dbe9937062d0b6bc1`
- package: `@project-gateway/macos-core@0.1.0`
- artifact: `project-gateway-macos-core-0.1.0.tgz`
- artifact SHA-256: `183ded3d1d4ca1870f32207519d0525af93f2cd07102dd86510c472fc77864b2`
- bin: `project-gateway-macos-mcp`

Both envelopes bind the same common bytes:

- pi-shuttle: `f3103eb8129b95b66fa614856094a9c281f4ac76ddce6a1770ddd20a575f77b9`
- pi-guard: `057f1b636328e8c77857a4b590d051fcc52c0c9b015ca5dd1a773c21d7d24d01`

Only the Gateway artifact/source identity and envelope identity differ by
platform family. The inventory contains one copy of each common artifact.

The committed envelope validator accepted:

- Linux envelope for `linux-x86_64-posix-utf8-node22`
- macOS envelope for `darwin-x86_64-posix-utf8-node22`
- the same macOS envelope for `darwin-arm64-posix-utf8-node22`

It rejected Linux-envelope-to-Darwin and macOS-envelope-to-Linux validation
with `ERR-REL-ENVELOPE-PIN`; there was no fallback.

## macOS native archive boundary

The macOS package contains:

- `package/native/index.mjs`
- `package/native/darwin-x64/gateway_fs.node`
- `package/native/darwin-arm64/gateway_fs.node`

The packed native-addon digests are:

- x86_64: `0667af87eaf541a92fa299cd21cd2202dc825c6af9da650fd96cebf4553f6382`
- arm64: `f43705523b6859dc33283b75391e0ebf7cddf0779a877ee2edf7767152a946be`

The source files were identified as Mach-O x86_64 and Mach-O arm64,
respectively. No arm64 addon was loaded or executed in this gate.

## Generated installer bindings and routing

The generated `install.sh` embeds:

- Linux envelope SHA-256: `73185b1dd2b55c225051f02f634139cede8a80962cc84170503d965d0eee87a9`
- macOS envelope SHA-256: `895211fd797b1c81abab88cc26fe10cfc066f83d1949358a65e02d2885ce5a76`
- common pi-shuttle SHA-256: `f3103eb8129b95b66fa614856094a9c281f4ac76ddce6a1770ddd20a575f77b9`

Host routing is derived from Node's real platform and architecture:

- `linux:x64` selects `pi-shuttle-0.1.0-linux-x86_64.json`
- `darwin:x64` selects `pi-shuttle-0.1.0-macos.json`
- `darwin:arm64` selects the same `pi-shuttle-0.1.0-macos.json`
- every other host key refuses before acquisition

No public target, lane, architecture, experimental, or acceptance selector
is present.

## Normal installer consumption

### Linux x86_64

The generated installer was run inside the pinned
`node:22.23.1-bookworm` Linux x86_64 container, as a non-root user, against
the task-local HTTPS acquisition source and a fresh mounted HOME.

Invocation selections were `--batch --gateway yes --pi-guard no`. The
deliberate pi-guard omission yields the installer's expected `PARTIAL` result;
it is not a Gateway or release-routing failure. Classification:
`FOCUSED COMPONENT OMISSION — NON-BLOCKING` — the omission is explicit, the
Gateway/release-topology evidence is complete, both envelopes bind the common
pi-guard artifact/digest, and no COMPLETE all-component install is claimed
from these focused runs.

Observed result:

- selected target: `linux-x86_64-posix-utf8-node22`
- selected Gateway commit: `55f764290a4567a20557f1db19d2a6fb97572a97`
- selected artifact SHA-256: `ab765e043ce2892788fb0d9282e57e143ae99c12ab50328363add8459baacde9`
- installed package: `@project-gateway/artifact-core@0.1.0`
- installed bin: `project-gateway-mcp`
- digest verification: passed
- Gateway smoke: passed
- component status: `installed-verified`

Receipt:
`/private/tmp/pi-shuttle-e2b.WG4NTV/consumption/linux/home/.local/state/pi-shuttle/install.json`

### Physical Darwin x86_64

Host facts:

- model: `MacBookPro13,3`
- macOS: `12.7.6`
- architecture: `x86_64`
- Node: `v22.23.1`
- Git: `2.37.1`

The generated installer was run against the same task-local HTTPS source and
a separate fresh canonical HOME, not prior D state. Selections were
`--batch --gateway yes --pi-guard no`; the `PARTIAL` result is solely the
deliberate pi-guard omission.

Observed result:

- selected target: `darwin-x86_64-posix-utf8-node22`
- selected Gateway commit: `a18bd287c9ccada7fd31932dbe9937062d0b6bc1`
- selected artifact SHA-256: `183ded3d1d4ca1870f32207519d0525af93f2cd07102dd86510c472fc77864b2`
- installed package: `@project-gateway/macos-core@0.1.0`
- installed bin: `project-gateway-macos-mcp`
- installed x86_64 addon SHA-256: `0667af87eaf541a92fa299cd21cd2202dc825c6af9da650fd96cebf4553f6382`
- digest verification: passed
- Gateway smoke: passed
- component status: `installed-verified`

Receipt:
`/private/tmp/pi-shuttle-e2b.WG4NTV/consumption/macos/home/.local/state/pi-shuttle/install.json`

### arm64 structural selection only

A task-local host-fact harness supplied `darwin:arm64` only to the generated
installer's selection expression. The first requested URL was exactly
`pi-shuttle-0.1.0-macos.json`. The committed validator accepted that same
envelope for `darwin-arm64-posix-utf8-node22`.

No package installation, native module loading, native execution, Rosetta,
VM substitute, or Apple Silicon acceptance claim was involved.

Selection log:
`/private/tmp/pi-shuttle-e2b.WG4NTV/evidence/arm64-curl.log`

## Fail-closed checks

- Linux envelope on Darwin x86_64: refused with `ERR-REL-ENVELOPE-PIN`.
- macOS envelope on Linux x86_64: refused with `ERR-REL-ENVELOPE-PIN`.
- unknown `linux:arm64` installer host key: exit 2 before any curl invocation;
  message states there is no release-envelope fallback.
- macOS envelope shortened by one byte: exit 2 on release envelope digest
  mismatch; nothing installed.
- macOS Gateway artifact shortened by one byte: exit 2 with
  `ERR-REL-ACQUIRE-DIGEST-MISMATCH`; no installation changes made.
- exact inventory: qualifies; an in-memory missing-asset case and extra-asset
  case both fail the exact inventory predicate.

The tamper fixtures are task-local copies. The candidate version root was not
modified by these checks.

## Repository and publication state

- tracked pi-shuttle worktree: unchanged
- staged changes: none
- support metadata: unchanged
- old `dist-release/v0.1.0`: not used or modified
- commits: none
- pushes: none
- tags: none
- releases/publication/npm publication: none

`PI-SHUTTLE E2B — MULTI-PLATFORM MATERIALIZATION PASSED / READY FOR FOCUSED REVIEW`
