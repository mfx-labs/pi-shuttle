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
import { parseInstallerArgs, promptSelections } from '../../src/installer/selection.js';
import type { PromptUI } from '../../src/installer/selection.js';

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
  const ui = uiWith(['yes', 'yes', 'y', '/abs/share', 'rel', '', 'no']);
  const result = await promptSelections(ui, { installDir: '/default/share', binDir: '/default/bin' });
  assert.deepEqual(result.selections, { gateway: true, piGuard: true });
  assert.equal(result.installDir, '/abs/share', 'invalid y must never become the installation directory');
  assert.equal(result.binDir, '/default/bin', 'invalid rel must never become the bin directory');
  assert.equal(result.configureProject, false);
  const installAsks = ui.asked.filter((q) => q.startsWith('Installation directory'));
  const binAsks = ui.asked.filter((q) => q.startsWith('Command/bin directory'));
  assert.equal(installAsks.length, 2, 'invalid installation directory must reprompt');
  assert.equal(binAsks.length, 2, 'invalid bin directory must reprompt');
});

test('selection: interactive empty input selects the existing absolute defaults', async () => {
  const ui = uiWith(['', '', '', '', '']);
  const result = await promptSelections(ui, { installDir: '/default/share', binDir: '/default/bin' });
  assert.equal(result.installDir, '/default/share');
  assert.equal(result.binDir, '/default/bin');
  assert.equal(result.configureProject, false);
});

test('selection: interactive ~-prefixed and ./ input is rejected like any relative path', async () => {
  const ui = uiWith(['yes', 'yes', '~/home/share', './share', '/abs/share', '~/home/bin', '', 'no']);
  const result = await promptSelections(ui, { installDir: '/default/share', binDir: '/default/bin' });
  assert.equal(result.installDir, '/abs/share');
  assert.equal(result.binDir, '/default/bin');
  assert.equal(ui.asked.filter((q) => q.startsWith('Installation directory')).length, 3);
  assert.equal(ui.asked.filter((q) => q.startsWith('Command/bin directory')).length, 2);
});
