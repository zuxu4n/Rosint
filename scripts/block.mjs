#!/usr/bin/env node
// Adds usernames to the removal blocklist in src/App.jsx.
//
// Hashes each name the same way the app does (SHA-256 of the normalized,
// lowercased form) and inserts it into BLOCKED_HASHES, skipping any that are
// already there. Accepts pasted forms like u/name, /u/name, @name, or a full
// reddit.com/user/name URL.
//
// Usage:
//   node scripts/block.mjs <username> [more usernames...]
//   node scripts/block.mjs --dry-run <username> [...]
//
// Examples:
//   node scripts/block.mjs example_user
//   node scripts/block.mjs u/example_user Another_Example https://reddit.com/user/third_example
//   node scripts/block.mjs --dry-run example_user

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { normalizeUsername } from "../src/normalizeUsername.js";

const APP_PATH = new URL("../src/App.jsx", import.meta.url);
const MARKER = "const BLOCKED_HASHES = [";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const names = args.filter((a) => a !== "--dry-run");

if (names.length === 0) {
    console.error("Usage: node scripts/block.mjs [--dry-run] <username> [more usernames...]");
    process.exit(1);
}

const hashOf = (name) =>
    createHash("sha256").update(normalizeUsername(name).toLowerCase()).digest("hex");

const src = await readFile(APP_PATH, "utf8");

const start = src.indexOf(MARKER);
const end = src.indexOf("];", start);
if (start === -1 || end === -1) {
    console.error(`Could not find "${MARKER} ... ];" in src/App.jsx — did the file change?`);
    process.exit(1);
}

const existing = src.slice(start + MARKER.length, end).match(/[a-f0-9]{64}/g) || [];
const known = new Set(existing);

const added = [];
const skipped = [];
const invalid = [];

for (const raw of names) {
    const clean = normalizeUsername(raw).toLowerCase();
    if (!clean) {
        invalid.push(raw);
        continue;
    }
    const hash = hashOf(raw);
    if (known.has(hash)) {
        skipped.push(clean);
        continue;
    }
    known.add(hash);
    added.push({ name: clean, hash });
}

for (const name of invalid) console.log(`  invalid, skipped:  ${name}`);
for (const name of skipped) console.log(`  already blocked:   ${name}`);
for (const { name, hash } of added) console.log(`  added:             ${name}  ->  ${hash.slice(0, 12)}…`);

if (added.length === 0) {
    console.log("\nNothing to add.");
    process.exit(0);
}

const all = [...existing, ...added.map((a) => a.hash)];
const body = "\n" + all.map((h) => `    "${h}"`).join(",\n") + "\n";
const out = src.slice(0, start + MARKER.length) + body + src.slice(end);

if (dryRun) {
    console.log(`\nDry run — no changes written. Would add ${added.length}, total ${all.length}.`);
    process.exit(0);
}

await writeFile(APP_PATH, out);

console.log(`\nAdded ${added.length} to the blocklist (${all.length} total).`);
console.log("Next: commit + push to deploy, then send replies with");
for (const { name } of added) console.log(`  node scripts/removal-reply.mjs ${name}`);
