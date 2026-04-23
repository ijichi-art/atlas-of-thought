# Atlas of Thought

> AIとの会話を「地形」として育てる。チャットUIに代わる空間的インターフェース。

**ステータス:** プレアルファ。Phase 0（基盤構築中）。

ChatGPT、Claude、Claude Code の過去の会話をインポートすると、テーマごとに **国** が
生まれ、論点が **都市** として配置され、論理的なつながりが **道路** で結ばれます。
議論の濃淡から **山** や **森** が自動で生成され、あなたの思考の地形が見えてきます。

OSS（MITライセンス）、セルフホスト可、**BYOK（Bring Your Own Key）**設計。
データもAPIコストもあなた自身のものです。

## なぜ作るのか

既存のAIチャットUIは線形です。スクロールと検索でしか過去を辿れず、複数セッションを
またいだ思考のつながりは失われます。Atlas of Thought は会話を **地形** として扱い、
人間の空間認知能力を活用します。

差別化の一言: 既存ツール（ChatGPT-2D, ChatMap, Heptabase, Obsidian Canvas）は
ネットワーク図止まりか手動配置前提。Atlas of Thought は地理的メタファーで自動生成します。

## ロードマップ

- **Phase 0** — 基盤: Next.js + Postgres, 認証, BYOK暗号化 ← *現在地*
- **Phase 1** — 地図ビューア（プロトタイプを React に移植）
- **Phase 2** — インポート機能: ChatGPT / Claude / Claude Code
- **Phase 3** — 任意の街から会話再開
- **Phase 4** — Claude による自動地形化（LLM + force layout）
- **Phase 5** — 公開・共有（URL/OGP/埋め込み）
- **Phase 6** — 街同士の比較、成果物ランドマーク
- **Phase 7** — 一般公開ローンチ（Show HN, Product Hunt）

## 技術スタック

Next.js 16 (App Router) · TypeScript · Tailwind 4 · Prisma + Postgres
(Phase 4 から pgvector) · Auth.js v5 · Anthropic SDK · D3-force · Zustand ·
Framer Motion

## ローカル開発

前提: Node 20+, Postgres 16+（Phase 4 以降は pgvector 必須）。

```bash
git clone https://github.com/<your-username>/atlas-of-thought.git
cd atlas-of-thought
npm install
cp .env.example .env.local
# .env.local を編集: DATABASE_URL, AUTH_SECRET, AUTH_GITHUB_ID/SECRET, ENCRYPTION_KEY

# AUTH_SECRET / ENCRYPTION_KEY の生成:
#   openssl rand -base64 32

# データベース初期化:
npx prisma migrate dev

npm run dev
```

<http://localhost:3000> を開く。

## BYOK について

Anthropic API キーは自分で用意します（<https://console.anthropic.com>）。
入力されたキーは AES-256-GCM で暗号化されてから DB に保存されます
（暗号化に `ENCRYPTION_KEY` 環境変数を使用）。Claude API への呼び出しは
すべてサーバ経由のストリーミングで行うため、キーはブラウザ側に残りません。

セルフホスト時、**`ENCRYPTION_KEY` のローテーションは慎重に**: 変更すると
保存済みのユーザーキーがすべて復号できなくなります。

## プライバシー

- あなたの地図は **デフォルト非公開** です
- 公開・共有は地図/国/街単位でオプトイン（Phase 5）
- インポートしたデータはあなたの DB の中だけにあります
- アカウント削除で全データを消去できます

## ライセンス

MIT — [LICENSE](./LICENSE) を参照。

## コントリビュート

[CONTRIBUTING.md](./CONTRIBUTING.md) を参照。設計議論は GitHub Issues で。
