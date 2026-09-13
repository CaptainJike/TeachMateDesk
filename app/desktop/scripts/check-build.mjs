import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const required = [
  path.join(root, "server", "dist", "main.js"),
  path.join(root, "agent-engine", "dist"),
  path.join(root, "web", "dist", "index.html")
];
const missing = required.filter((item) => !fs.existsSync(item));
if (missing.length) {
  console.error("Desktop packaging requires a full build. Missing:");
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}
console.log("Desktop packaging prerequisites are present.");
