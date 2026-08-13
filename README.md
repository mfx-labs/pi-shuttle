# pi-shuttle

End-user product / distribution layer for the Project Gateway MCP + pi-guard
composed installation.

This repository is the product and release contract. It contains the
end-user installer design, the operator CLI contract, the compatibility
manifest, onboarding documentation, and the CI/release orchestration for
the composed product. It does **not** contain Project Gateway MCP source or
pi-guard source; those remain separately versioned component repositories
and are composed here as pinned dependencies.

Status: **PS-4 implementation gate** — the project lifecycle (`project
add/list/remove`), the full `doctor` probe suite, and `start` runtime
composition are implemented and awaiting senior review (uncommitted,
unstaged). Pre-release; unpublished; no external mutations; no commits
yet.

## Local installer (PS-3)

Run the local installer from the repository build:

```text
npm run build
./install.sh --batch --gateway yes --pi-guard no --artifact-dir <dir>
```

- Interactive mode prompts for components, install/bin directories, and
  project configuration (which routes to `pi-shuttle project add <path>`).
- Batch mode requires explicit `--gateway yes|no` / `--pi-guard yes|no`.
- Components are installed from digest-verified local artifacts under
  `<artifact-dir>/` (release artifacts and the public installer URL are
  pending publication); the receipt is written to
  `~/.local/state/pi-shuttle/install.json`.
- Supported lane: Linux x86_64 only. macOS arm64 stays gated (PS-6).

## Operator CLI (PS-4)

```text
pi-shuttle doctor
pi-shuttle project add <path>
pi-shuttle project list
pi-shuttle project remove <path-or-workspace-id>
pi-shuttle start
```

- `project add <path>` canonicalizes the project root (symlink-resolved),
  verifies it is a Git repository (read-only probe), derives the
  deterministic identity (`workspaceId pgw:w:<32-hex>`, store locator
  `~/.local/share/pi-shuttle/stores/<32-hex>`), prepares the operator-owned
  directories (store parent 0700, `git-home`/`git-tmp` isolation dirs, the
  version-2 `artifacts/` dir), composes the smallest bootstrap
  configuration, and invokes the installed Gateway operator bootstrap verb
  (`project-gateway-mcp bootstrap --config <input> --output <resolved>`).
  The Gateway derives the trusted configuration identity (pi-shuttle never
  computes it); the resolved runtime configuration is validated and
  correlated (surface/locator/workspace/root/git lane) before the project
  is registered transactionally in
  `~/.config/pi-shuttle/runtime.json` (atomic, 0600, concurrency-safe).
  Re-adding the same project is an exact idempotent replay; re-adding after
  a `remove` reuses the same preserved store (verification replay).
- `project list` prints one deterministic line per registered project
  (workspaceId, canonical root, surface id, store locator) from the
  authoritative runtime document; an empty registry is a successful state.
- `project remove` is **deregister only**: the registration is removed
  transactionally; the trusted store, project directory, Git history, and
  artifact data are never deleted. Re-add after remove reuses the store.
- `doctor` runs the full local probe suite (platform, node, git, pi,
  installation receipt, gateway component, pi-guard, runtime configuration,
  registered projects, git isolation dirs, coordination locks) with the
  closed status vocabulary and exit codes 0/1/2. It never mutates state:
  stale locks are detected with recovery guidance (never auto-deleted),
  trusted-store integrity is reported as available only through the
  Gateway bootstrap replay, and ChatGPT/tunnel readiness is reported as
  not locally observable (PS-7).
- `start` validates the receipt and runtime configuration, resolves the
  exact installed Gateway executable, and composes
  `node <gateway-bin> --config <runtime.json>` with inherited stdio —
  stdout stays MCP protocol (no pi-shuttle text), diagnostics go to
  stderr before the child starts, and the Gateway exit status/signals
  propagate truthfully. `start` never bootstraps, never repairs, never
  mutates.

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
