# Contributing

Thank you for improving Omarchy T3 Code Mini. Read [AGENTS.md](AGENTS.md)
before changing code: its pinned-upstream, authentication, protocol, state,
and verification rules are repository invariants for human and automated
contributors alike.

## Development setup

```bash
git submodule update --init upstream/t3code
pnpm install --frozen-lockfile
pnpm check
```

Do not initialize upstream recursively. Keep direct T3 integration code under
`bridge/src/t3`, keep credentials out of QML and logs, and update the local
protocol decoder and tests together when extending the QML/bridge boundary.

Behavior changes need focused tests plus `pnpm check`. Packaging, bridge-entry,
installer, or release-layout changes also need `pnpm package` and inspection of
the generated archive. Real-account testing follows
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md); never place production credentials in
tests, issues, or fixtures.

## Upstream updates

Use `scripts/update-t3-nightly`; never change the submodule SHA or
`t3-upstream.lock.json` independently. A passing compatibility suite produces a
candidate only. A human must review pinned contract/runtime changes and native
Clerk metadata before the revision becomes supported.

For security problems, use the private channel in [SECURITY.md](SECURITY.md).
