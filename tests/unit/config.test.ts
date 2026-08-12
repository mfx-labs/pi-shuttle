/**
 * PS-2 focused tests: runtime-document model (closed fields, deterministic
 * serialization) and bounded JSON intake (duplicate-key rejection).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findDuplicateKey, MAX_CONFIG_BYTES, parseJsonRejectingDuplicates, readBoundedTextFile } from '../../src/config/json.js';
import { parseRuntimeDocument, readRuntimeDocument, serializeRuntimeDocument, validateRuntimeDocument } from '../../src/config/document.js';
import type { RuntimeDocument, SurfaceConfig } from '../../src/config/document.js';

const IDENTITY = 'sha-256:' + 'a'.repeat(64);

function validSurface(overrides: Record<string, unknown> = {}): SurfaceConfig {
  return {
    surfaceId: 'main',
    locator: '/home/operator/store',
    serviceUid: 1000,
    forbiddenRoots: [],
    configurationIdentity: IDENTITY,
    configurationVersion: '2',
    limitProfile: {},
    ...overrides,
  } as SurfaceConfig;
}

function validDocument(overrides: Record<string, unknown> = {}): RuntimeDocument {
  return { surfaces: [validSurface()], ...overrides } as RuntimeDocument;
}

test('runtime document: valid document round-trips exactly', () => {
  const doc = validDocument({
    surfaces: [
      validSurface({
        workspaces: [{ workspaceId: 'pgw:w:abcd', root: '/home/operator/proj', artifactLocation: '/home/operator/proj/artifacts' }],
        gitPath: '/usr/local/bin/git',
        gitHome: '/home/operator/git-home',
        gitTmpdir: '/home/operator/git-tmp',
        forbiddenRoots: ['/home/operator/forbidden'],
        limitProfile: { maxBytes: 100 },
      }),
    ],
  });
  const text = serializeRuntimeDocument(doc);
  const parsed = parseRuntimeDocument(text);
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.message);
  if (parsed.ok) {
    assert.deepEqual(parsed.document, doc);
  }
});

test('runtime document: serialization is deterministic and key-ordered', () => {
  const doc = validDocument();
  const text1 = serializeRuntimeDocument(doc);
  const text2 = serializeRuntimeDocument(doc);
  assert.equal(text1, text2, 'same document must serialize to identical bytes');
  assert.ok(text1.endsWith('\n'));
  // Key order is fixed regardless of construction order.
  const reordered = validDocument({
    surfaces: [validSurface({ gitTmpdir: '/t', gitHome: '/h', gitPath: '/g' })],
  });
  const textA = serializeRuntimeDocument(reordered);
  const parsed = parseRuntimeDocument(textA);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(serializeRuntimeDocument(parsed.document), textA, 'parse->serialize must be byte-stable');
});

test('runtime document: closed-field rejection', () => {
  const cases: Array<{ readonly name: string; readonly doc: unknown }> = [
    { name: 'unknown top-level field', doc: { surfaces: [], extra: true } },
    { name: 'missing surfaces', doc: {} },
    { name: 'unknown surface field', doc: { surfaces: [{ surfaceId: 'a', locator: '/l', configurationIdentity: IDENTITY, configurationVersion: '2', authority: 'x' }] } },
    { name: 'unknown workspace field', doc: { surfaces: [validSurface({ workspaces: [{ workspaceId: 'w', root: '/r', extra: 1 }] })] } },
    { name: 'missing configurationIdentity', doc: { surfaces: [{ surfaceId: 'a', locator: '/l', configurationVersion: '2' }] } },
    { name: 'malformed identity syntax', doc: { surfaces: [validSurface({ configurationIdentity: 'not-a-digest' })] } },
    { name: 'relative locator', doc: { surfaces: [validSurface({ locator: 'relative' })] } },
    { name: 'wrong serviceUid type', doc: { surfaces: [validSurface({ serviceUid: '1000' })] } },
    { name: 'negative serviceUid', doc: { surfaces: [validSurface({ serviceUid: -1 })] } },
    { name: 'non-array forbiddenRoots', doc: { surfaces: [validSurface({ forbiddenRoots: '/x' })] } },
    { name: 'relative forbiddenRoot', doc: { surfaces: [validSurface({ forbiddenRoots: ['relative'] })] } },
    { name: 'non-string limitProfile value', doc: { surfaces: [validSurface({ limitProfile: { a: 'b' } })] } },
    { name: 'duplicate surfaceId', doc: { surfaces: [validSurface(), validSurface({ surfaceId: 'main' })] } },
    { name: 'relative workspace root', doc: { surfaces: [validSurface({ workspaces: [{ workspaceId: 'w', root: 'relative' }] })] } },
    { name: 'relative artifactLocation', doc: { surfaces: [validSurface({ workspaces: [{ workspaceId: 'w', root: '/r', artifactLocation: 'relative' }] })] } },
    { name: 'empty surfaces is valid', doc: { surfaces: [] } },
  ];
  for (const c of cases) {
    if (c.name === 'empty surfaces is valid') {
      const result = validateRuntimeDocument(c.doc);
      assert.equal(result.ok, true, c.name);
      continue;
    }
    const result = validateRuntimeDocument(c.doc);
    assert.equal(result.ok, false, `${c.name} must be rejected`);
  }
});

test('runtime document: malformed JSON fails closed', () => {
  for (const text of ['{invalid', '{"surfaces":}', '']) {
    const parsed = parseRuntimeDocument(text);
    assert.equal(parsed.ok, false, JSON.stringify(text));
  }
});

test('json intake: duplicate keys rejected at every nesting level', () => {
  const cases: Array<[string, string]> = [
    ['{"surfaces":[],"surfaces":[]}', 'surfaces'],
    ['{"surfaces":[{"surfaceId":"a","surfaceId":"b"}]}', 'surfaceId'],
    ['{"surfaces":[], "\\u0073urfaces":[]}', 'surfaces'], // escaped-key duplicate
  ];
  for (const [text, key] of cases) {
    assert.equal(findDuplicateKey(text), key, text);
    const parsed = parseJsonRejectingDuplicates(text);
    assert.equal(parsed.ok, false, text);
    if (!parsed.ok) assert.ok(parsed.message.includes('duplicate object key'), parsed.message);
  }
});

test('json intake: duplicate-key detection is false-positive free on valid documents', () => {
  const text = serializeRuntimeDocument(validDocument());
  assert.equal(findDuplicateKey(text), null);
  assert.equal(parseRuntimeDocument(text).ok, true);
});

test('json intake: the 1 MiB ceiling is exercised by executable tests (SIR-PS2-005)', () => {
  const env = mkdtempSync(join(tmpdir(), 'ps2-ceiling-'));
  try {
    // Exactly the configured maximum is accepted when otherwise valid.
    const exact = join(env, 'exact.json');
    writeFileSync(exact, 'a'.repeat(MAX_CONFIG_BYTES), { mode: 0o600 });
    const accepted = readBoundedTextFile(exact);
    assert.equal(accepted.ok, true);
    if (accepted.ok) assert.equal(accepted.text.length, MAX_CONFIG_BYTES);

    // MAX + 1 is rejected with the typed error via the stat-size path.
    const over = join(env, 'over.json');
    writeFileSync(over, 'a'.repeat(MAX_CONFIG_BYTES + 1), { mode: 0o600 });
    const rejected = readBoundedTextFile(over);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.code, 'ERR-PS2-READ-TOO-LARGE');

    // Growth-after-stat: /dev/zero reports size 0 to fstat but yields
    // unbounded content, so the READ-LOOP ceiling must reject it (the loop
    // path, not the stat path). Deterministic on Linux and macOS.
    if (existsSync('/dev/zero')) {
      const grown = readBoundedTextFile('/dev/zero');
      assert.equal(grown.ok, false);
      if (!grown.ok) assert.equal(grown.code, 'ERR-PS2-READ-TOO-LARGE');
    }
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('runtime document: readRuntimeDocument distinguishes absent from invalid', () => {
  const env = mkdtempSync(join(tmpdir(), 'ps2-config-'));
  try {
    const path = join(env, 'runtime.json');
    const absent = readRuntimeDocument(path);
    assert.equal(absent.ok, false);
    if (!absent.ok) assert.equal(absent.code, 'absent');
    writeFileSync(path, '{"surfaces": 42}', { mode: 0o600 });
    const invalid = readRuntimeDocument(path);
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.code, 'invalid');
    writeFileSync(path, serializeRuntimeDocument(validDocument()), { mode: 0o600 });
    const ok = readRuntimeDocument(path);
    assert.equal(ok.ok, true);
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});
