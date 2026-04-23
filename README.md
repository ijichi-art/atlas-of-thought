# Atlas of Thought

> Turn your AI conversations into a living map. Explore the terrain of your own thinking.

**Status:** pre-alpha. Phase 0 (foundations).

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

- **Phase 0** — Foundations: Next.js + Postgres, auth, BYOK encryption ← *we are here*
- **Phase 1** — Map viewer (port the prototype to React)
- **Phase 2** — Importers: ChatGPT / Claude / Claude Code logs
- **Phase 3** — Resume conversations from any city
- **Phase 4** — Auto-terraforming with Claude (LLM + force layout)
- **Phase 5** — Public sharing (URLs, OGP, embeds)
- **Phase 6** — City-to-city comparison; artifact landmarks
- **Phase 7** — Public launch (Show HN, Product Hunt)

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind 4 · Prisma + Postgres
(pgvector for Phase 4) · Auth.js v5 · Anthropic SDK · D3-force · Zustand ·
Framer Motion.

## Local development

Prerequisites: Node 20+, Postgres 16+ (pgvector required from Phase 4 onward).

```bash
git clone https://github.com/<your-username>/atlas-of-thought.git
cd atlas-of-thought
npm install
cp .env.example .env.local
# Edit .env.local — DATABASE_URL, AUTH_SECRET, AUTH_GITHUB_ID/SECRET, ENCRYPTION_KEY

# Generate AUTH_SECRET and ENCRYPTION_KEY:
#   openssl rand -base64 32

# Initialize the database:
npx prisma migrate dev

npm run dev
```

Open <http://localhost:3000>.

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
