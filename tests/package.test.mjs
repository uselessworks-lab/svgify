import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

test('repository root is installable as the core package from Git', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'));
  const core = JSON.parse(await readFile('package/core/package.json', 'utf8'));
  assert.equal(root.name, '@uselessworks/svgify');
  assert.equal(root.private, true, 'root must remain protected from accidental npm publication');
  assert.equal(root.license, 'MPL-2.0');
  assert.equal(core.license, 'MPL-2.0');
  assert.equal(root.repository.url, 'git+https://github.com/uselessworks-lab/svgify.git');
  assert.equal(root.exports['.'].import, './package/core/dist/index.js');
  assert.equal(root.exports['.'].types, './package/core/dist/index.d.ts');
  assert.match(root.scripts.prepare, /build:core/);
  assert.equal(root.dependencies, undefined, 'the Git-installed library must have no runtime dependencies');
  await access('package/core/dist/index.js');
  await access('package/core/dist/index.d.ts');
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /npm install git\+https:\/\/github\.com\/uselessworks-lab\/svgify\.git/);
});
