# Operator CLI Contract

## 1. Command surface (v0.1.0, complete)

```text
pi-shuttle doctor
pi-shuttle project add <path>
pi-shuttle project list
pi-shuttle project remove <path-or-workspace-id>
pi-shuttle start
pi-shuttle --help
pi-shuttle --version
```

Nothing else. No admin commands, no config-editing commands, no update
commands. `--help`/`--version` are hygiene, not features.

The CLI is a thin operator shell: it composes the Gateway CLI as a pinned
subprocess, persists the operator runtime configuration, and verifies
states. It contains **no storage logic, no provenance, no authority
semantics** — all of that stays in the Gateway package behind the
`bootstrap` verb and the `--config` runtime contract.

## 2. `pi-shuttle doctor`

Exit codes: `0` all supported checks pass; `1` findings (missing/partial/
unverified); `2` unsupported platform/architecture (fail closed).

Status vocabulary (used exactly, never embellished):

- **supported** — matches the manifest lane and verifies;
- **unsupported** — not a claimed lane (e.g. macOS Intel without evidence,
  Windows, Pi 0.84.x, Node ≠ 22.23.2, case-insensitive filesystem where the
  lane contract requires evidence);
- **installed but unverified** — present, version cannot be confirmed
  against the manifest or compatibility predicate (e.g. unknown pi-guard
  version);
- **missing** — not installed;
- **partial installation** — a required component was opted out (receipt
  flag).

Checks (minimum, in order):

| # | Check | Verdict sources |
|---|---|---|
| 1 | platform | OS/arch vs manifest matrix (linux-x64, darwin-arm64) |
| 2 | architecture | same |
| 3 | Node | version probe == 22.23.2 |
| 4 | Git executable + version | PATH discovery (never `/usr/bin/git`), version == 2.45.4 |
| 5 | Pi installation/version | `pi` discovery + version; 0.83.0 supported, 0.84.x = unsupported (never claimed) |
| 6 | Project Gateway component | installed package path, manifest version match, `bin/project-gateway-mcp` executable |
| 7 | pi-guard component/version | Pi package store discovery (read-only), extension entry, version == 0.1.2, ADR-037 predicate spot-checks |
| 8 | trusted store integrity/readiness | per registered project: `bootstrap` replay-style verification (or the Gateway's verification path) — INITIALIZED=ready; ABSENT=missing; PARTIAL/UNSUPPORTED_VERSION/FOREIGN=broken (fail closed, no repair) |
| 9 | runtime configuration | `~/.config/pi-shuttle/runtime.json` parseable, closed fields, matches installed manifest, 0600 |
| 10 | registered projects | runtime config surfaces/workspaces present and each root canonical |
| 11 | Git isolation directories | `gitHome`/`gitTmpdir` exist, empty, operator-owned, outside every workspace root, 0700 |
| 12 | relevant filesystem permissions | store 0700/0600, config 0600, receipt 0600, no group/world bits |
| 13 | ChatGPT/tunnel readiness where observable locally | Gateway MCP handshake probe (spawn with a probe surface, `initialize`, `tools/list` = exactly nine, terminate); tunnel/ChatGPT side explicitly reported as **not observable locally** (external platform state; never fabricated) |

Doctor output is human-readable; `--json` is NOT in v0.1.0 (keep minimal;
CI lanes use the exit code + receipt). Doctor never mutates anything except
its own bounded probe artifacts (removed on exit).

## 3. `pi-shuttle project add <path>`

The operator bootstrap path (product-contract §5). Steps:

1. **Verify root**: `path` exists, is a directory, canonicalized with
   symlink resolution; must be a Git repository (read-only `git` probe via
   the discovered pinned binary). Fail closed with typed messages.
2. **Preflight**: doctor subset (node, git, gateway component, platform).
3. **Derive identities** (deterministic from the canonical root; replay-safe):
   - `workspaceId = "pgw:w:" + sha256(canonicalRoot).hex.slice(0,32)`;
   - `storeId = sha256(canonicalRoot).hex.slice(0,32)`;
   - `locator = ~/.local/share/pi-shuttle/stores/<storeId>`;
   - `configurationVersion = "2"` (manifest-pinned);
   - `configurationIdentity` = derived by the Gateway `bootstrap` verb
     (WP-6 canonical identity of the validated configuration) — pi-shuttle
     never computes or invents it.
4. **Create operator-owned state**: `gitHome`/`gitTmpdir` empty dirs
   (0700) outside the workspace root; `artifactLocation`
   `<canonicalRoot>/artifacts` created if absent (version-2 requirement:
   existing directory, strict descendant of root).
5. **Initialize or verification-replay the trusted store**: write a
   bootstrap config document (0600, temp), run
   `project-gateway-mcp bootstrap --config <file> --output <resolved>`
   (pinned node + installed CLI), require exit 0 and state `INITIALIZED`.
6. **Verify**: run `bootstrap` a second time — the committed replay path
   (verification-only when already initialized); require `INITIALIZED`
   again; verify the resolved config (identity, digests, canonical
   workspaces).
7. **Register + persist**: merge the resolved surface into the runtime
   config (`~/.config/pi-shuttle/runtime.json`), atomic write
   (temp + fsync + rename), 0600. `gitPath` = discovered pinned git
   absolute path (explicit; never the gateway's `/usr/bin/git` default).
8. **Report**: human summary (workspaceId, canonical root, store locator,
   surface id) — no internal jargon.

Idempotence: re-adding the same canonical path = verification replay +
same derived identities + no duplicate registration (fail closed on
conflicting registration of the same root under a different identity).
Re-adding after a `remove` **reuses the same store** (same storeId) — the
replay path re-verifies it and historical evidence survives.

Failure semantics: any step failure aborts before the runtime config is
rewritten; the store may have been provisioned (that is safe: it is
replay-verified on retry); no partial registration is ever persisted.

**Authority separation (binding):** `project add` is a human-run CLI
action. It is not an MCP tool, not model-callable, not ChatGPT-accessible,
and not a generic lifecycle write authority. It reuses
`initializeTrustedStore()` via the Gateway `bootstrap` verb; it does not
duplicate storage initialization.

## 4. `pi-shuttle project list`

Reads the runtime config; prints one line per registered project:
workspaceId, canonical root, surface id, store locator, registered-at
(if recorded). Read-only. Empty runtime config → prints "no registered
projects" and exits 0.

## 5. `pi-shuttle project remove <path-or-workspace-id>`

- Accepts either the canonical root path or the workspaceId.
- **Deregisters only**: rewrites the runtime config without the matching
  surface (atomic, 0600).
- **Never deletes the trusted store** (immutable historical evidence; no
  deletion/retention tool in the product — runbook §6 revocation≠deletion
  applies; the store remains at its locator and the command prints where).
- Git isolation dirs and `artifacts/` are left in place (operator-owned
  state; documented; no GC in v0.1.0).
- Removing the last project leaves a valid empty runtime config; `start`
  then fails closed with "no registered projects — run `pi-shuttle project
  add <path>`".
- Unknown path/id → typed error, exit 1, nothing changed.

## 6. `pi-shuttle start`

```text
pi-shuttle start
```

- Reads the runtime config; verifies it (parse, closed fields, stores
  present/replay-verifiable, manifest match). Failure → bounded diagnostic
  + "run `pi-shuttle doctor`" hint, exit nonzero, no Gateway process
  spawned.
- Launches the installed Gateway MCP with the configured runtime state by
  exec'ing the pinned node + installed
  `dist/runtime/mcp/cli.js --config <runtime-config>` (or the installed
  `bin/project-gateway-mcp`), **stdio inherited** — stdout stays MCP
  protocol, diagnostics to stderr; the user sees exactly the Gateway
  process behavior, without ever typing the long executable/config path.
- Propagates the Gateway exit code; forwards signals; no daemonization, no
  log capture, no wrapper state. The Gateway remains stdio MCP internally.
- For the ChatGPT/tunnel path the user does NOT use `pi-shuttle start`:
  the external Secure MCP Tunnel launches the Gateway CLI directly
  (WP-14B §3); pi-shuttle's onboarding docs explain both paths.

## 7. Configuration/state ownership

| Path | Owner | Content |
|---|---|---|
| `~/.config/pi-shuttle/runtime.json` | CLI (operator) | Gateway startup document (surfaces[]); 0600; secret-free (ADR-040) |
| `~/.local/share/pi-shuttle/stores/` | CLI via Gateway bootstrap verb | trusted stores (locators); never touched by remove/installer |
| `~/.local/share/pi-shuttle/git-home|git-tmp/` | CLI | empty isolation dirs per store |
| `~/.local/share/pi-shuttle/packages/` | installer | versioned component installs |
| `~/.local/state/pi-shuttle/install.json` | installer | install receipt |
| `~/.local/state/pi-shuttle/logs/` | installer/CLI | bounded logs |

The CLI treats the runtime config as the single operator-owned composition
document: it is written only by `project add`/`project remove`, read by
`project list`/`doctor`/`start`, and passed verbatim to the Gateway CLI.
No other writer exists.

## 8. Interactions with the compatibility manifest

- `--version` prints the CLI version and the manifest's pinned component
  versions.
- The CLI fails closed when the installed manifest (receipt) does not match
  its own version (e.g. a partially upgraded tree).
- `doctor` verdicts come from manifest lanes; the CLI never claims a lane
  the manifest does not declare.
