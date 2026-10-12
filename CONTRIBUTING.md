# Contributing

## Setup

```bash
npm install     # also installs the git hooks (husky)
cp .env.example .env.local
npm run dev
```

## Before you push

```bash
npm run typecheck && npm run lint && npm run format:check && npm test
```

The pre-commit hook runs ESLint and Prettier on staged files and scans the staged diff for secrets. CI runs the full set plus a production build.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), enforced by `commitlint`:

```
<type>(<optional scope>): <what changed, imperative, lower case>
```

Types: `feat`, `fix`, `perf`, `refactor`, `style`, `test`, `docs`, `build`, `ci`, `chore`, `revert`.
Examples: `feat(calendar): show +n overflow in day cells`, `fix(sync): stop mixed-key bulk upserts`.

Keep one logical change per commit. Squash trial-and-error commits before merging.

## Conventions that are easy to break

- Never rename the persisted store keys `datebook-store`, `category` or `viewFilter`. User-facing copy says **Classes** and **Views**.
- A new database column needs a numbered file in `supabase/migrations/` **and** an entry in `STRIPPABLE_COLS` in `lib/db-sync.ts`.
- Animate `transform` and `opacity` only on hot paths. Use `useSlidingPill` for selected-segment highlights, not framer `layoutId`.
- Do not restore view state in a `useState` initialiser; it runs on the server and causes hydration mismatches.
- Secrets never go in the repo. `.env*` is ignored; add new variables to `.env.example` with an empty value.

## Reporting security issues

See [SECURITY.md](SECURITY.md).
