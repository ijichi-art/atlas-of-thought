# Show HN post template

Hacker News loves: technical depth, individual makers, OSS / local-first
stories, well-documented design choices. Avoid: marketing language,
over-claiming, anything that smells like SEO.

## Submission settings

- **Type:** Show HN
- **URL:** https://github.com/ijichi-art/atlas-of-thought
- **Title:** keep ≤80 chars; lead with what it IS, not adjectives
- **Best time:** Tue–Thu, 7–9am Pacific
- **No flames the first hour:** be ready to engage politely with "doesn't
  this exist already?" / "why not just X?" — those are the best signal
  that you've hit a real itch

## Title options (pick one)

1. `Show HN: Atlas of Thought – your AI chat history as a Google-Maps-style city`
2. `Show HN: Atlas of Thought – local-first map of your ChatGPT / Claude history`
3. `Show HN: I turned my AI conversations into a procedurally-generated city`

Recommended: **#3** (specific, first-person, intriguing). HN responds
well to "I built X to scratch my itch" framing.

## First comment (the body of the post — HN convention)

> Hi HN — I'm Baki, a solo developer in Tokyo.
>
> I've been using ChatGPT and Claude for a couple of years and noticed
> that the *map* of what I've discussed with them was scattered across
> hundreds of sessions, none of which I could find again. The chat UI
> is fundamentally linear; the brain isn't.
>
> Atlas of Thought imports your AI chat exports (ChatGPT, Claude,
> Claude Code, Gemini) and generates an actual geographic map of your
> ideas: countries for big themes, cities for clusters, highways
> connecting topics that recur together. Click a city to read the
> conversations in it; zoom in for a Manhattan-style street grid.
>
> A few design decisions worth flagging for HN:
>
> - **Cartographer LLM**: I have the LLM emit a deterministic JSON
>   cluster tree (country → district → city → conversation) with batch
>   consolidation across 30+ batches for 1500+ conversations. Cost:
>   ~$0.30 with DeepSeek V3.
> - **Roads**: pure Euclidean MST through Delaunay triangulation of
>   cluster centers. Provably planar, minimum total length, no
>   crossings. Plus 5 detour-shortcut bypass highways picked by the
>   ratio of MST-path length to direct distance.
> - **Built-up areas**: density threshold (≥7 POIs) gates Manhattan
>   rendering; Voronoi cells clip each cluster's street grid so adjacent
>   clusters at different rotations don't overlap visually.
> - **Local-first**: SQLite on your machine, BYOK API key encrypted
>   with AES-256-GCM, no telemetry, no central server. Electron build
>   coming so you can double-click an installer.
>
> It's MIT licensed. I'd love feedback especially on the procedural
> cartography (the visual quality came from many iterations of getting
> the layout to look like a real map rather than a network diagram).
>
> Repo: https://github.com/ijichi-art/atlas-of-thought

## Anticipated questions (have answers ready)

**Q: Doesn't ChatGPT-2D / Heptabase / Obsidian Canvas already do this?**
> They produce node-link diagrams or require manual layout. Atlas of
> Thought generates geography — countries with borders, real road
> networks with planar guarantees, rivers and bridges. The mental model
> is "a city you remember spatially," not "a graph you analyze."

**Q: How is privacy handled?**
> Local-first. Chat data sits in SQLite on your laptop. Outbound HTTPS
> only goes to your chosen LLM provider when you click *Terraform*. No
> central atlas-of-thought.com server holds anything.

**Q: What about people without an API key?**
> The cheapest tier (DeepSeek V3) costs ~$0.30 per full map of 1500
> conversations. Most users can run terraform a handful of times for
> < $5/month. There's no free demo of *your* data because we'd have
> to host the inference, which defeats local-first.

**Q: Why not Tauri / why Electron?**
> The map-generation pipeline is in Node-side TypeScript with d3-force
> / d3-delaunay, tightly coupled to Prisma calls. Migrating to Tauri
> would mean rewriting that core in Rust or refactoring it for
> client-side execution — both risk visual quality regressions on the
> careful work that went into the cartography. Electron lets the
> existing code run unchanged.

**Q: Will you add live conversations / not just imports?**
> Imports first because the value is "see what you already built." Live
> conversation continuation is already supported (Phase 3) — you can
> click a city and resume the chat. Real-time multi-user comes later
> if there's demand.

## Don't say

- "AI-powered" (you and 10000 other launches today)
- "Revolutionary" / "game-changing"
- Anything that sounds like a press release
- Don't link your Twitter in the post body — let HN comments lead
  there organically
