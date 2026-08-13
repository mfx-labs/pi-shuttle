/**
 * PS-6 workflow static security checks (SIR-PS6-002/003/007 + PS6-CI-002/
 * 003/004 corrections). These are genuine invariants only — no incidental
 * line-count pins:
 *
 *  - `permissions: contents: read` on every workflow;
 *  - every remote `uses:` is `owner/repository@FULL_40_HEX_SHA` (exactly
 *    one `@`; the left side is a valid action identity; the right side is
 *    exactly 40 hex; no floating branch/tag ref; a BARE SHA is invalid);
 *  - no sudo, no token write, no publication/release/deployment steps;
 *  - no workflow_dispatch inputs at all (PS-6 public multi-repo lane):
 *    component identities are repository-owned constants, never
 *    user-supplied refs — no `inputs.*` anywhere;
 *  - every component checkout `ref:` is an exact full 40-hex SHA and the
 *    checked-out HEAD is asserted against the repository-owned pin;
 *  - no external fixture transport (no fixture_source, no curl fixture
 *    download, no fixture-source validation helper);
 *  - every helper script referenced by the workflows exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const WORKFLOWS = join(REPO, '.github', 'workflows');
const HEX40_RE = /^[0-9a-fA-F]{40}$/;
const REMOTE_ACTION_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-fA-F]{40}$/;

/**
 * Static remote-action-ref invariant (PS6-CI-002): the ONLY accepted form
 * is `owner/repository@FULL_40_HEX_SHA` — exactly one `@`, a valid
 * owner/repository identity on the left, exactly 40 hex on the right.
 * A bare SHA, a floating tag/branch, a short SHA, or malformed `@`
 * structure all FAIL. Local action references (if any) are handled
 * separately and never forced through this remote-action rule.
 */
export function isValidRemoteActionRef(ref: string): boolean {
  if (!REMOTE_ACTION_RE.test(ref)) return false;
  const at = ref.split('@');
  if (at.length !== 2) return false; // exactly one '@' separating identity from ref
  const [identity, sha] = at as [string, string];
  if (identity.length === 0 || !identity.includes('/')) return false;
  if (sha.length === 0 || !HEX40_RE.test(sha)) return false;
  return true;
}

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS).filter((n) => n.endsWith('.yml')).sort();
}

test('workflow security: every workflow pins permissions, owner/repo@full-SHA actions, and no privileged/publication steps', () => {
  const files = workflowFiles();
  assert.equal(files.length, 3, 'exactly the three PS-6 lane workflows');
  for (const name of files) {
    const text = readFileSync(join(WORKFLOWS, name), 'utf8');
    assert.ok(text.includes('permissions:\n  contents: read'), `${name}: minimal read-only permissions`);
    const uses = text.split('\n').filter((l) => l.trimStart().startsWith('uses:'));
    assert.ok(uses.length >= 1, `${name}: at least one action`);
    for (const line of uses) {
      const ref = line.trim().split(/\s+/)[1]!;
      assert.equal(isValidRemoteActionRef(ref), true, `${name}: remote action must be owner/repo@40-hex, got ${ref}`);
    }
    assert.ok(!text.includes('@v4'), `${name}: no floating major tag`);
    assert.ok(!text.includes('@main'), `${name}: no branch ref`);
    assert.ok(!text.includes('sudo '), `${name}: no sudo`);
    assert.ok(!text.includes('npm publish'), `${name}: no npm publication`);
    assert.ok(!text.includes('GITHUB_TOKEN'), `${name}: no token usage`);
    assert.ok(!text.includes('gh release'), `${name}: no GitHub Release`);
    assert.ok(!text.includes('${{ inputs.'), `${name}: no workflow_dispatch inputs anywhere (PS-6 public multi-repo lane)`);
    assert.ok(!text.includes('github.com/git/git/archive'), `${name}: no floating git tag tarball URL (digest-pinned kernel.org source only)`);
  }
});

test('workflow security: remote action refs require owner/repo@40-hex — PS6-CI-002 regression cases', () => {
  const SHA40 = '11bd71901bbe5b1630ceea73d27597364c9af683';
  assert.equal(isValidRemoteActionRef(SHA40), false, 'bare SHA → FAIL');
  assert.equal(isValidRemoteActionRef(`actions/checkout@${SHA40}`), true, 'actions/checkout@<40-sha> → PASS');
  assert.equal(isValidRemoteActionRef('actions/checkout@v4'), false, 'floating tag → FAIL');
  assert.equal(isValidRemoteActionRef('actions/checkout@main'), false, 'floating branch → FAIL');
  assert.equal(isValidRemoteActionRef('actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683x'), false, 'non-hex 40-char ref → FAIL');
  assert.equal(isValidRemoteActionRef('actions/checkout@11bd7190'), false, 'short SHA → FAIL');
  assert.equal(isValidRemoteActionRef('actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683@extra'), false, 'multiple @ → FAIL');
  assert.equal(isValidRemoteActionRef('checkout@11bd71901bbe5b1630ceea73d27597364c9af683'), false, 'missing owner/repository → FAIL');
  assert.equal(isValidRemoteActionRef('actions/checkout@'), false, 'empty ref → FAIL');
  assert.equal(isValidRemoteActionRef('actions/checkout'), false, 'no @ → FAIL');
  assert.equal(isValidRemoteActionRef('@11bd71901bbe5b1630ceea73d27597364c9af683'), false, 'empty identity → FAIL');
  assert.equal(isValidRemoteActionRef('actions/checkout@@11bd71901bbe5b1630ceea73d27597364c9af683'), false, 'empty ref between @ → FAIL');
});

test('workflow security: no workflow_dispatch inputs, no external fixture transport — PS-6 public multi-repo lane', () => {
  const text = readFileSync(join(WORKFLOWS, 'lane-b-macos-arm64.yml'), 'utf8');
  assert.ok(!text.includes('workflow_dispatch:\n    inputs:'), 'no dispatch inputs in Lane B (component identities are repository-owned pins)');
  assert.ok(!text.includes('inputs.fixture_source'), 'no fixture_source input machinery remains');
  assert.ok(!text.includes('FIXTURE_SOURCE'), 'no fixture-source env transport remains');
  assert.ok(!text.includes('ci-validate-fixture-source.sh'), 'fixture-source validation helper no longer referenced');
  assert.ok(!text.includes('curl -fsSL -- "$FIXTURE_SOURCE"'), 'no curl fixture download remains');
  assert.ok(!text.includes("github.event_name == 'workflow_dispatch'"), 'real-stack job is no longer dispatch-gated');
  assert.ok(!text.includes('needs.real-stack.result'), 'no fixture-gate report job remains');
});

test('workflow security: component checkouts are exact public SHAs with asserted HEADs — PS-6 public multi-repo lane', () => {
  const text = readFileSync(join(WORKFLOWS, 'lane-b-macos-arm64.yml'), 'utf8');
  const GATEWAY_COMMIT = '55f764290a4567a20557f1db19d2a6fb97572a97';
  const PI_GUARD_COMMIT = '7a7580cc4cbd7926797564c72269394fc29a860a';
  // Exact full-SHA component checkouts (never branches/tags as authority).
  assert.ok(text.includes(`repository: mfx-labs/project-gateway`), 'Gateway checked out from its public repository');
  assert.ok(text.includes(`ref: ${GATEWAY_COMMIT}`), 'Gateway checkout ref is the exact public commit');
  assert.ok(text.includes(`repository: mfx-labs/pi-guard`), 'pi-guard checked out from its public repository');
  assert.ok(text.includes(`ref: ${PI_GUARD_COMMIT}`), 'pi-guard checkout ref is the exact commit');
  // Repository-owned pins as workflow constants (no user-supplied refs).
  assert.ok(text.includes(`GATEWAY_COMMIT: ${GATEWAY_COMMIT}`), 'Gateway pin is a repository-owned workflow constant');
  assert.ok(text.includes(`PI_GUARD_COMMIT: ${PI_GUARD_COMMIT}`), 'pi-guard pin is a repository-owned workflow constant');
  // Independent HEAD assertion for both components (fail closed).
  assert.ok(text.includes('git -C "${{ github.workspace }}/gateway" rev-parse HEAD'), 'Gateway checked-out HEAD asserted');
  assert.ok(text.includes('git -C "${{ github.workspace }}/pi-guard" rev-parse HEAD'), 'pi-guard checked-out HEAD asserted');
  assert.ok(text.includes('test "$GW_HEAD" = "$GATEWAY_COMMIT"'), 'Gateway HEAD compared to the exact pin');
  assert.ok(text.includes('test "$PG_HEAD" = "$PI_GUARD_COMMIT"'), 'pi-guard HEAD compared to the exact pin');
  // Fixtures built on the runner through the committed helper (no hosting).
  assert.ok(text.includes('bash scripts/prepare-fixtures.sh'), 'fixtures built through the committed helper');
  assert.ok(text.includes('--gateway-checkout "${{ github.workspace }}/gateway"'), 'Gateway checkout passed to the fixture builder');
  assert.ok(text.includes('--pi-guard-checkout "${{ github.workspace }}/pi-guard"'), 'pi-guard checkout passed to the fixture builder');
});

test('workflow security: every referenced helper script exists', () => {
  const referenced = new Set<string>();
  for (const name of workflowFiles()) {
    const text = readFileSync(join(WORKFLOWS, name), 'utf8');
    for (const m of text.matchAll(/scripts\/[A-Za-z0-9._-]+/g)) referenced.add(m[0]);
  }
  assert.ok(referenced.size >= 2, 'workflows reference helper scripts');
  for (const rel of referenced) {
    assert.equal(existsSync(join(REPO, rel)), true, `${rel} must exist`);
  }
});

test('workflow security: lane B asserts the node architecture and uses the dedicated APFS evidence gate', () => {
  const text = readFileSync(join(WORKFLOWS, 'lane-b-macos-arm64.yml'), 'utf8');
  assert.ok(text.includes('test "$(node -p process.arch)" = "arm64"'), 'lane B: node arch must be ASSERTED arm64 (SIR-PS6-007)');
  assert.ok(text.includes('node scripts/ci-apfs-evidence-strict.mjs'), 'lane B: dedicated APFS evidence invocation (SIR-PS6-004)');
  assert.ok(text.includes('bash scripts/ci-provision-git-2454.sh'), 'lane B: digest-pinned git provisioning (SIR-PS6-003)');
  assert.ok(text.includes('bash scripts/prepare-fixtures.sh'), 'lane B: fixtures built through the committed helper');
  assert.ok(!text.includes('ci-validate-fixture-source.sh'), 'lane B: no fixture-source validation helper remains');
});
