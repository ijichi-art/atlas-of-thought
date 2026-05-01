# Launch checklist

Concrete checklist for the public launch. Aim to complete the "must-have"
items before any of the social posts in `twitter-thread.md` /
`show-hn.md` / `reddit.md` go live.

## T-7 days: must-have

- [ ] **Hero GIF**: 10–15 s zoom from country level → city level → POI
  labels. Place at `docs/assets/hero.gif`. Update README image link.
- [ ] **Three more screenshots**: full atlas, highway close-up, single
  cluster's grid. Used in tweet/HN/Reddit posts.
- [ ] **Solo mode quick start verified on a clean machine**: do a fresh
  `git clone` on a different laptop / VM, follow the README, time it.
  Record any friction.
- [ ] **Live demo deployment** (sample data, no real chat history) at
  e.g. atlas.example.com or atlas-of-thought.app. Vercel free tier is
  fine since it's static once the map is built.
- [ ] **CONTRIBUTING.md updated** for the post-Solo-mode reality.
- [ ] **GitHub repo Topics set**: `visualization`, `llm`, `chat-history`,
  `nextjs`, `prisma`, `data-art`, `electron`, `local-first`.
- [ ] **GitHub Sponsors button** enabled on repo if you want it.
- [ ] **README badges**: stars, license, build status (later).

## T-1 day: nice-to-have

- [ ] Loom / YouTube 60-second walkthrough video. Embed in README.
- [ ] One technical blog post on the cartography (helps Show HN
  follow-up traffic). Publish to Medium / Zenn / your own blog.
- [ ] Twitter handle profile pinned post pre-prepared.
- [ ] Discord server stub in case interest spikes.

## Launch day (Tue–Thu, US morning)

Recommended timing (US Pacific):

- 06:30 — final smoke test of `git clone && npm install && npx prisma db push && npm run dev`
- 07:00 — Show HN post submitted
- 07:15 — Twitter thread posted
- 07:30 — pinned tweet on profile
- 09:00 — r/dataisbeautiful post
- through the day: respond politely to first 50 HN comments and Twitter
  replies; do NOT push back on bad-faith critiques in public

## Day +1

- [ ] r/sideproject post
- [ ] r/LocalLLaMA post

## Day +3

- [ ] r/programming post
- [ ] note / Zenn 制作記事 (Japanese audience)

## Post-launch metrics to watch

- GitHub stars per hour during the spike
- HN front-page time (if you make front page)
- Issues / PRs filed (real engagement signal)
- Twitter impressions (vanity metric, but useful for follow-up)

## What "good" looks like

For an OSS launch, "good" is wide variation. Reasonable success
patterns:

- 200–500 stars day 1 (Show HN frontpage, no Forbes coverage)
- 1k–3k stars first week if Twitter thread genuinely takes off
- 10k+ stars only if a high-follower account amplifies (uncontrollable)

Don't optimize for stars; optimize for conversations. 30 issues from
people who actually used it >> 5000 stars from people who clicked once.
