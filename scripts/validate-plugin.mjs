#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginRoot = resolve(process.argv[2] || join(repositoryRoot, "plugin"));
const manifest = JSON.parse(await readFile(join(pluginRoot, "manifest.json"), "utf8"));

function fail(message) {
  throw new Error(`Invalid Omarchy plugin: ${message}`);
}

if (manifest.schemaVersion !== 1) fail("schemaVersion must be 1.");
if (typeof manifest.id !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u.test(manifest.id)) fail("id must be a reverse-DNS-style identifier.");
if (typeof manifest.name !== "string" || !manifest.name.trim()) fail("name is required.");
if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(manifest.version)) fail("version must be semantic.");
if (!Array.isArray(manifest.kinds) || manifest.kinds.length === 0) fail("kinds must be non-empty.");
if (manifest.entryPoints === null || typeof manifest.entryPoints !== "object") fail("entryPoints are required.");

const entryForKind = { service: "service", panel: "panel", "bar-widget": "barWidget" };
for (const kind of manifest.kinds) {
  const key = entryForKind[kind];
  if (!key) fail(`unsupported kind ${kind}.`);
  const entry = manifest.entryPoints[key];
  if (typeof entry !== "string" || !entry) fail(`entryPoints.${key} is required.`);
  const target = normalize(resolve(pluginRoot, entry));
  if (relative(pluginRoot, target).startsWith("..")) fail(`entryPoints.${key} escapes the plugin root.`);
  await access(target);
}

process.stdout.write(`Validated ${manifest.id} ${manifest.version}.\n`);
