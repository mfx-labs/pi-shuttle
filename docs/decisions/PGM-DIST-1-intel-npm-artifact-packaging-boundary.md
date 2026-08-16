# PGM-DIST-1 — Intel npm Artifact Packaging Boundary (fork-side prerequisite)

**Record type:** Distribution-only prerequisite, owned by
`mfx-labs/project-gateway-macos` gates.
**Status:** PREREQUISITE RECORDED — implementation NOT started; NOT
promoted, validated, or claimed as Apple Silicon work.
**Declared by:** pi-shuttle ADR-002 (per-lane Gateway distribution).
**Independence:** distribution-only; independent of MAC-5 / MAC-6 /
MAC-7. Does not open, unblock, reorder, or weaken any macOS fork gate.

## Boundary

The current fork packaging metadata (`package.json` `files: ["dist"]`)
excludes the native seam, so the as-is `npm pack` tarball
(`project-gateway-macos-core-0.1.0.tgz`) cannot run the accepted
controlled-write boundary (`#gateway-native` import fails). For the
accepted Intel runtime to be consumable as an npm artifact, the packaging
boundary must include EXACTLY the already accepted Intel runtime surface
required by npm:

```
dist/
package.json
native/index.mjs
native/darwin-x64/gateway_fs.node
```

- `dist/` — compiled runtime (MCP CLI `dist/runtime/mcp/cli.js`,
  darwin-fs modules, embedded schema bundle); no external `schemas/`
  needed at runtime.
- `package.json` — identity `@project-gateway/macos-core@0.1.0`, bin
  `project-gateway-macos-mcp`, `imports` map (`#gateway-native`).
- `native/index.mjs` — fail-closed loader (no fallback).
- `native/darwin-x64/gateway_fs.node` — the MAC-4-accepted six-export
  x64 addon, exactly as baselined at `def4cef9a33ac5ced655d18c7a56ba2d8031a311`.

## Prohibitions (binding)

- MUST NOT promote, validate, or claim darwin-arm64 runtime support:
  `native/darwin-arm64/gateway_fs.node` is a cross-build candidate
  (MAC-5 `BLOCKED ON REAL APPLE SILICON HARDWARE`); its presence in a
  package is a MAC-7 decision and is NEVER acceptance evidence.
- MUST NOT change Gateway runtime behavior, Linux behavior, or
  darwin-arm64 artifact selection.
- MUST NOT weaken the fail-closed loader semantics (missing/wrong-arch
  addon fails closed, never a fallback).
- Implementation is a future fork-side gate: no packaging mutation is
  performed by this record.
