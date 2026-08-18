/**
 * PS-3 focused tests: installer selection — absolute-path enforcement for
 * --install-dir/--bin-dir at the argument boundary, and the interactive
 * prompt session (invalid directory input is rejected with guidance and
 * reprompts instead of advancing; empty input selects the existing
 * absolute default). Regression for the macOS Intel defect where the
 * interactive prompt accepted `y` as the Installation directory and the
 * installer finalized a receipt its own validation rejected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseInstallerArgs, promptSelections } from '../../src/installer/selection.js';
import type { PromptUI } from '../../src/installer/selection.js';
import { REPO } from '../helpers/installer-fixtures.js';

/** Scripted PromptUI: consumes one answer per ask, defaulting on empty (like the readline seam). */
function uiWith(answers: readonly string[]): PromptUI & { readonly asked: string[] } {
  const asked: string[] = [];
  let i = 0;
  return {
    asked,
    ask: async (question: string, defaultValue?: string) => {
      asked.push(question);
      const answer = answers[i] ?? '';
      i += 1;
      return answer.length > 0 ? answer : (defaultValue ?? '');
    },
  };
}

const BATCH = ['--batch', '--gateway', 'yes', '--pi-guard', 'yes'] as const;
const SOURCE_A = `mfx-labs/pi-shuttle@${'a'.repeat(40)}`;
const SOURCE_B = `mfx-labs/pi-shuttle@${'b'.repeat(40)}`;

function runUpgradeConsent(name: 'promptUpgrade' | 'approveBatchUpgrade', input = '', args: readonly unknown[] = ['0.1.0', '0.1.1']): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const moduleUrl = pathToFileURL(join(REPO, 'dist', 'installer', 'selection.js')).href;
  const script = `import { ${name} } from ${JSON.stringify(moduleUrl)}; const decision = await ${name}(...${JSON.stringify(args)}); process.stdout.write('\\nDECISION=' + decision + '\\n');`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString('utf8'); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('selection: --install-dir / --bin-dir reject relative and ~-prefixed values at the argument boundary', () => {
  for (const flag of ['--install-dir', '--bin-dir'] as const) {
    for (const bad of ['y', 'foo/bar', './foo', '~/.local/share/pi-shuttle', '~/x']) {
      const result = parseInstallerArgs([...BATCH, flag, bad]);
      assert.equal(result.ok, false, `${flag} ${bad} must be rejected`);
      if (!result.ok) {
        assert.match(result.message, /must be an absolute path/, `${flag} ${bad}: operator-facing guidance required`);
        assert.ok(result.message.includes(bad), `${flag} ${bad}: message must name the rejected value`);
        assert.match(result.message, /not expanded|~/i, `${flag} ~/: tilde must not be silently accepted`);
      }
    }
  }
  // --artifact-dir is the local lane directory, not persisted in the
  // receipt: existing semantics unchanged.
  const artifact = parseInstallerArgs([...BATCH, '--artifact-dir', 'relative']);
  assert.equal(artifact.ok, true);
  if (artifact.ok) assert.equal(artifact.options.artifactDir, 'relative');
});

test('selection: absolute --install-dir / --bin-dir values are accepted and forwarded', () => {
  const result = parseInstallerArgs([...BATCH, '--install-dir', '/tmp/share', '--bin-dir', '/tmp/bin']);
  assert.equal(result.ok, true, 'absolute paths must parse');
  if (result.ok) {
    assert.equal(result.options.installDir, '/tmp/share');
    assert.equal(result.options.binDir, '/tmp/bin');
    assert.equal(result.options.batch, true);
    assert.deepEqual(result.options.selections, { gateway: true, piGuard: true });
  }
  const missing = parseInstallerArgs(['--install-dir']);
  assert.equal(missing.ok, false);
});

test('selection: interactive invalid directory input reprompts and never advances', async () => {
  // 'y' for Installation directory → rejected, reprompted; '/abs/share'
  // accepted. 'rel' for Command/bin directory → rejected, reprompted;
  // empty → existing absolute default.
  const ui = uiWith(['yes', 'yes', 'y', '/abs/share', 'rel', '']);
  const result = await promptSelections(ui, { installDir: '/default/share', binDir: '/default/bin' });
  assert.deepEqual(result.selections, { gateway: true, piGuard: true });
  assert.equal(result.installDir, '/abs/share', 'invalid y must never become the installation directory');
  assert.equal(result.binDir, '/default/bin', 'invalid rel must never become the bin directory');
  assert.equal(ui.asked.some((q) => q.includes('Configure a project now?')), false);
  const installAsks = ui.asked.filter((q) => q.startsWith('Installation directory'));
  const binAsks = ui.asked.filter((q) => q.startsWith('Command/bin directory'));
  assert.equal(installAsks.length, 2, 'invalid installation directory must reprompt');
  assert.equal(binAsks.length, 2, 'invalid bin directory must reprompt');
});

test('selection: interactive empty input selects the existing absolute defaults', async () => {
  const ui = uiWith(['', '', '', '']);
  const result = await promptSelections(ui, { installDir: '/default/share', binDir: '/default/bin' });
  assert.equal(result.installDir, '/default/share');
  assert.equal(result.binDir, '/default/bin');
  assert.equal(ui.asked.some((q) => q.includes('Configure a project now?')), false);
});

test('selection: interactive ~-prefixed and ./ input is rejected like any relative path', async () => {
  const ui = uiWith(['yes', 'yes', '~/home/share', './share', '/abs/share', '~/home/bin', '']);
  const result = await promptSelections(ui, { installDir: '/default/share', binDir: '/default/bin' });
  assert.equal(result.installDir, '/abs/share');
  assert.equal(result.binDir, '/default/bin');
  assert.equal(ui.asked.filter((q) => q.startsWith('Installation directory')).length, 3);
  assert.equal(ui.asked.filter((q) => q.startsWith('Command/bin directory')).length, 2);
});

test('selection: semantic-version promptUpgrade supports default/yes/no and reprompts invalid input', async () => {
  for (const [input, expected] of [['\n', true], ['yes\n', true], ['n\n', false]] as const) {
    const run = await runUpgradeConsent('promptUpgrade', input);
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /Existing pi-shuttle installation detected:/);
    assert.match(run.stdout, /Installed: 0\.1\.0/);
    assert.match(run.stdout, /Installer: 0\.1\.1/);
    assert.match(run.stdout, /Upgrade 0\.1\.0 → 0\.1\.1\? \[Y\/n\]:/);
    assert.ok(run.stdout.includes(`DECISION=${expected}`), run.stdout);
  }

  const invalid = await runUpgradeConsent('promptUpgrade', 'maybe\ny\n');
  assert.equal(invalid.code, 0, invalid.stdout + invalid.stderr);
  assert.equal(invalid.stdout.split('Upgrade 0.1.0 → 0.1.1? [Y/n]:').length - 1, 2, 'invalid input must repeat the upgrade prompt');
  assert.match(invalid.stderr, /please answer yes or no/);
  assert.match(invalid.stdout, /DECISION=true/);
});

test('selection: source transitions use source-aware consent wording', async () => {
  const latest = await runUpgradeConsent('promptUpgrade', '\n', ['0.1.1', '0.1.1', {
    kind: 'latest-source', installedSource: SOURCE_A, latestSource: SOURCE_B,
  }]);
  assert.equal(latest.code, 0, latest.stdout + latest.stderr);
  assert.match(latest.stdout, /Existing pi-shuttle Latest installation detected:/);
  assert.ok(latest.stdout.includes(`Installed source: ${SOURCE_A}`), latest.stdout);
  assert.ok(latest.stdout.includes(`Latest source:    ${SOURCE_B}`), latest.stdout);
  assert.match(latest.stdout, /Update to the new Latest source\? \[Y\/n\]:/);
  assert.doesNotMatch(latest.stdout, /Upgrade 0\.1\.1 → 0\.1\.1/);
  assert.match(latest.stdout, /DECISION=true/);

  const stable = await runUpgradeConsent('promptUpgrade', '\n', ['0.1.1', '0.1.1', {
    kind: 'stable-to-latest', latestSource: SOURCE_B,
  }]);
  assert.equal(stable.code, 0, stable.stdout + stable.stderr);
  assert.match(stable.stdout, /Existing pi-shuttle Stable installation detected:/);
  assert.match(stable.stdout, /Installed channel: stable/);
  assert.match(stable.stdout, /Target channel:    latest/);
  assert.ok(stable.stdout.includes(`Latest source:     ${SOURCE_B}`), stable.stdout);
  assert.match(stable.stdout, /Switch from Stable 0\.1\.1 to Latest 0\.1\.1\? \[Y\/n\]:/);
  assert.doesNotMatch(stable.stdout, /Upgrade 0\.1\.1 → 0\.1\.1/);
  assert.match(stable.stdout, /DECISION=true/);
});

test('selection: production approveBatchUpgrade emits the upgrade notice and accepts', async () => {
  const run = await runUpgradeConsent('approveBatchUpgrade');
  assert.equal(run.code, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /Existing pi-shuttle installation detected:/);
  assert.match(run.stdout, /Installed: 0\.1\.0/);
  assert.match(run.stdout, /Installer: 0\.1\.1/);
  assert.match(run.stdout, /Upgrade accepted by explicit batch invocation/);
  assert.match(run.stdout, /DECISION=true/);
  assert.equal(run.stderr, '');
});
