// A stamp for a tree that has no history to name: a hash of the sources that ship, in the shape
// of a short commit. The container build uses it when the context has neither .git nor a commit
// to pass, as on Cloud Build, which copies the tree without history and passes no build args.
// The same tree always prints the same id, so a deploy can still be matched to what it shipped.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Dependencies and build output are rebuilt from the sources, so they are not part of the id.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist']);

function collect(dir: string, root: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collect(full, root, files);
    } else if (entry.isFile()) {
      files.push(path.relative(root, full));
    }
  }
}

// Paths go into the hash as well as contents: a rename changes what the deploy shipped, so it
// changes the id. Sorting keeps a directory listing order from leaking into the result.
export function treeStamp(root: string = process.cwd()): string {
  const files: string[] = [];
  collect(root, root, files);
  files.sort();

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 7);
}
