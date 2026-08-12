# pi-shuttle

End-user product / distribution layer for the Project Gateway MCP + pi-guard
composed installation.

This repository is the product and release contract. It contains the
end-user installer design, the operator CLI contract, the compatibility
manifest, onboarding documentation, and the CI/release orchestration for
the composed product. It does **not** contain Project Gateway MCP source or
pi-guard source; those remain separately versioned component repositories
and are composed here as pinned dependencies.

Status: **PS-3 implementation gate** — the installer/component-composition
foundation is implemented and awaiting senior review (uncommitted,
unstaged). Pre-release; unpublished; no external mutations; no commits
yet.

## Local installer (PS-3)

Run the local installer from the repository build:

```text
npm run build
./install.sh --batch --gateway yes --pi-guard no --artifact-dir <dir>
```

- Interactive mode prompts for components, install/bin directories, and
  project configuration (which truthfully defers to `pi-shuttle project
  add <path>` — PS-4).
- Batch mode requires explicit `--gateway yes|no` / `--pi-guard yes|no`.
- Components are installed from digest-verified local artifacts under
  `<artifact-dir>/` (release artifacts and the public installer URL are
  pending publication); the receipt is written to
  `~/.local/state/pi-shuttle/install.json`.
- Supported lane: Linux x86_64 only. macOS arm64 stays gated (PS-6).

## Layout

- `docs/product-contract.md` — product composition, boundary, authority separation
- `docs/component-boundaries.md` — ownership split across the three repositories
- `docs/installation-contract.md` — one-command installer contract
- `docs/operator-cli-contract.md` — `pi-shuttle` CLI contract
- `docs/platform-support-contract.md` — Linux/macOS support matrix and evidence
- `docs/test-and-release-plan.md` — test lanes A–D and release gates
- `docs/work-packages.md` — dependency-ordered implementation plan (PS-0..PS-8)
- `docs/decisions/` — ADRs (only where durable rationale is required)
- `docs/reports/` — gate implementation/review reports
