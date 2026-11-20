import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { treeStamp } from '../lib/treeStamp.ts';

function makeTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-tree-'));
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return dir;
}

test('the same tree always stamps the same short id', () => {
  const dir = makeTree({ 'src/App.tsx': 'app', 'README.md': 'hi' });
  try {
    const stamp = treeStamp(dir);
    assert.match(stamp, /^[0-9a-f]{7}$/);
    assert.equal(treeStamp(dir), stamp);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a changed source changes the stamp', () => {
  const dir = makeTree({ 'src/App.tsx': 'app' });
  try {
    const before = treeStamp(dir);
    fs.writeFileSync(path.join(dir, 'src/App.tsx'), 'app changed');
    assert.notEqual(treeStamp(dir), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a renamed source changes the stamp', () => {
  const dir = makeTree({ 'src/a.ts': 'same' });
  try {
    const before = treeStamp(dir);
    fs.renameSync(path.join(dir, 'src/a.ts'), path.join(dir, 'src/b.ts'));
    assert.notEqual(treeStamp(dir), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dependencies and build output are not part of the stamp', () => {
  const dir = makeTree({ 'src/App.tsx': 'app' });
  try {
    const before = treeStamp(dir);
    for (const name of ['node_modules/left-pad/index.js', 'dist/assets/app.js', '.git/HEAD']) {
      const file = path.join(dir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'generated');
    }
    assert.equal(treeStamp(dir), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
