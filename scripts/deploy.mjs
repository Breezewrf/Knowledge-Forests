import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const vault = process.env.KNOWLEDGE_FORESTS_VAULT;
if (!vault) throw new Error("Set KNOWLEDGE_FORESTS_VAULT to the Obsidian vault path.");

const destination = path.join(vault, ".obsidian", "plugins", "knowledge-forests");
await mkdir(destination, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(new URL(`../${file}`, import.meta.url), path.join(destination, file));
}
console.log(`Deployed Knowledge Forests to ${destination}`);
