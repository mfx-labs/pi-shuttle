/**
 * PS-2 focused tests: doctor skeleton — the closed status vocabulary, the
 * deterministic report renderer, and the skeleton's honest local
 * observations (no subprocess probes, no fabricated verdicts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatDoctorReport, runDoctorSkeleton, STATUS_VOCABULARY, type DoctorCheck } from '../../src/command/doctor.js';
import { resolveLayout } from '../../src/host/environment.js';
import { serializeRuntimeDocument } from '../../src/config/document.js';
import type { SurfaceConfig } from '../../src/config/document.js';

test('doctor: the status vocabulary is exactly the closed contract set', () => {
  assert.deepEqual([...STATUS_VOCABULARY], ['supported', 'unsupported', 'installed but unverified', 'missing', 'partial installation']);
});

test('doctor: every status vocabulary value renders exactly on synthetic states', () => {
  const checks: DoctorCheck[] = STATUS_VOCABULARY.map((verdict, i) => ({
    id: `check-${i}`,
    label: `synthetic-${i}`,
    verdict,
    detail: 'synthetic state',
  }));
  const rendered = formatDoctorReport({ checks, notes: [] });
  for (const verdict of STATUS_VOCABULARY) {
    assert.ok(rendered.includes(`: ${verdict} —`), `rendered output must contain the exact vocabulary value: ${verdict}`);
  }
  assert.ok(rendered.startsWith('pi-shuttle doctor\n'));
});

test('doctor: linux x64 skeleton reports supported platform; missing config is a finding (exit 1)', () => {
  const env = mkdtempSync(join(tmpdir(), 'ps2-doctor-'));
  try {
    const result = runDoctorSkeleton({ home: env, platform: 'linux', arch: 'x64' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // SIR-PS2-003: `missing` is a finding-class verdict → exit 1.
    assert.equal(result.exitCode, 1);
    const report = formatDoctorReport(result.report);
    assert.ok(report.includes('platform: supported — linux x64'));
    assert.ok(report.includes('runtime configuration: missing'));
    assert.ok(report.includes('deferred to PS-4'), 'deferred probes must be stated, never fabricated');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('doctor: supported platform with valid config exits 0 (all checks pass)', () => {
  const env = mkdtempSync(join(tmpdir(), 'ps2-doctor-'));
  try {
    const layout = resolveLayout(env);
    mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
    writeFileSync(layout.runtimeConfigPath, serializeRuntimeDocument({ surfaces: [] }), { mode: 0o600 });
    const result = runDoctorSkeleton({ home: env, platform: 'linux', arch: 'x64' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 0);
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('doctor: unsupported platform exits 2 (fail closed)', () => {
  const env = mkdtempSync(join(tmpdir(), 'ps2-doctor-'));
  try {
    const win = runDoctorSkeleton({ home: env, platform: 'win32', arch: 'x64' });
    assert.equal(win.ok, true);
    if (win.ok) assert.equal(win.exitCode, 2);
    // macOS arm64 is a gated lane (PS-6 evidence required): not claimed.
    const mac = runDoctorSkeleton({ home: env, platform: 'darwin', arch: 'arm64' });
    assert.equal(mac.ok, true);
    if (mac.ok) {
      assert.equal(mac.exitCode, 2);
      const report = formatDoctorReport(mac.report);
      assert.ok(report.includes('unsupported'), report);
      assert.ok(report.includes('gated: PS-6'), report);
    }
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('doctor: invalid runtime configuration is a finding (exit 1)', () => {
  const env = mkdtempSync(join(tmpdir(), 'ps2-doctor-'));
  try {
    const layout = resolveLayout(env);
    mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
    writeFileSync(layout.runtimeConfigPath, '{"surfaces": 42}', { mode: 0o600 });
    const result = runDoctorSkeleton({ home: env, platform: 'linux', arch: 'x64' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.exitCode, 1);
      assert.ok(result.message.includes('invalid'));
    }
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('doctor: valid runtime configuration is reported with its surface count', () => {
  const env = mkdtempSync(join(tmpdir(), 'ps2-doctor-'));
  try {
    const layout = resolveLayout(env);
    mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
    const surface: SurfaceConfig = {
      surfaceId: 'main',
      locator: join(env, 'store'),
      serviceUid: 1000,
      forbiddenRoots: [],
      configurationIdentity: 'sha-256:' + 'a'.repeat(64),
      configurationVersion: '2',
      limitProfile: {},
    };
    writeFileSync(layout.runtimeConfigPath, serializeRuntimeDocument({ surfaces: [surface] }), { mode: 0o600 });
    const result = runDoctorSkeleton({ home: env, platform: 'linux', arch: 'x64' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 0);
    assert.ok(formatDoctorReport(result.report).includes('runtime configuration: supported —'));
    assert.ok(formatDoctorReport(result.report).includes('1 registered surface'));
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});
