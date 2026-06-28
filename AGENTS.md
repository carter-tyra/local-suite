# AGENTS.md instructions

## Defaults
- Ship production-grade, maintainable implementations. Avoid temporary parallel codepaths unless the user explicitly asks for staged migration work.
- Keep a single source of truth for business rules, enums, validation, flags, and config.
- Define required inputs up front, validate early, and fail fast on invalid state.
- Use current docs for anything that may have changed recently.

## Working Style
- If files change unexpectedly, assume parallel edits and keep the diff scoped. Stop only when there is a real conflict or breakage.
- Prefer direct integrations over wrappers or glue layers unless there is a hard interface boundary that justifies one.
- Ask before `git push`. Prefer Conventional Commits.
- Before UI/UX work, read `~/.codex/memories/ui-copy.md`. Keep UI copy short, plain, and useful.

## Premium UI Quality
- For UI, UX, frontend, dashboard, landing page, app shell, component, visual polish, responsive layout, typography, motion, hover state, shadcn/Base UI, Tailwind, or design-system work, use `~/.agents/skills/premium-ui-quality/SKILL.md` before editing.
- Start UI work by defining the product job, surface type, visual direction, layout model, tokens, component inventory, state inventory, and verification plan.
- Build through existing project primitives first. Add wrappers only when they create reusable product behavior, styling policy, or repeated composition.
- Do not finish UI implementation without browser verification on desktop and mobile, or an explicit note explaining why visual verification could not run.
- Treat contrast, focus, touch targets, loading/empty/error states, responsive behavior, copy clarity, and screenshot review as part of the implementation.

## Goal Suggestions
- End every substantive response with `Recommended next step:` followed by one concise, practical action.
- When the current task is a good Codex Goal candidate, also include `Suggested goal:` and `Perfect prompt:`.
- Do not start, create, or activate a Goal unless the user explicitly asks.

## Shell
- Prefer fast deterministic tools: `rg`, `fd`, `ast-grep`, `jq`, and `yq`.
- Keep shell usage non-interactive and output-bounded.
- Avoid exposing secrets in commands, logs, or patches.

## Local Docker
- Use `/Users/cartertyra/.codex/bin/devctl` before local app, database, port, or Docker work.
- Run `devctl status` and `devctl ports --public` before debugging local ports or starting repo services.
- Prefer `devctl up <project>` and `devctl down <project>` for registered stacks; mutating commands require `--execute`.
- Keep local dependency ports bound to `127.0.0.1` unless LAN access is explicitly needed.
- Never prune Docker volumes unless the user explicitly asks.
- Use `docker container prune` and `docker builder prune` for safe cleanup, not `docker volume prune`.
- If a repo's live Docker state matters, verify with `devctl status`, `docker ps`, and the real Compose project rather than inferring from files.

<!-- ASTRYX:START -->
Astryx v0.1.1 · 148 components
CLI: run every command as `pnpm exec astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing. Full page → AppShell; sidebar nav → SideNav.
- Custom styling: component props first; else style/className with tokens — var(--color-*|--spacing-*|--radius-*). No raw hex/px. (No StyleX/Tailwind compiler here — don't use xstyle/utility classes.)
- Tokens for every value (`astryx docs tokens`). Brand/accent via `astryx theme` — never override --color-* in :root.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   148 components by category
  template --list    page + block recipes
  docs <topic>       color, elevation, icons, illustrations, migration, motion, principles, shape, spacing, styling, theme, tokens, typography
  swizzle <Name>     eject component source (--gap reports why)
  upgrade --apply    run after any @astryxdesign/core bump
<!-- ASTRYX:END -->
