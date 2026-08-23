#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryUrl = "https://github.com/DigitalPals/omarchy-t3code";

function fail(message) {
  throw new Error(`Repository validation failed: ${message}`);
}

async function json(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

const [metadata, bridgeMetadata, manifest, lock] = await Promise.all([
  json("package.json"),
  json("bridge/package.json"),
  json("plugin/manifest.json"),
  json("t3-upstream.lock.json"),
]);

if (metadata.version !== bridgeMetadata.version || metadata.version !== manifest.version) {
  fail("package.json, bridge/package.json, and plugin/manifest.json versions must match.");
}
if (manifest.id !== metadata.omarchy?.pluginId) {
  fail("the manifest ID must match package.json omarchy.pluginId.");
}
if (metadata.repository?.url !== `git+${repositoryUrl}.git`) {
  fail("package.json repository metadata is not the publication repository.");
}
if (!/^[0-9a-f]{40}$/u.test(lock.commit) || !/^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/u.test(lock.tag)) {
  fail("t3-upstream.lock.json does not contain an exact Nightly tag and commit.");
}

const submoduleCommit = execFileSync(
  "git",
  ["-C", join(root, "upstream", "t3code"), "rev-parse", "HEAD"],
  { encoding: "utf8" },
).trim();
if (submoduleCommit !== lock.commit) {
  fail(`the T3 submodule is ${submoduleCommit}, but the lock requires ${lock.commit}.`);
}

const documentation = ["README.md", "UPSTREAM.md", "docs/ACCEPTANCE.md"];
for (const path of documentation) {
  const contents = await readFile(join(root, path), "utf8");
  if (!contents.includes(lock.commit)) fail(`${path} does not identify the supported T3 commit.`);
  if (path !== "docs/ACCEPTANCE.md" && !contents.includes(lock.tag)) {
    fail(`${path} does not identify the supported T3 tag.`);
  }
  if (contents.includes("<repository-url>")) fail(`${path} still contains a repository placeholder.`);
}

const readme = await readFile(join(root, "README.md"), "utf8");
if (!readme.includes(repositoryUrl)) fail("README.md does not link to the publication repository.");

await access(join(root, "plugin", "share", "applications", `${manifest.id}-callback.desktop.in`));
await access(join(root, "scripts", "install-package"));
await access(join(root, "scripts", "uninstall-package"));

process.stdout.write(
  `Validated ${manifest.id} ${metadata.version} at T3 ${lock.tag} (${lock.commit}).\n`,
);
