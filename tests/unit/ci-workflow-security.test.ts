/**
 * PS-6 workflow static security checks (SIR-PS6-002/003/007 corrections).
 * These are genuine invariants only — no incidental line-count pins:
 *
 *  - `permissions: contents: read` on every workflow;
 *  - every `uses:` pinned to a FULL commit SHA (40 hex) with a comment
 *    naming the upstream tag; no floating refs;
 *  - no sudo, no token write, no publication/release/deployment steps;
 *  - no workflow_dispatch input interpolated into `run:` shell text
 *    (fixture_source crosses the boundary as env data and is validated
 *    before any curl);
 *  - every helper script referenced by the workflows exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const WORKFLOWS = join(REPO, '.github', 'workflows');
const SHA_RE = /^[0-9a-f]{40}$/;

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS).filter((n) => n.endsWith('.yml')).sort();
}

test('workflow security: every workflow pins permissions, full-SHA actions, and no privileged/publication steps', () => {
  const files = workflowFiles();
  assert.equal(files.length, 3, 'exactly the three PS-6 lane workflows');
  for (const name of files) {
    const text = readFileSync(join(WORKFLOWS, name), 'utf8');
    assert.ok(text.includes('permissions:\n  contents: read'), `${name}: minimal read-only permissions`);
    const uses = text.split('\n').filter((l) => l.trimStart().startsWith('uses:'));
    assert.ok(uses.length >= 1, `${name}: at least one action`);
    for (const line of uses) {
      const ref = line.trim().split(/\s+/)[1]!;
      assert.match(ref, SHA_RE, `${name}: action pinned by full commit SHA, got ${ref}`);
      assert.ok(!ref.includes('@'), `${name}: no floating ref syntax`);
    }
    assert.ok(!text.includes('@v4'), `${name}: no floating major tag`);
    assert.ok(!text.includes('@main'), `${name}: no branch ref`);
    assert.ok(!text.includes('sudo '), `${name}: no sudo`);
    assert.ok(!text.includes('npm publish'), `${name}: no npm publication`);
    assert.ok(!text.includes('GITHUB_TOKEN'), `${name}: no token usage`);
    assert.ok(!text.includes('gh release'), `${name}: no GitHub Release`);
    // SIR-PS6-002: dispatch inputs never reach shell text directly.
    for (const line of text.split('\n')) {
      if (line.trimStart().startsWith('run:') || line.includes('run:')) {
        assert.ok(!line.includes('${{ inputs.'), `${name}: no input interpolation in run: shell text (${line.trim().slice(0, 80)})`);
      }
      assert.ok(!line.includes('inputs.fixture_source"'), `${name}: no quoted input interpolation in shell text`);
    }
    assert.ok(!text.includes('github.com/git/git/archive'), `${name}: no floating git tag tarball URL (digest-pinned kernel.org source only)`);
  }
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
  assert.ok(text.includes('bash scripts/ci-validate-fixture-source.sh'), 'lane B: fixture source validated before fetch (SIR-PS6-002)');
  assert.ok(text.includes('bash scripts/ci-provision-git-2454.sh'), 'lane B: digest-pinned git provisioning (SIR-PS6-003)');
  assert.ok(text.includes('curl -fsSL -- "$FIXTURE_SOURCE"'), 'lane B: argv-safe curl boundary');
  assert.ok(!text.includes('${{ inputs.fixture_source }}"'), 'lane B: no interpolated fixture_source in shell text');
});
