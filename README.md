# pi-shuttle

End-user product / distribution layer for the Project Gateway MCP + pi-guard
composed installation.

This repository is the product and release contract. It contains the
end-user installer design, the operator CLI contract, the compatibility
manifest, onboarding documentation, and the CI/release orchestration for
the composed product. It does **not** contain Project Gateway MCP source or
pi-guard source; those remain separately versioned component repositories
and are composed here as pinned dependencies.

Status: **PS-2 implementation gate** — the CLI/config-model foundation is implemented and awaiting senior review (uncommitted, unstaged). Pre-release; unpublished; no external mutations; no commits yet.

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
