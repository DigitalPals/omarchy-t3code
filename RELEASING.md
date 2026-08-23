# Releasing

1. Run `pnpm check:t3-nightly`. If adopting a candidate, use
   `scripts/update-t3-nightly`, inspect the pinned source and all compatibility
   changes, and obtain human approval of both the lock and submodule SHA.
2. Update `CHANGELOG.md`. Set the same semantic version in `package.json`,
   `bridge/package.json`, and `plugin/manifest.json`; `pnpm validate:repo`
   enforces consistency.
3. Run `pnpm install --frozen-lockfile`, `pnpm check`, and `pnpm package` on the
   supported Omarchy environment.
4. Verify `dist/omarchy-t3code-plugin.tar.gz.sha256`, inspect archive ownership
   and contents, install into temporary XDG roots, and execute the complete
   [acceptance checklist](docs/ACCEPTANCE.md).
5. Commit the reviewed tree, tag it as `v<version>`, and push the tag. The
   release workflow rebuilds on Node 24, validates the standalone executable,
   and attaches the Linux x64 archive and checksum to the GitHub release.

No release workflow may update the T3 pin automatically or receive a real T3
credential.
