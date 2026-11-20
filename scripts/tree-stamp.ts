// Prints the stamp the container build falls back to when it has neither a commit nor a build
// argument: a short hash of the sources in the tree, in the shape of a short commit. Reads the
// tree it is run from, or the directory given as its first argument.
import { treeStamp } from '../lib/treeStamp.ts';

const root = process.argv[2] || process.cwd();
console.log(treeStamp(root));
