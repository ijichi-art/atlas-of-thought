# Reddit post templates

Each subreddit has its own culture. Use these as starting points and
read the subreddit's recent top posts before submitting.

## r/dataisbeautiful (OC tag)

Visual-first post. The map screenshot IS the post.

**Title:** `[OC] I turned 1,500 of my AI chat conversations into a procedurally-generated city`

**Body:**
> Hi r/dataisbeautiful — I'm a solo developer who got tired of losing
> ideas in the linear scroll of ChatGPT / Claude. So I built a tool
> that reads my chat exports and generates a real geographic map.
>
> - Countries = themes (LLM-clustered)
> - Cities = idea-groupings within a theme (POI density determines
>   built-up rendering)
> - Highways = Euclidean MST through Delaunay triangulation of cluster
>   centers, planar by construction
> - 5 detour-shortcut bypass highways, river generation, Voronoi-clipped
>   street grids, building footprints
>
> The visualization is plain SVG with d3-zoom for pan/zoom. All processing
> runs locally on your machine — your chat data doesn't leave your laptop.
>
> Tools: Next.js + d3-force + d3-delaunay + Prisma + SQLite + DeepSeek V3
> for the cartographer LLM (~$0.30 per full map).
>
> OSS (MIT): https://github.com/ijichi-art/atlas-of-thought

**Top-comment material:** explain the road generation in slightly more
detail when someone asks; share a zoom-in GIF showing the Manhattan
street grid.

---

## r/sideproject

Maker community. Share the journey, not just the result.

**Title:** `Atlas of Thought — My AI chat history as a procedurally-generated city (4 weeks of cartography iteration)`

**Body:**
> Built this to scratch my own itch: AI conversations pile up in
> linear chat UIs and the connections between them get lost. Atlas of
> Thought imports your ChatGPT / Claude / Gemini exports and turns
> them into a geographic map.
>
> Hardest part wasn't the LLM clustering — it was getting the procedural
> cartography to look like a real map rather than a graph diagram. Some
> things that took multiple iterations:
>
> - Roads kept crossing each other (LLM-weight MST is non-planar) →
>   switched to Euclidean MST through Delaunay triangulation
> - Built-up areas were either invisible or covered every cluster →
>   density threshold ≥7 POIs + 1.6× polygon scale relative to the POI
>   scatter range fixed it
> - Adjacent clusters' street grids overlapped at different rotations →
>   Voronoi-cell clip per cluster
> - POIs landed on the river → rejection sampling against the river
>   polyline
>
> All local-first. SQLite on your machine, BYOK LLM API. MIT licensed.
>
> Code: https://github.com/ijichi-art/atlas-of-thought
> Setup: 5 minutes (Solo mode)
>
> Feedback / PRs welcome.

---

## r/LocalLLaMA

Privacy-focused community. Lead with local-first.

**Title:** `Atlas of Thought — local-first map of your ChatGPT / Claude history (BYOK, MIT)`

**Body:**
> Built an OSS tool that turns chat exports into a city map. Local-first
> by design:
>
> - SQLite on your machine, no central server
> - BYOK — DeepSeek / OpenAI / Anthropic, your key + your bill
> - LLM call only happens when you click *Terraform* (initial map gen);
>   afterward the map is static SVG
> - All importers parse files locally
> - No telemetry
>
> Works with: ChatGPT (JSON + HTML), Claude, Claude Code (jsonl), Gemini
> Takeout (HTML) and Workspace (JSON).
>
> Setup is `git clone && npm install && npm run dev`, plus pasting your
> API key in the in-app settings.
>
> https://github.com/ijichi-art/atlas-of-thought

**Anticipated angle:** users here will ask about Ollama / local LLM
support. Honest answer: cartographer prompt is tuned for frontier-tier
models (deepseek-chat or better); local 7-13B models often produce
malformed JSON for the clustering step. Phase 4 might explore.

---

## r/programming

Technical audience. The cartography algorithms are the hook.

**Title:** `Procedurally generating a city from AI chat history — Euclidean MST + Delaunay + Voronoi clipping`

**Body:**
> Posting because some of the cartography decisions might interest
> people here:
>
> 1. **Why Euclidean MST?** First version used LLM-weight MST (Kruskal
>    sorted by semantic-edge weight). Result: roads connected
>    semantically-related but geographically-distant clusters → tons of
>    crossings. Switched to Euclidean MST through the Delaunay
>    triangulation of cluster centers. Provably planar, minimum total
>    length, looks like a real road network.
>
> 2. **Bypass shortcuts.** Spanning trees alone make some pairs detour
>    by 10×+ even when they're adjacent on the canvas. Picked top-5
>    non-MST Delaunay edges by ratio of MST-path-distance to direct-
>    distance — they're the bridges that reduce average travel time
>    without introducing crossings.
>
> 3. **Voronoi clipping for street grids.** Per-cluster street grid
>    rotated by a hash of the cluster ID. Adjacent clusters at different
>    rotations created visual chaos in overlap regions. Solution:
>    compute Voronoi cells from cluster centers, intersect each grid's
>    clip path with its cell.
>
> 4. **Density-thresholded built-up rendering.** Clusters with <7 POIs
>    are bare dots; ≥7 POIs get the dark-beige polygon + buildings +
>    grid. Threshold tuned by trial and error.
>
> Code: https://github.com/ijichi-art/atlas-of-thought
> (Next.js + d3-force + d3-delaunay + Prisma + SQLite, MIT licensed.)

---

## r/ChatGPT (only if it survives the spam filters there)

Title: `Made a map of my entire ChatGPT history — see your conversations as a city`

Body: short, screenshot-led. Link to repo. Be ready for "is this safe?"
questions and explain local-first immediately.

---

## Cross-posting policy

Do NOT post to all subreddits same day. Stagger:

- Day 0: r/dataisbeautiful
- Day 1: Twitter thread + Show HN
- Day 2: r/sideproject + r/LocalLLaMA
- Day 4: r/programming
- Day 7+: r/ChatGPT, more niches

Reddit's anti-spam learns; rapid cross-posts get flagged.
