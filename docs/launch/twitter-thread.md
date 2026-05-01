# Twitter / X thread template

Visual project, lead with imagery. Each tweet should be ≤280 chars and
each have a GIF or screenshot if possible. The thread is the primary
launch artifact — Show HN / Reddit posts can link back to it.

## Recommended posting time

- US morning: 9–11am Pacific (Tue–Thu best)
- JP audience: post in Japanese 9–11pm JST (overlaps US morning)
- Pin the thread for at least a week

---

## English version

### Tweet 1 (hero)
> I made my AI chat history into a city.
>
> Atlas of Thought reads your ChatGPT / Claude / Gemini export and
> generates a real geographic map: countries for themes, cities for
> idea-clusters, highways between related topics.
>
> It's OSS, local-first. Your data never leaves your machine.
>
> 🧵👇
>
> [GIF: zoom from country level → city level → POI labels visible]

### Tweet 2 (the why)
> Today's AI UIs are linear. You scroll, you search, you forget.
>
> Networks of ideas you built across hundreds of sessions get lost in
> the timeline.
>
> The brain remembers space far better than text. So I made the space.
>
> [Screenshot: zoom-out view of full atlas, ~20 named countries visible]

### Tweet 3 (the math, for credibility)
> The roads aren't random. They're a Euclidean MST through the Delaunay
> triangulation of cluster centers — provably planar (no crossings) +
> minimum total length.
>
> Plus 5 detour-shortcut bypass highways, river generation, Voronoi-clipped
> street grids per city.
>
> [Screenshot: highway network close-up + detail of one cluster's grid]

### Tweet 4 (privacy / BYOK)
> Local-first by design.
>
> 🟢 SQLite on your machine
> 🟢 BYOK (DeepSeek / OpenAI / Anthropic — your choice, your bill)
> 🟢 Chat data never leaves your laptop
> 🟢 No telemetry, no central server
>
> The whole thing is one git clone + npm install away.

### Tweet 5 (call to action)
> Code: github.com/ijichi-art/atlas-of-thought
>
> 5-min Solo mode setup. Demo (sample data) coming this week.
>
> Star ⭐ if you'd use this; that's the cheapest signal that helps
> me prioritize. Issues / parser PRs welcome.
>
> [Screenshot: README hero or a particularly pretty cluster]

### Optional Tweet 6 (devlog hook)
> Built with Next.js + d3-force + Delaunay + Prisma + SQLite. Procedural
> map generation took 4 weeks of math iteration alone — I'll write up
> the cartographer LLM design + the Euclidean-MST routing decision in a
> follow-up post if there's interest.

---

## 日本語版

### Tweet 1 (hero)
> AIとのチャット履歴を、街にした。
>
> Atlas of Thought は ChatGPT / Claude / Gemini の export を読み込んで
> 地理マップを生成する OSS。テーマが「国」、アイデアの塊が「街」、
> 関連トピックが「高速」で繋がる。
>
> 完全ローカル。データは PC から出ない。
>
> 🧵
>
> [GIF: 国 → 街 → POI へズーム]

### Tweet 2 (why)
> 今の AI UI は線形。スクロールして検索して、忘れる。
>
> 何百セッションも積み重ねたアイデアの繋がりはタイムラインに埋もれる。
>
> 脳は文字より空間の方が圧倒的に記憶できる。だから空間を作った。

### Tweet 3 (技術的見どころ)
> 道路はランダムじゃない。クラスタ中心の Delaunay 三角分割を通る
> Euclidean MST = planar (交差ゼロ) で総長最小。
>
> + 迂回比上位 5 本のショートカット高速、河川生成、各都市に Voronoi
> セルでクリップされた街路グリッド。
>
> [街路グリッドのスクショ]

### Tweet 4 (プライバシー / BYOK)
> 設計上ローカルファースト。
>
> 🟢 SQLite が PC に保存
> 🟢 BYOK (DeepSeek / OpenAI / Anthropic から選択)
> 🟢 チャットデータが PC から出ない
> 🟢 テレメトリなし、中央サーバなし
>
> git clone + npm install で始まる。

### Tweet 5 (CTA)
> Code: github.com/ijichi-art/atlas-of-thought
>
> Solo モードは 5 分でセットアップ。サンプルデモ準備中。
>
> 使ってみたい人はスターを ⭐ — ロードマップ優先度の指標になります。

---

## Hashtag suggestions
`#OSS #AI #ChatGPT #Claude #DataVisualization #Tauri (or #Electron) #IndieDev #LLM`

JP: `#OSS #個人開発 #生成AI #データ可視化`

## Image checklist before posting
- [ ] hero GIF (10–15 s, ≤8 MB) at top
- [ ] full-atlas screenshot for tweet 2
- [ ] highway / cluster detail for tweet 3
- [ ] one final shot for tweet 5
- [ ] alt text on every image (accessibility + ranking)

## Don't do
- Don't crowd-summon "RT please" — performs worse than just shipping good visuals
- Don't apologize for being early — the alpha tag in README is enough
- Don't engage with bad-faith replies the first 24h, focus on amplification
