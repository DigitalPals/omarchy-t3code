# Changelog

All notable user-visible changes are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Added an All computers Inbox for accounts with multiple linked
  computers, with every thread action routed to its source computer.

### Changed

- Made the repository root a directly installable Omarchy marketplace plugin,
  added the root preview, and bundled a checksum-verified x86-64 runtime with
  its complete license inventory.
- Limited desktop callback registration to the active T3 Connect login window
  and restored the previous scheme owner before removing the hidden handler.
- Made approval-required the per-task default and added an explicit warning
  confirmation before a new task can use broader runtime access.
- Made the marketplace SEA checkout-path-independent and added a CI-enforced
  byte comparison between the tracked payload and a fresh pinned source build.

## [0.1.0] - 2026-08-23

### Added

- Native Clerk browser sign-in with secret-authenticated callback handoff.
- T3 Inbox, streamed threads, lifecycle commands, model controls, approvals,
  user input, and screenshot attachments in an Omarchy bar modal.
- Exact T3 Nightly compatibility pin, standalone Linux packaging, license
  inventory, checksum, installer, uninstaller, and legacy-ID migration.

### Security

- Assistant Markdown image and raw-HTML neutralization with an external-link
  scheme allowlist.
- Secret-Service-backed client, callback, and DPoP material; inherited-pipe
  IPC; ordered requests; and non-replaying bridge restart behavior.

[Unreleased]: https://github.com/DigitalPals/omarchy-t3code/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DigitalPals/omarchy-t3code/releases/tag/v0.1.0
