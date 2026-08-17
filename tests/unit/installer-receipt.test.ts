/**
 * PS-3 focused tests: receipt model — closed fields, deterministic
 * serialization, atomic/concurrency-safe mutation, truthful COMPLETE vs
 * PARTIAL, no authority/secrets serialized.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newReceipt, readReceipt, serializeReceipt, validateReceipt, writeReceipt } from '../../src/installer/receipt.js';
import type { InstallReceipt } from '../../src/installer/receipt.js';

const SHA = 'a'.repeat(64);

function sampleReceipt(overrides: Record<string, unknown> = {}): InstallReceipt {
  const base = newReceipt({
    platformLane: 'linux-x86_64-posix-utf8-node22',
    result: 'COMPLETE',
    installDir: '/home/op/.local/share/pi-shuttle',
    binDir: '/home/op/.local/bin',
    gateway: {
      status: 'installed-verified',
      version: '0.1.0',
      commit: '7f3b4afdb43704e7dac82da7b086d8367347c641',
      commitVerified: false,
      digestVerified: false,
      artifactSha256: SHA,
      installPath: '/home/op/.local/share/pi-shuttle/packages/project-gateway-artifact-core@0.1.0',
      binPath: '/home/op/.local/share/pi-shuttle/packages/project-gateway-artifact-core@0.1.0/dist/cli.js',
      smoke: 'passed',
    },
    piGuard: null,
    omitted: ['pi-guard'],
    notes: [],
  });
  return { ...base, ...overrides } as unknown as InstallReceipt;
}

function makeEnv(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ps3-receipt-'));
  chmodSync(dir, 0o700);
  return dir;
}

test('receipt: closed-field validation rejects unknown fields and wrong types', () => {
  const valid = sampleReceipt();
  assert.equal(validateReceipt(JSON.parse(serializeReceipt(valid))).ok, true);
  const cases: Array<[string, unknown]> = [
    ['unknown top-level field', { ...JSON.parse(serializeReceipt(valid)), extra: 1 }],
    ['unknown component field', { ...JSON.parse(serializeReceipt(valid)), components: { gateway: { ...JSON.parse(serializeReceipt(valid)).components.gateway, extra: 1 }, piGuard: null } }],
    ['wrong result value', { ...JSON.parse(serializeReceipt(valid)), result: 'SUCCESS' }],
    ['wrong receiptVersion', { ...JSON.parse(serializeReceipt(valid)), receiptVersion: 2 }],
    ['relative installDir', { ...JSON.parse(serializeReceipt(valid)), installDir: 'relative' }],
    ['bad digest', { ...JSON.parse(serializeReceipt(valid)), components: { ...JSON.parse(serializeReceipt(valid)).components, gateway: { ...JSON.parse(serializeReceipt(valid)).components.gateway, artifactSha256: 'not-hex' } } }],
    ['missing digestVerified', { ...JSON.parse(serializeReceipt(valid)), components: { ...JSON.parse(serializeReceipt(valid)).components, gateway: (() => { const g = { ...JSON.parse(serializeReceipt(valid)).components.gateway }; delete g.digestVerified; return g; })() } }],
    ['wrong digestVerified type', { ...JSON.parse(serializeReceipt(valid)), components: { ...JSON.parse(serializeReceipt(valid)).components, gateway: { ...JSON.parse(serializeReceipt(valid)).components.gateway, digestVerified: 'yes' } } }],
    ['non-array omitted', { ...JSON.parse(serializeReceipt(valid)), omitted: 'x' }],
  ];
  for (const [name, doc] of cases) {
    const result = validateReceipt(doc);
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.equal(result.code, 'ERR-PS3-RECEIPT-INVALID', name);
  }
});

test('receipt: deterministic serialization (parse→serialize is byte-stable)', () => {
  const receipt = sampleReceipt();
  const text = serializeReceipt(receipt);
  const parsed = JSON.parse(text) as unknown;
  const validated = validateReceipt(parsed);
  assert.equal(validated.ok, true);
  if (validated.ok) assert.equal(serializeReceipt(validated.receipt), text, 'serialization must be byte-stable');
  assert.ok(text.endsWith('\n'));
});

test('receipt: exact pi-shuttle package path and tree digest are paired while historical Stable shape remains valid', () => {
  const historical = sampleReceipt();
  assert.equal(validateReceipt(JSON.parse(serializeReceipt(historical))).ok, true);
  const bound = sampleReceipt({
    channel: 'latest',
    sourceIdentity: `mfx-labs/pi-shuttle@${'b'.repeat(40)}`,
    piShuttleInstallPath: `/home/op/.local/share/pi-shuttle/packages/pi-shuttle@0.1.1+latest.${'b'.repeat(40)}`,
    piShuttleTreeSha256: 'c'.repeat(64),
  });
  assert.equal(validateReceipt(JSON.parse(serializeReceipt(bound))).ok, true);
  assert.equal(validateReceipt({ ...JSON.parse(serializeReceipt(bound)), piShuttleTreeSha256: undefined }).ok, false);
});

test('receipt: never serializes authority/secrets vocabulary', () => {
  const text = serializeReceipt(sampleReceipt());
  for (const forbidden of ['provenance', 'grant', 'secret', 'credential', 'token']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.ok(text.includes('"receiptVersion"'), 'structural version field is the closed versioning mechanism');
});

test('receipt: atomic 0600 write through the single transactional writer', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'deep', 'state', 'install.json');
    const result = writeReceipt(path, sampleReceipt());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const read = readReceipt(path);
    assert.equal(read.ok, true);
    if (read.ok) assert.equal(read.receipt.result, 'COMPLETE');
    // Re-write identical content: idempotent no-op.
    const again = writeReceipt(path, sampleReceipt());
    assert.equal(again.ok, true);
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('receipt: foreign existing receipt fails closed and is preserved', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'install.json');
    writeFileSync(path, '{"foreign": true}', { mode: 0o600 });
    const result = writeReceipt(path, sampleReceipt());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'ERR-PS2-CONFIG-INCOMPATIBLE');
    assert.equal(readFileSync(path, 'utf8'), '{"foreign": true}', 'foreign receipt must never be overwritten');
    const read = readReceipt(path);
    assert.equal(read.ok, false);
    if (!read.ok) assert.equal(read.code, 'invalid');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('receipt: absent receipt reads as absent; PARTIAL receipts round-trip', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'install.json');
    const absent = readReceipt(path);
    assert.equal(absent.ok, false);
    if (!absent.ok) assert.equal(absent.code, 'absent');
    const partial = sampleReceipt({ result: 'PARTIAL', omitted: ['project-gateway-mcp', 'pi-guard'], piGuard: null, gateway: null });
    const written = writeReceipt(path, partial);
    assert.equal(written.ok, true);
    const read = readReceipt(path);
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.receipt.result, 'PARTIAL');
      assert.deepEqual(read.receipt.omitted, ['project-gateway-mcp', 'pi-guard']);
    }
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('receipt: recovered state keeps unknown original facts separate from recovery provenance', () => {
  const recovered = newReceipt({
    platformLane: 'linux-x86_64-posix-utf8-node22',
    result: 'COMPLETE',
    installDir: '/home/op/.local/share/pi-shuttle',
    binDir: '/home/op/.local/bin',
    gateway: null,
    piGuard: null,
    omitted: [],
    notes: ['recovered'],
    recovery: {
      recoveredAt: '2026-08-17T00:00:00.000Z',
      recoveredBy: `mfx-labs/pi-shuttle@${'b'.repeat(40)}`,
      originalInstalledAt: null,
      originalChannel: 'unknown',
    },
  });
  assert.equal(recovered.installedAt, undefined);
  assert.equal(recovered.channel, undefined);
  const serialized = serializeReceipt(recovered);
  assert.equal(validateReceipt(JSON.parse(serialized)).ok, true);
  assert.match(serialized, /"recoveredAt"/);
  assert.doesNotMatch(serialized, /"installedAt"/);

  const ordinaryWithoutTime = JSON.parse(serializeReceipt(sampleReceipt())) as Record<string, unknown>;
  delete ordinaryWithoutTime.installedAt;
  assert.equal(validateReceipt(ordinaryWithoutTime).ok, false);
  const fabricated = { ...JSON.parse(serialized), installedAt: '2026-08-17T00:00:00.000Z' };
  assert.equal(validateReceipt(fabricated).ok, false);
});
