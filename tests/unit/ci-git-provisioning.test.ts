/**
 * PS-6 Git 2.45.4 provisioning static checks (SIR-PS6-003 correction).
 * The product requirement stays exact; the CI provisioning must be:
 * one digest-pinned kernel.org source artifact, digest verified BEFORE
 * extraction/build, user-scope build (no sudo, no system replacement),
 * and an exact built-version assertion. These checks pin those facts so
 * a future relaxation fails the suite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const SCRIPT = join(REPO, 'scripts', 'ci-provision-git-2454.sh');
const SHA_RE = /^[0-9a-f]{64}$/;

// The reviewed digest of the exact kernel.org git-2.45.4.tar.gz source
// (cross-checked against the www.kernel.org mirror during the PS-6
// focused correction gate).
const REVIEWED_DIGEST = '896c6640ee56adc7f83a78b122d129231ca8ce7fd582f606d282a7114eb0b4ab';

test('git provisioning: the script pins the exact reviewed kernel.org source digest', () => {
  assert.equal(existsSync(SCRIPT), true, 'ci-provision-git-2454.sh must exist');
  const text = readFileSync(SCRIPT, 'utf8');
  assert.ok(text.includes('GIT_VERSION="2.45.4"'), 'exact version stays 2.45.4');
  assert.match(text.match(/GIT_TGZ_SHA256="([0-9a-f]+)"/)?.[1] ?? '', SHA_RE, 'digest must be a full SHA-256');
  assert.ok(text.includes(`GIT_TGZ_SHA256="${REVIEWED_DIGEST}"`), 'digest must equal the reviewed kernel.org value');
  assert.ok(text.includes('mirrors.edge.kernel.org/pub/software/scm/git/git-2.45.4.tar.gz'), 'kernel.org authoritative source');
  const codeLines = text.split('\n').filter((l) => !l.trimStart().startsWith('#'));
  assert.ok(!codeLines.some((l) => l.includes('sudo')), 'no sudo in executable lines (comments excluded)');
  assert.ok(text.includes('shasum -a 256 -c'), 'digest verified before extraction/build');
  const verifyLine = text.split('\n').find((l) => l.includes('shasum -a 256 -c'));
  const extractLine = text.split('\n').find((l) => l.includes('tar -xzf'));
  assert.ok(verifyLine !== undefined && extractLine !== undefined && text.indexOf(verifyLine) < text.indexOf(extractLine), 'verification must precede extraction');
  assert.ok(text.includes('test "$BUILT_VERSION" = "git version $GIT_VERSION"'), 'exact built-version assertion (fail closed)');
  assert.ok(text.includes('make -C "$SRC_DIR" prefix="$PREFIX_DIR"'), 'user-scope prefix build (no system Git replacement)');
});

test('git provisioning: the workflows use the digest-pinned script and never a floating git tag URL', () => {
  const workflowDir = join(REPO, '.github', 'workflows');
  const workflows = readdirSync(workflowDir).filter((n) => n.endsWith('.yml'));
  for (const name of workflows) {
    const text = readFileSync(join(workflowDir, name), 'utf8');
    if (text.includes('git-2.45.4') || name.includes('lane-b')) {
      assert.ok(text.includes('ci-provision-git-2454.sh'), `${name}: must use the digest-pinned provisioning script`);
    }
    assert.ok(!text.includes('github.com/git/git/archive'), `${name}: no floating tag tarball URL`);
  }
});
