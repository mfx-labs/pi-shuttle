/**
 * PS-2 architectural static guard (genuine invariants only — no incidental
 * line-count pins):
 *
 * 1. src/ has NO subprocess, network, tunnel, MCP-SDK, pi-guard, or Gateway
 *    import vocabulary — PS-2 must not reach outside its own layer.
 * 2. `process.env` is confined to the host seam (home discovery is the
 *    narrow injectable boundary).
 * 3. `node:crypto` is confined to identity derivation.
 * 4. `node:fs` is confined to the three leaf modules (persistence writer,
 *    bounded JSON intake, host canonicalization); filesystem mutation
 *    vocabulary lives ONLY in the single authoritative writer.
 * 5. No trusted-authority vocabulary: pi-shuttle must never mint or
 *    reference Gateway provenance/capability/approval machinery.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const SRC = join(REPO, 'src');

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function rel(file: string): string {
  return file.slice(REPO.length + 1);
}

const files = collectTsFiles(SRC);
assert.ok(files.length >= 10, 'the PS-2 source tree must exist');

/** Exact node:fs named-import allowlists per fs-bearing module. */
const FS_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  'src/persistence/writer.ts': ['mkdirSync', 'openSync', 'closeSync', 'writeSync', 'fsyncSync', 'renameSync', 'unlinkSync', 'fchmodSync'],
  'src/host/environment.ts': ['realpathSync'],
  'src/config/json.ts': ['openSync', 'closeSync', 'readSync', 'fstatSync'],
};

test('ps2 static guard: no subprocess/network/tunnel/MCP/pi-guard/Gateway vocabulary in src', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of [
      'node:child_process', 'node:net', 'node:http', 'node:https', 'node:tls', 'node:dgram',
      "from '@modelcontextprotocol", "from 'pi-guard'", "from '../pi-guard'", 'fetch(', 'WebSocket',
      'spawn(', 'exec(', 'oauth', 'OAuth', 'sudo',
    ]) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
  }
});

test('ps2 static guard: process.env is confined to the host seam', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (rel(file) === 'src/host/environment.ts') continue;
    assert.equal(content.includes('process.env'), false, `${rel(file)} must not read the environment directly`);
  }
});

test('ps2 static guard: node:crypto is confined to identity derivation', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (rel(file) === 'src/registry/identity.ts') continue;
    assert.equal(content.includes('node:crypto'), false, `${rel(file)} must not use crypto`);
  }
});

test('ps2 static guard: node:fs is confined to the three leaf modules with exact allowlists', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (!content.includes('node:fs')) continue;
    const allowed = FS_ALLOWLIST[rel(file)];
    assert.ok(allowed !== undefined, `${rel(file)} imports node:fs outside the allowed set`);
    for (const m of content.matchAll(/import\s*\{([^}]+)\}\s*from\s*'node:fs'/g)) {
      for (const name of m[1]!.split(',').map((s) => s.trim()).filter((s) => s.length > 0)) {
        assert.ok(allowed.includes(name), `${rel(file)} imports ${name} outside the allowlist`);
      }
    }
  }
  // The writer is the ONLY mutating fs module: rename/mkdir/unlink appear
  // nowhere else in src.
  for (const file of files) {
    if (rel(file) === 'src/persistence/writer.ts') continue;
    const content = readFileSync(file, 'utf8');
    for (const mutating of ['renameSync', 'mkdirSync', 'unlinkSync']) {
      assert.equal(content.includes(mutating), false, `${rel(file)} must not mutate the filesystem (${mutating})`);
    }
  }
});

test('ps2 static guard: no trusted-authority vocabulary in src', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of [
      'initializeTrustedStore', 'createStorageBootstrapActionProvenance', 'StorageBootstrapActionProvenance',
      'TrustedStorageBootstrapInput', 'createInitializationCapability', 'RuntimeGrant', 'TrustedReceipt',
      'ExecutionResult', 'markValidatedTrustedWorkspaceConfiguration',
    ]) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reference trusted-authority machinery (${forbidden})`);
    }
  }
});

test('ps2 static guard: package surface stays a single private bin', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
    readonly bin?: Record<string, string>;
    readonly private?: boolean;
    readonly dependencies?: Record<string, string>;
  };
  assert.deepEqual(Object.keys(pkg.bin ?? {}), ['pi-shuttle'], 'exactly one executable: pi-shuttle');
  assert.equal(pkg.private, true, 'package must stay private/unpublished');
  assert.equal(pkg.dependencies, undefined, 'no runtime dependencies in PS-2');
});
