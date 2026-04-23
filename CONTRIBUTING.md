# Contributing to Atlas of Thought

Thanks for your interest. The project is in **early development** — APIs,
data models, and UX are still moving. Before opening a PR for non-trivial
changes, please open an Issue first to align on direction.

## Development setup

See [README.md](./README.md) for local setup.

```bash
npm install
cp .env.example .env.local
npx prisma migrate dev
npm run dev
```

## Project structure

```
src/
  app/                 Next.js App Router pages and API routes
  components/          UI components
    atlas/             SVG terrain rendering
    nodes/             Cities, countries, roads
    panels/            Side panels (city detail, chat)
  lib/
    parsers/           Conversation importers (ChatGPT, Claude, Claude Code)
    terraform/         Clustering and layout
    llm/               Anthropic SDK wrapper (BYOK-aware)
    crypto.ts          AES-256-GCM key encryption
    prisma.ts          Prisma client singleton
  types/               Shared types
prisma/
  schema.prisma        Database schema
  migrations/          Generated migrations
```

## Conventions

- TypeScript strict mode. No `any` without an explanation comment.
- Server-side handles all Anthropic API calls. The browser must never see a
  raw API key after submission.
- Imported user data is treated as **private** unless the user explicitly
  publishes it. Never log message contents at info level.
- Database changes go through Prisma migrations (`npx prisma migrate dev`).
- Commits: imperative mood, scoped (`feat(import): add ChatGPT parser`).

## Security

- Do not commit `.env*` files (the `.gitignore` blocks them, but check `git status`).
- Report security issues privately — see [SECURITY.md](./SECURITY.md) (TBD).

## License

By contributing, you agree your contributions will be licensed under MIT.
