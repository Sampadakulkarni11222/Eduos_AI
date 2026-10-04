#!/usr/bin/env node
/**
 * `npm audit --audit-level=high`, with a reviewed allowlist.
 *
 * Fails when any high or critical advisory affects the installed tree, except
 * advisories listed in .github/audit-allowlist.json. Every allowed advisory is
 * printed, so an exception is always visible in the log, and an entry past its
 * `reviewBy` date is reported as a warning. No dependencies: it reads
 * `npm audit --json` from the package in the current directory.
 *
 * Usage (from a package directory):  node ../.github/scripts/audit-check.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FAILING = new Set(['high', 'critical']);
const here = dirname(fileURLToPath(import.meta.url));
const allowlist = JSON.parse(readFileSync(join(here, '..', 'audit-allowlist.json'), 'utf8')).advisories ?? [];
const allowed = new Map(allowlist.map((a) => [a.id, a]));

let report;
try {
  // A fixed command string: nothing is interpolated into it.
  report = JSON.parse(execSync('npm audit --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
} catch (err) {
  // npm audit exits non-zero when it finds anything; its JSON is still on stdout.
  if (!err.stdout) throw err;
  report = JSON.parse(err.stdout);
}

// The root advisories: `via` entries that are objects. A string `via` only
// points at another vulnerable package, whose own entry carries the advisory.
const advisories = new Map();
for (const [pkg, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== 'object' || !via) continue;
    const id = /GHSA-[\w-]+/.exec(via.url ?? '')?.[0] ?? String(via.source);
    const entry = advisories.get(id) ?? { id, severity: via.severity, title: via.title, url: via.url, packages: new Set() };
    entry.packages.add(pkg);
    advisories.set(id, entry);
  }
}

const today = new Date().toISOString().slice(0, 10);
const blocking = [];
for (const a of advisories.values()) {
  if (!FAILING.has(a.severity)) continue;
  const exception = allowed.get(a.id);
  if (exception) {
    console.log(`ALLOWED  ${a.severity.padEnd(8)} ${a.id} (${[...a.packages].join(', ')}): ${exception.reason}`);
    if (exception.reviewBy && exception.reviewBy < today) {
      console.log(`::warning::${a.id} was due for review on ${exception.reviewBy}; check whether a fix has shipped.`);
    }
    continue;
  }
  blocking.push(a);
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log(`npm audit: ${JSON.stringify(counts)}`);
if (blocking.length) {
  for (const a of blocking) {
    console.log(`::error::${a.severity} ${a.id} in ${[...a.packages].join(', ')}: ${a.title} ${a.url ?? ''}`);
  }
  process.exit(1);
}
console.log('No high or critical advisories outside the allowlist.');
