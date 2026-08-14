# ChatGPT integration: Secure MCP Tunnel onboarding

Connect ChatGPT to your local pi-shuttle Project Gateway through OpenAI's
Secure MCP Tunnel. The Gateway stays a private, stdio MCP process on your
machine; the tunnel gives ChatGPT a private MCP request path without
exposing your machine or your registered projects to the public
internet.

> **Verified against current official OpenAI sources on 2026-08-14.**
> OpenAI changes its UIs, plans, and generated commands over time. Where
> this document describes a UI flow or a command, use the **current**
> command/flow shown by OpenAI at the time you do it — never copy a
> hard-coded historical command from this repository.
>
> Sources: Secure MCP Tunnel guide
> (developers.openai.com/api/docs/guides/secure-mcp-tunnels), Developer
> mode and MCP apps in ChatGPT (help.openai.com/en/articles/12584461),
> ChatGPT Developer mode guide
> (developers.openai.com/api/docs/guides/developer-mode), Connect from
> ChatGPT (developers.openai.com/apps-sdk/deploy/connect-chatgpt).

## Prerequisites

- pi-shuttle installed with the Project Gateway component (the product
  installer; see the repository `README.md` quick start).
- At least one Git project registered with pi-shuttle.
- A ChatGPT workspace on a plan that supports full MCP custom apps (see
  next section), with developer mode available to you.
- An OpenAI Platform organization where you can create and use tunnels
  (Platform tunnel settings; Tunnels **Read + Manage** to create,
  **Read + Use** to run `tunnel-client` and to select the tunnel when
  creating the app).
- The tunnel must be associated with the ChatGPT workspace you will use.
- A machine that can reach your project and has outbound HTTPS to
  `api.openai.com:443` (no inbound ports needed).

## ChatGPT plan / workspace requirement

Per current official OpenAI documentation:

- **Full MCP support** (custom MCP apps, including write/modify actions)
  is rolling out in beta to **ChatGPT Business, Enterprise, and Edu**
  workspaces, on ChatGPT web. This is the path that can exercise the
  full nine-tool Gateway.
- **Developer mode** itself is documented as available to Pro, Plus,
  Business, Enterprise, and Education accounts on the web, but the full
  custom-MCP-app + tunnel + workspace deployment path is the
  Business/Enterprise/Edu story. Check your own workspace's actual
  capabilities — do not assume a Pro or Plus personal workspace can run
  the full path described here.
- Workspace admins must enable developer mode from workspace settings
  (Business: admins/owners only; Enterprise/Edu: admins can grant via
  RBAC, then members enable it for themselves).

If your workspace does not offer developer mode or Secure MCP Tunnel
app connections, you cannot complete this integration on that workspace.
That is an OpenAI workspace-eligibility limitation, not a pi-shuttle
defect.

## 1. `pi-shuttle doctor`

```bash
pi-shuttle doctor
```

Required result before starting: exit code `0` (all checks supported and
verifying: platform, Node, Git, Pi, installed components, runtime
configuration, registered projects). `doctor` exit `1` means findings
(e.g. missing components) — run the installer and fix those first.
`doctor` reports the ChatGPT/tunnel side as **not locally observable**
by design: that state is external to your machine and is never
fabricated.

## 2. Register a project

```bash
pi-shuttle project add /path/to/your/project
pi-shuttle project list
```

Use a disposable or non-critical project for testing. `project add`
runs the operator bootstrap (trusted-store initialization/verification)
and registers the project; `project list` shows what is registered.

## 3. Create the Secure MCP Tunnel

1. In the OpenAI Platform, open **Platform tunnel settings**
   (`platform.openai.com/settings/organization/tunnels`) and create an
   OpenAI-hosted MCP tunnel endpoint.
2. Associate the tunnel with the Platform organization **and** the
   ChatGPT workspace that will create the app. A tunnel associated only
   with a personal Platform organization does not automatically appear
   in a workspace.
3. Download `tunnel-client` (the download link in Platform tunnel
   settings, or the latest public release from the `openai/tunnel-client`
   repository).
4. Run `tunnel-client` on the machine that can already reach your
   project. It opens an **outbound-only** HTTPS path to OpenAI and
   forwards MCP requests to the local server. Your project stays behind
   your own network boundary — never expose the Gateway to the public
   internet.

The exact `tunnel-client` command is generated for you by OpenAI when you
create the tunnel. Use the **current command shown by OpenAI** — this
repository deliberately does not ship a hard-coded tunnel command.

The currently documented shape (for reference only, from the official
Secure MCP Tunnel guide) is:

```bash
export CONTROL_PLANE_API_KEY="..."        # runtime API key from OpenAI
tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile local-stdio \
  --tunnel-id <tunnel_id> \
  --mcp-command "pi-shuttle start"
tunnel-client doctor --profile local-stdio --explain
tunnel-client run --profile local-stdio
```

- `--mcp-command "pi-shuttle start"` makes `tunnel-client` spawn the
  pi-shuttle product entrypoint as a local stdio MCP server. This is the
  documented stdio-local mechanism — no HTTP/SSE transport is added to
  the Gateway.
- The runtime API key and `tunnel_id` are secrets/identifiers from your
  OpenAI account: keep them out of shell history, config files you
  commit, and this repository. Use placeholders (or a secret manager)
  everywhere you write them down.
- Keep `tunnel-client run ...` running and healthy while you create and
  test the app: app discovery and MCP tool calls depend on it. The
  local admin UI (`/ui`) and `tunnel-client doctor --explain` show
  whether the client is healthy, ready, and connected.

## 4. Local target = `pi-shuttle start`

The local MCP target must be the pi-shuttle product entrypoint:

```bash
pi-shuttle start
```

`tunnel-client` executes this command for you (per the current
OpenAI-documented mechanism, via the tunnel's stdio-local configuration);
you do not keep a foreground `pi-shuttle start` running yourself. The
command must be resolvable on the machine where `tunnel-client` runs
(pi-shuttle installs to `~/.local/bin`).

`pi-shuttle start` starts the Gateway MCP process with stdio inherited —
the MCP protocol stream the tunnel forwards. You do not need `pi-shuttle
start` running separately for ChatGPT use; the tunnel spawns it.

## 5. ChatGPT developer mode

1. Workspace admin (if you are not one): enable developer mode in
   workspace settings — **Workspace Settings → Permissions & Roles →
   Connected Data → Developer mode / Create custom MCP connectors**
   (label may vary by plan; Business = admins/owners only, Enterprise/Edu
   can use RBAC).
2. In ChatGPT, open **Settings → Security and login** and turn on
   **Developer mode**. If the toggle is unavailable, ask your workspace
   admin to allow developer mode for your account.

## 6. Create the custom MCP app

1. Open ChatGPT **Plugins** (`chatgpt.com/plugins`), or Settings →
   Plugins.
2. Select the **+** (plus) button to create a developer-mode app. The
   plus button only creates developer-mode apps after developer mode is
   on.
3. Give the app a clear name (e.g. `pi-shuttle`) and a description the
   model can use for discovery.
4. Under **Connection**, choose **Tunnel**, then select your tunnel from
   the list (or paste the `tunnel_id`).
5. Create the connection. If it succeeds, ChatGPT shows the tools the
   server advertises — this is the tool scan.

## 7. Tool scan — expect exactly nine tools

The Gateway's public MCP surface is exactly nine tools:

- `validate-artifact`
- `inspect-stored-record`
- `inspect-registry`
- `inspect-audit-history`
- `verify-record`
- `enumerate-class`
- `draft-artifact`
- `persist-artifact`
- `inspect-changes`

The scan must show **only** these nine. If any generic authority or
execution tool appears (shell/exec, Git mutation/push, approval,
issuance, grant/activation), stop — that surface is not the pi-shuttle
Gateway.

## 8. First test prompt

In a new ChatGPT conversation, invoke the app (the **+** button near the
composer → **More** → choose `pi-shuttle`; or select it from the
Developer mode menu), then ask something read-only, for example:

> Use the pi-shuttle app to inspect the registry of my registered
> project.

Expected: ChatGPT selects `inspect-registry` (or `inspect-changes`) and
returns the project state. Write/modify tools (`draft-artifact`,
`persist-artifact`) are available but ChatGPT asks for confirmation
before write actions by default — do not bypass those confirmations.

## Troubleshooting

- **Tunnel not listed in ChatGPT when creating the app:** verify the
  tunnel is associated with the target ChatGPT workspace (not only a
  Platform organization) and that you have Tunnels **Use** permission.
- **Tool calls fail / app can't connect:** confirm `tunnel-client run`
  is still running and healthy (`tunnel-client doctor --profile <name>
  --explain`, local `/ui`); requests through the tunnel fail while the
  client is disconnected and recover when it reconnects.
- **New tools not visible:** refresh/rescan the app from its details
  page in ChatGPT (the app settings page lets you refresh apps to pull
  new tools, descriptions, and server instructions, and toggle tools on
  or off).
- **Developer mode toggle unavailable:** your workspace admin must
  enable developer mode for your account/workspace first.
- **Doctor exit 1:** run the pi-shuttle installer and re-check;
  `doctor` must be exit 0 before tunnel testing.

## Security notes

- The Gateway stays private. The tunnel is outbound-only from your
  network; do not expose `pi-shuttle start` or the Gateway to the public
  internet, and do not point the tunnel at anything but your own
  registered project.
- The `tunnel-client` runtime API key and `tunnel_id` are OpenAI account
  credentials/identifiers: treat them as secrets, never commit them, and
  redact them in any evidence you record.
- Only connect MCP servers you trust. An MCP server can present tools
  with real effects — the pi-shuttle surface is bounded (nine tools, no
  shell/exec, no Git mutation, no approval/grant surface), which is
  exactly why the tool scan in §7 is a gate.
- ChatGPT asks before write actions by default; keep that behavior.
- Secure MCP Tunnel is for private, developer-mode connections only. It
  does not support public plugin submission or distribution — public
  distribution requires a stable public HTTPS MCP endpoint and the
  plugin submission portal, which is outside this integration.
