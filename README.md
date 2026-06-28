# Local Suite

Local Suite is a local development control plane for active projects under `/Users/cartertyra/developer`.

## V1

- `config/projects.json` is the Local Suite source of truth for project metadata.
- Docker stack metadata comes from `/Users/cartertyra/.codex/bin/devctl`.
- The server reads git status, package script names, Docker state, and listening ports.
- The UI does not read env files or render package script command values.
- Mutating Docker actions are not executed. Devctl up/down actions are dry-run previews only.

## Commands

```bash
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The dev server binds to `127.0.0.1:4111` by default. Set `PORT` to change it.
