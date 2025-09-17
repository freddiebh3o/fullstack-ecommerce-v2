// print-tree.mjs
// node print-tree.mjs . "node_modules,.git,.next,dist" 10

import fs from "fs";
import path from "path";

const root = process.argv[2] || ".";
const ignore = (process.argv[3] || "node_modules,.git,.next,dist").split(",").map(s => s.trim()).filter(Boolean);
const maxDepth = Number(process.argv[4] || 5);

const isIgnored = (name) => ignore.includes(name);

function list(dir, prefix = "", depth = 0) {
  if (depth >= maxDepth) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => !isIgnored(d.name))
      .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : (a.isDirectory() ? -1 : 1)));
  } catch {
    return;
  }

  entries.forEach((e, idx) => {
    const last = idx === entries.length - 1;
    const conn = last ? "\\---" : "+---";
    console.log(prefix + conn + e.name);
    if (e.isDirectory()) {
      list(path.join(dir, e.name), prefix + (last ? "    " : "|   "), depth + 1);
    }
  });
}

// start
list(path.resolve(root));
