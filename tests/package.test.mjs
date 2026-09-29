import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('repository root is installable as the core package from Git', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(root.name, '@uselessworks/svgify');
  assert.equal(root.private, true, 'root must remain protected from accidental npm publication');
  assert.equal(root.license, 'MIT');
  assert.equal(root.repository.url, 'git+https://github.com/uselessworks-lab/svgify.git');
  assert.equal(root.exports['.'].import, './dist/index.js');
  assert.equal(root.exports['.'].types, './dist/index.d.ts');
  assert.match(root.scripts.prepare, /build:core/);
  assert.equal(root.dependencies, undefined, 'the Git-installed library must have no runtime dependencies');
  await access('dist/index.js');
  await access('dist/index.d.ts');
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /npm install git\+https:\/\/github\.com\/uselessworks-lab\/svgify\.git/);
  const dir = await mkdtemp(join(tmpdir(), 'svgify-package-'));
  try {
    const [archive] = JSON.parse(execFileSync('npm', [
      'pack', '--workspaces=false', '--pack-destination', dir, '--cache', join(dir, 'cache'), '--json',
    ], { encoding: 'utf8' }));
    const paths = archive.files.map(file => file.path);
    assert.ok(paths.includes('dist/index.js'));
    assert.ok(paths.includes('dist/index.d.ts'));
    assert.ok(paths.includes('package/index.ts'));
    assert.ok(!paths.some(path => path.startsWith('app/') || path.startsWith('tests/')));
    await writeFile(join(dir, 'package.json'), '{"private":true,"type":"module"}');
    execFileSync('npm', [
      'install', '--prefix', dir, '--cache', join(dir, 'cache'), '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      join(dir, archive.filename),
    ]);
    execFileSync(process.execPath, ['--input-type=module', '-e',
      "import { convertImage } from '@uselessworks/svgify'; if (typeof convertImage !== 'function') throw Error('Missing export');",
    ], { cwd: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
