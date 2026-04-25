# Atlas of Thought

> Turn your AI conversations into a living map. Explore the terrain of your own thinking.

**Status:** pre-alpha. Phases 0–5 complete; approaching public launch.

Atlas of Thought is a spatial alternative to chat UIs. Import your past AI
conversations (ChatGPT, Claude, Claude Code), and watch them grow into a map:
**countries** for big themes, **cities** for individual ideas, **roads** for
the logical links between them, **mountains** and **forests** for terrain that
emerges from the shape of your thought.

It's an OSS, self-hostable, **bring-your-own-API-key** project — your data
stays yours, your API spend is yours.

[日本語版 README](./README.ja.md)

## Why?

Today's AI chat UIs are linear. You scroll, you search, you forget. Networks
of ideas you built across dozens of sessions get lost. Atlas of Thought
treats your conversations as **terrain**: the human brain remembers space
better than text.

Differentiation in one sentence: existing tools (ChatGPT-2D, ChatMap,
Heptabase, Obsidian Canvas) stop at network diagrams or require manual
layout — Atlas of Thought generates a **geographic map** automatically.

## Roadmap

- ✅ **Phase 0** — Foundations: Next.js + Postgres, auth, BYOK encryption
- ✅ **Phase 1** — Map viewer (SVG atlas with d3-zoom pan/zoom)
- ✅ **Phase 2** — Importers: ChatGPT / Claude / Claude Code logs
- ✅ **Phase 3** — Resume conversations from any city
- ✅ **Phase 4** — Auto-terraforming with Claude (LLM + layout math)
- ✅ **Phase 5** — Public sharing (URLs, OGP, embeds)
- **Phase 6** — City-to-city comparison; artifact landmarks ← *next*
- **Phase 7** — Public launch (Show HN, Product Hunt)

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind 4 · Prisma + Postgres
(pgvector for Phase 4) · Auth.js v5 · Anthropic SDK · D3-force · Zustand ·
Framer Motion.

## Self-hosting with Docker

The fastest way to run Atlas of Thought in production.

```bash
git clone https://github.com/ijichi-art/atlas-of-thought.git
cd atlas-of-thought
cp .env.example .env

# Fill in .env (see below for required values), then:
docker compose up -d
```

Open <http://localhost:3000>.

**Required `.env` values:**

| Variable | How to get it |
|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | [Create a GitHub OAuth app](https://github.com/settings/developers). Callback URL: `http://your-domain/api/auth/callback/github` |
| `AUTH_URL` | Your public URL, e.g. `https://atlas.example.com` |
| `NEXT_PUBLIC_ORIGIN` | Same as `AUTH_URL` (used for share links and OGP) |

The app container runs `prisma migrate deploy` on start — the database
is always up to date automatically.

> **⚠️ Key rotation warning:** rotating `ENCRYPTION_KEY` invalidates all
> stored user API keys. Back it up somewhere safe.

## Local development

Prerequisites: Node 20+, Postgres 16+ with pgvector.

```bash
git clone https://github.com/ijichi-art/atlas-of-thought.git
cd atlas-of-thought
npm install
cp .env.example .env.local
# Edit .env.local — see the table above for required values

# Spin up a local Postgres (or use the compose postgres-only service):
docker compose up -d postgres

# Initialize the database:
npx prisma migrate dev

npm run dev
```

Open <http://localhost:3002> (dev server runs on port 3002).

## BYOK (Bring Your Own Key)

You supply your own Anthropic API key. Get one at
<https://console.anthropic.com>. The key is encrypted with AES-256-GCM
(using `ENCRYPTION_KEY` from your env) before being stored. The server
streams Claude responses on your behalf — your key never touches the
browser after submission.

If you self-host, **rotate `ENCRYPTION_KEY` at your peril**: doing so will
make all stored user API keys unreadable.

## Privacy

- Your maps are **private by default**.
- Public sharing (Phase 5) is opt-in per map / per country / per city.
- Imported data lives in your database. There is no central server.
- Exporting your data and deleting your account will remove everything.

## License

MIT — see [LICENSE](./LICENSE).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The project is in active early
development; design conversations happen in GitHub Issues.
