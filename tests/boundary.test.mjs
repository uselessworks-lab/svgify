import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import ts from 'typescript';
test('core is dependency-free and contains no Node, DOM, app or framework imports',async()=>{
  const pkg=JSON.parse(await readFile('package.json','utf8'));
  assert.equal(pkg.dependencies,undefined);
  for(const file of await readdir('package')) {
    if (!file.endsWith('.ts')) continue;
    const source=await readFile(`package/${file}`,'utf8');
    assert.doesNotMatch(source,/from\s+['"](?:node:|.*app\/|react|sharp|vite)/);
    const syntax=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
    const hostGlobals=new Set(['window','document','process','Buffer','HTMLElement','HTMLCanvasElement']);
    const check=node=>{
      if(ts.isIdentifier(node)) assert.ok(!hostGlobals.has(node.text),`${file}: host identifier ${node.text}`);
      ts.forEachChild(node,check);
    };
    check(syntax);
  }
});
