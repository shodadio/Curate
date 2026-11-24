// Prints the source-snapshot id the container build uses when it has neither a Git commit nor
// an explicit build id. This is a source identity, not a Git commit SHA. Reads the tree it is run
// from, or the directory given as its first argument.
import { treeStamp } from '../lib/treeStamp.ts';

const root = process.argv[2] || process.cwd();
console.log(treeStamp(root));
