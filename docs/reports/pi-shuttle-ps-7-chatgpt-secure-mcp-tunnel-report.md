# PS-7 — ChatGPT / Secure MCP Tunnel Onboarding and Live Acceptance — Report

**Date:** 2026-08-14
**Gate scope:** official OpenAI-source verification; Secure MCP Tunnel
onboarding documentation; ChatGPT custom MCP app onboarding; operator-
assisted live end-to-end evidence.
**Out of scope (not touched):** release artifact hosting, installer
network acquisition, package licensing, release tags, GitHub Releases,
Gateway/pi-guard code, authority semantics. No product-code mutation was
made.

---

## 1. Starting pi-shuttle SHA

- **Local archive HEAD before alignment:**
  `251bcae57b9ae5b95c3741ae21d6306afd73a6f3`
  (divergent local re-imported archive lineage: `2acc818` "baseline:
  pi-shuttle master archive (PS-6/PS-6R state)" + re-imported PS-6I
  commits with non-remote SHAs).
- **Authoritative remote master after fetch:**
  `b178169a45f6c26758c9bda077c40eba4789d389` — `docs: rewrite README as a
  public landing page` (the expected landing-page rewrite), on the
  original linear remote lineage.
- Local HEAD ≠ remote master on first check (remote had advanced
  normally). The local history was a re-imported archive snapshot with
  different SHAs for the same content and a stale pre-rewrite README.
  **Repository-state action taken (local only, no push):** aligned local
  `master` to `origin/master` (`git reset --mixed origin/master` +
  restore of stale archive copies of four tracked docs to their
  authoritative remote versions: README.md, PS-6I macOS Intel focused
  review, PS-6I macOS Intel implementation report, PS-6I remote CI
  evidence). Untracked local-only files (`.DS_Store`,
  `docs/reports/pi-shuttle-ps-6i-reattach-publication-blocked.md`) were
  left untouched. After alignment, `HEAD == origin/master ==
  b178169a45f6c26758c9bda077c40eba4789d389`. No product code changed.

## 2. Official OpenAI sources and verification date

Verified 2026-08-14 against current official OpenAI documentation only
(no blogs from third parties, no historical screenshots):

| # | Source (official) | What it establishes |
|---|---|---|
| 1 | [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) | Tunnel role, outbound-only design, Platform tunnel settings, `tunnel-client` stdio/HTTP local targets, documented init/doctor/run command shape, workspace association, RBAC (Tunnels Read/Manage/Use), health surfaces |
| 2 | [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) | Full MCP (incl. write/modify) rolling out in beta to Business/Enterprise/Edu; developer-mode enablement paths (workspace admin + user settings); app creation/test/publish flow; RBAC for Enterprise/Edu |
| 3 | [ChatGPT Developer mode guide](https://developers.openai.com/api/docs/guides/developer-mode) | Developer mode = full MCP client support, read and write; eligibility (Pro/Plus/Business/Enterprise/Edu on web); `Settings → Security and login`; **"Developer mode does not require `search`/`fetch` tools"**; app creation via Plugins plus button; invocation via Plus menu / composer |
| 4 | [Connect from ChatGPT (Apps SDK)](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt) | Developer-mode app creation (name/description/MCP URL), invocation (`+` → More → app), testing guidance |
| 5 | [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt) | Tunnel as connection method for developer-mode testing; Secure MCP Tunnel does not support public plugin submission |
| 6 | [Building MCP servers for plugins and API integrations](https://developers.openai.com/api/docs/mcp) | `search`/`fetch` tools are a **company-knowledge/deep-research** compatibility requirement, not a general MCP-app requirement |
| 7 | [Making private MCP servers reachable…](https://developers.openai.com/blog/connect-private-mcp-servers-to-openai-products) | Official engineering rationale: private servers stay private; outbound-only client |
| 8 | [Company knowledge in ChatGPT](https://help.openai.com/en/articles/12628342-company-knowledge-in-chatgpt-business-enterprise-and-edu) | Confirms search/fetch applies only to company-knowledge eligibility |

### Verified OpenAI behavior (recorded from current official sources)

- **Direct localhost connection:** ChatGPT does not connect directly to
  a local MCP server. Local/private MCP servers require Secure MCP
  Tunnel (official guide: "Use it when your MCP server is private,
  on-premises, or behind a firewall, but ChatGPT … still needs to call
  it"). No direct-localhost claim exists in the onboarding doc.
- **Secure MCP Tunnel's role:** an OpenAI-hosted MCP tunnel endpoint
  created in Platform tunnel settings; `tunnel-client` runs inside the
  private network, opens outbound HTTPS to OpenAI, long-polls for work,
  forwards MCP requests to the private server. Private servers never get
  a public listener. Does not support public plugin submission.
- **Plans:** full MCP custom apps (incl. write/modify) are rolling out
  in beta to **Business, Enterprise, Edu**. Developer mode itself is
  documented as available to Pro/Plus/Business/Enterprise/Edu on web;
  the full custom-MCP-app + tunnel + workspace path is the
  Business/Enterprise/Edu story. No unsupported plan claim is made in
  the docs.
- **Developer mode enablement:** user toggle at Settings → Security and
  login; workspace admins enable in workspace settings (Business:
  admins/owners only; Enterprise/Edu: RBAC-grantable).
- **Custom app creation/testing:** chatgpt.com/plugins → plus →
  developer-mode app → Connection: Tunnel (select tunnel or paste
  `tunnel_id`) → create → tool list. Test in a conversation via the
  composer/+ → More → app or the Developer mode menu.
- **Publication:** developer-mode apps are private drafts; public
  distribution is via the plugin submission portal and requires a
  public HTTPS endpoint (out of this gate's ownership).
- **search/fetch:** no longer required for MCP apps (explicit current
  statement in the developer-mode guide); required only for company
  knowledge eligibility.
- **Invocation:** `+` near composer → More → choose app; or Developer
  mode in the Plus menu; prompt the model; write tools confirm by
  default.

### Repository-doc conflict check

No conflict found between official OpenAI behavior and the repo
contracts. The onboarding doc was written to the current official
behavior (per the gate: official behavior wins).

## 3. Actual workspace capability

**NOT EXERCISED.** This execution had no access to a ChatGPT web
workspace session and no OpenAI Platform/ChatGPT credentials, and the
gate forbids recording such credentials. Therefore the workspace's
developer-mode availability, custom-app creation availability, and
Secure MCP Tunnel availability could **not be inspected in the actual
UI**. Per gate §4, no successful ChatGPT integration is faked,
emulated, or inferred.

Additionally, the physical host does not currently have the pi-shuttle
product installed (`pi-shuttle doctor` exit 1 — see §4), which is a
prerequisite for live tunnel testing in any case. Installing requires
the private/UNLICENSED Gateway artifact via the installer (a
human-authorized release gate, and "installer network acquisition" is
explicitly outside this gate's ownership), so installation was not
attempted.

**Classification (live acceptance):**
`PS-7 LIVE ACCEPTANCE — BLOCKED BY OPENAI WORKSPACE ELIGIBILITY`
This is an external product-plan/workspace limitation, explicitly
distinguished from a pi-shuttle defect.

## 4. Local product health (recorded evidence)

```text
$ pi-shuttle doctor          → exit 1
  platform: supported — darwin x64 (lane darwin-x86_64-posix-utf8-node22)
  node: supported — node 22.23.1 (minimum 22.19.0; baseline 22.23.2)
  git: supported — /usr/bin/git — git 2.37.1 (minimum 2.30.0; baseline 2.45.4)
  pi: installed but unverified — pi 0.84.1 candidate; pi-guard extension
      entry missing
  installation receipt: missing
  gateway component: missing
  pi-guard component: missing
  runtime configuration: missing (no projects registered)
  coordination locks: supported
  note: ChatGPT/tunnel readiness is not locally observable (external
        platform state)

$ pi-shuttle project list    → exit 0
  no registered projects
```

Required-before-live-testing condition (`doctor` exit 0 + ≥1 registered
project) was **not met** on this host. No disposable project could be
registered (registration requires the installed Gateway component for
the bootstrap verb). No production repository was touched. This is
recorded honestly; the onboarding doc's prerequisite steps reflect what
an operator with an installed product must see.

## 5. Actual tunnel mechanism (documented, not observed live)

The current OpenAI-documented mechanism (Secure MCP Tunnel guide):

1. Create an OpenAI-hosted MCP tunnel endpoint in **Platform tunnel
   settings**; associate it with the target ChatGPT workspace.
2. Run `tunnel-client` inside the network that reaches the private MCP
   server; it opens an outbound HTTPS path to OpenAI
   (`api.openai.com:443`, `/v1/tunnel/*`) and long-polls for queued MCP
   work.
3. The local target is configured as **stdio** (documented init sample
   `sample_mcp_stdio_local` with `--mcp-command "…"`) or an HTTP MCP URL
   (`--mcp-server-url`).

The documented command shape (operator must use the current
OpenAI-generated command; this repo ships no hard-coded command) is
`tunnel-client init/doctor/run --profile <name> --tunnel-id <id>
--mcp-command "pi-shuttle start"` plus a runtime API key.

**stdio `pi-shuttle start` through the tunnel:** the official guide
documents stdio local targets, so the existing stdio product bridges
without any product-side transport change — **no transport escalation
required** (`PS-7 — TRANSPORT CONTRACT ESCALATION REQUIRED` does **not**
apply). This is a documented-mechanism finding, **not** a live
observation; live confirmation remains blocked.

## 6. Custom app creation result

**Not performed.** Requires the eligible ChatGPT workspace (blocked, §3)
and the running tunnel. No app name/description was submitted anywhere;
no UI state was recorded. The onboarding doc specifies name
`pi-shuttle`, Connection: Tunnel, and the tool scan, per official docs.

## 7. Discovered MCP surface

**Not observed live** (no tunnel, no app). Expected surface per product
contracts (component-boundaries.md, operator-cli-contract.md check 13,
PS-5 E2E evidence): exactly nine public tools:

`validate-artifact`, `inspect-stored-record`, `inspect-registry`,
`inspect-audit-history`, `verify-record`, `enumerate-class`,
`draft-artifact`, `persist-artifact`, `inspect-changes`

Absence required (and documented as a scan gate): shell/exec, Git
mutation/push, approval, issuance, grant/activation tools.

## 8. Live ChatGPT end-to-end test results

**None.** Tests A–E (registry read, change inspection, validation,
draft/persist, negative boundary) were **not run**: the actual ChatGPT
custom app could not be created (blocked workspace). Per gate §4/§13,
no substitute probe results are reported as ChatGPT evidence, no
conversation was held, and no conversation secrets exist to redact.

## 9. Tunnel lifecycle behavior (documented from official sources)

- `tunnel-client run` must stay healthy for app discovery and tool
  calls; requests through the tunnel fail while the client is
  disconnected and resume when it reconnects (official guide).
- Reconnect health is observable via `tunnel-client doctor --profile
  <name> --explain` and the local admin UI (`/ui`, `/healthz`,
  `/readyz`).
- Tool updates after app creation: ChatGPT app details page supports
  refresh/rescan to pull new tools/descriptions and per-tool toggles
  (official developer-mode guide). Whether a given UI build requires a
  manual rescan after tunnel reconnect is a UI-level detail the
  operator verifies in the current UI — not claimed here.
- `pi-shuttle start` spawning: under the current documented mechanism,
  `tunnel-client` spawns the local stdio command (the configured
  `--mcp-command`); it is a child of the running `tunnel-client`, not a
  separately running process and not an auto-start service. The docs do
  not claim automatic startup beyond that mechanism.

## 10. Deliverables produced (docs only, no product code)

- `docs/chatgpt-secure-mcp-tunnel.md` — new onboarding doc (all §9
  sections: prerequisites; plan/workspace requirement; doctor; project
  registration; tunnel creation; local target = `pi-shuttle start`;
  developer mode; custom app creation; tool scan; expected nine tools;
  first test prompt; troubleshooting; security notes; "use the current
  OpenAI-generated command" caveat; no tokens/credentials/tunnel
  IDs/workspace identifiers embedded).
- `README.md` — one concise `ChatGPT integration` documentation entry
  pointing to the new doc (no implementation-report content added).
- `docs/work-packages.md`, `docs/test-and-release-plan.md` — reviewed;
  **no change required** (their PS-7 language already matches current
  verified OpenAI behavior). No historical reports rewritten.

## 11. Verification checklist (§12)

- [x] Every OpenAI claim in the doc has a current official-source basis
      (sources table above; fetched 2026-08-14).
- [x] No invented tunnel command: the reference shape is the officially
      documented `init --sample sample_mcp_stdio_local … --mcp-command`
      form, and the doc instructs using the current OpenAI-generated
      command.
- [x] No secret/token recorded: `CONTROL_PLANE_API_KEY="…"` and
      `<tunnel_id>` placeholders only; no credentials, tunnel IDs, or
      workspace identifiers anywhere in the repo diff.
- [x] Expected tool names match Gateway (identical to
      component-boundaries.md and PS-5 E2E evidence).
- [x] No direct-localhost claim; tunnel is outbound-only; Gateway never
      exposed publicly.
- [x] No unsupported ChatGPT plan claim: Business/Enterprise/Edu full
      MCP (beta) + developer-mode eligibility stated per official docs.
- [x] README links resolve (docs/chatgpt-secure-mcp-tunnel.md exists;
      relative link from README).
- [x] `git diff --check` clean (verified before commit).
- [x] No product-code mutation; no push.

## 12. Secrets-redaction confirmation

No secrets, tokens, tunnel credentials, ephemeral identifiers, or
personal workspace identifiers were recorded in this report, the
onboarding doc, or the README entry. Placeholders (`…`, `<tunnel_id>`)
are used where official commands carry secrets. No ChatGPT conversation
occurred, so no conversation content exists to store.

## 13. Outcome

Documentation portions verifiable without the live workspace were
completed and verified against current official OpenAI sources. The
stdio transport question is answered by official documentation (stdio
local targets are the documented mechanism; no escalation needed).

**Live acceptance is NOT claimed.** The ChatGPT workspace could not
exercise the full custom MCP path from this execution (no eligible
workspace session/credentials; product not installed on the host; the
installer path requires human-authorized private artifacts outside this
gate).

One local commit created: `docs: complete ChatGPT Secure MCP Tunnel
onboarding`. Not pushed (per gate).

---

`PS-7 — BLOCKED BY OPENAI WORKSPACE ELIGIBILITY`
