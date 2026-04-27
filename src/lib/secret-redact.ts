// Layer 1 secret redaction.
//
// Applied to every imported message body BEFORE persisting to the DB.
// Patterns match the formats of well-known credentials (API keys, JWTs,
// PEM-block private keys, DB connection strings with embedded passwords).
// Each match is replaced with a stable placeholder like `[REDACTED:openai]`
// so a downstream reader / cartographer LLM can see *that* a secret was
// stripped, but never the secret itself.
//
// Design notes:
//   - Format-only matching. We never judge "this looks confidential" —
//     that responsibility lives in Layer 2 (user directive). Keeping
//     this layer purely deterministic means very low false-positive rate
//     and predictable behavior.
//   - Patterns target frequent leaks in AI chat / vibe-coding pastes:
//     .env files, ~/.aws/credentials, GCP service-account JSON, npm /
//     GitHub tokens copied from terminal output, Supabase / custom JWTs,
//     bot tokens shoved into config.

export type RedactionKind =
  | "anthropic"
  | "openai"
  | "google"
  | "huggingface"
  | "aws-access-key"
  | "aws-secret-line"
  | "digitalocean"
  | "github"
  | "github-fine-grained"
  | "gitlab"
  | "npm"
  | "slack"
  | "slack-app"
  | "stripe"
  | "twilio-key"
  | "sendgrid"
  | "mailgun"
  | "notion"
  | "linear"
  | "mapbox"
  | "discord"
  | "telegram"
  | "jwt"
  | "private-key"
  | "db-url";

type Rule = {
  kind: RedactionKind;
  // Each rule's pattern MUST have the global flag.
  pattern: RegExp;
};

// Order matters: more specific rules run first so a generic pattern (e.g.
// JWT) doesn't gobble a more specific one (Mapbox `pk.eyJ…`).
export const RULES: Rule[] = [
  // ── AI providers ─────────────────────────────────────────────────────────
  // Anthropic API keys: sk-ant-api03-..., sk-ant-...
  { kind: "anthropic", pattern: /sk-ant-(?:api\d+-)?[A-Za-z0-9_-]{80,}/g },
  // OpenAI: sk-..., sk-proj-... (legacy + project keys). Bound the length
  // generously so we catch long project keys without false positives on
  // arbitrary "sk-foo" strings.
  { kind: "openai", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  // Google API key (Gemini, Maps, etc.)
  { kind: "google", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // Hugging Face access tokens
  { kind: "huggingface", pattern: /\bhf_[A-Za-z0-9]{30,}\b/g },

  // ── Cloud providers ──────────────────────────────────────────────────────
  // AWS access key id
  { kind: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  // AWS secret access key — very generic 40-char base64 alone. Anchor on
  // the conventional `aws_secret_access_key = ...` line to avoid matching
  // every random 40-char string.
  {
    kind: "aws-secret-line",
    pattern: /aws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{40}/gi,
  },
  // DigitalOcean personal access token
  { kind: "digitalocean", pattern: /\bdop_v1_[a-f0-9]{64}\b/g },

  // ── Code platforms ───────────────────────────────────────────────────────
  // GitHub PATs (classic): ghp_, gho_, ghu_, ghs_, ghr_
  { kind: "github", pattern: /\bgh[opusr]_[A-Za-z0-9]{36,251}\b/g },
  // GitHub fine-grained PAT
  {
    kind: "github-fine-grained",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{82,}\b/g,
  },
  // GitLab personal access token
  { kind: "gitlab", pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  // npm publish token
  { kind: "npm", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },

  // ── SaaS ─────────────────────────────────────────────────────────────────
  // Slack: bot/user/admin/refresh/social/legacy
  { kind: "slack", pattern: /\bxox[abprsoc]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "slack-app", pattern: /\bxapp-[A-Za-z0-9-]{20,}\b/g },
  // Stripe: secret + restricted, both live and test
  {
    kind: "stripe",
    pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
  },
  // Twilio API key (SK + 32 hex). Account SID `AC...` is sensitive only
  // paired with auth token, so we don't pre-redact it (high noise).
  { kind: "twilio-key", pattern: /\bSK[a-f0-9]{32}\b/g },
  // SendGrid API key
  {
    kind: "sendgrid",
    pattern: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}\b/g,
  },
  // Mailgun API key
  { kind: "mailgun", pattern: /\bkey-[a-f0-9]{32}\b/g },
  // Notion integration token
  { kind: "notion", pattern: /\bsecret_[A-Za-z0-9]{40,}\b/g },
  // Linear API key
  { kind: "linear", pattern: /\blin_api_[A-Za-z0-9]{40}\b/g },
  // Mapbox public token (already a JWT — match before generic JWT so
  // the redaction kind is informative)
  {
    kind: "mapbox",
    pattern: /\bpk\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  },

  // ── Bot tokens ───────────────────────────────────────────────────────────
  // Discord bot
  {
    kind: "discord",
    pattern: /\b[MNO][\w-]{23,}\.[\w-]{6,7}\.[\w-]{27,38}\b/g,
  },
  // Telegram bot
  {
    kind: "telegram",
    pattern: /\b\d{8,10}:AA[A-Za-z0-9_-]{32,34}\b/g,
  },

  // ── Generic credentials ──────────────────────────────────────────────────
  // JWT (Supabase anon/service-role keys, custom auth)
  {
    kind: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  // PEM private-key block (RSA / EC / OpenSSH / DSA / PKCS#8 / encrypted)
  {
    kind: "private-key",
    pattern:
      /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
  },
  // DB connection string with embedded password
  // Match `scheme://user:password@host/...` for common DB URIs.
  {
    kind: "db-url",
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqps?):\/\/[^\s:@/]+:[^\s:@/]+@[^\s/]+(?:\/[^\s]*)?/g,
  },
];

export type RedactionEvent = { kind: RedactionKind; count: number };

export type RedactResult = {
  text: string;
  events: RedactionEvent[];
};

export function redactSecrets(input: string): RedactResult {
  if (!input) return { text: input, events: [] };
  let text = input;
  const events: RedactionEvent[] = [];
  for (const rule of RULES) {
    let count = 0;
    text = text.replace(rule.pattern, () => {
      count++;
      return `[REDACTED:${rule.kind}]`;
    });
    if (count > 0) events.push({ kind: rule.kind, count });
  }
  return { text, events };
}
