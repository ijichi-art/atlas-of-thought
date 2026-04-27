import { describe, expect, it } from "vitest";
import { redactSecrets } from "./secret-redact";

// Helper: assert that `input` produces a redaction of the given kind, and
// that the redacted output no longer contains the literal secret.
function assertRedacts(input: string, kind: string, secret: string) {
  const out = redactSecrets(input);
  expect(out.text).toContain(`[REDACTED:${kind}]`);
  expect(out.text).not.toContain(secret);
  expect(out.events.some((e) => e.kind === kind)).toBe(true);
}

// Helper: assert that `input` is preserved verbatim (no redactions).
function assertUntouched(input: string) {
  const out = redactSecrets(input);
  expect(out.text).toBe(input);
  expect(out.events).toHaveLength(0);
}

describe("redactSecrets — positive cases", () => {
  it("redacts an Anthropic API key", () => {
    const k = "sk-ant-api03-" + "a".repeat(95) + "AA";
    assertRedacts(`my key is ${k} please don't share`, "anthropic", k);
  });

  it("redacts an OpenAI key", () => {
    const k = "sk-proj-" + "X".repeat(40);
    assertRedacts(`OPENAI_API_KEY=${k}`, "openai", k);
  });

  it("redacts a Google API key", () => {
    const k = "AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz0123456";
    assertRedacts(`firebase init: apiKey: "${k}"`, "google", k);
  });

  it("redacts a Hugging Face token", () => {
    const k = "hf_" + "a".repeat(34);
    assertRedacts(`HF_TOKEN=${k}`, "huggingface", k);
  });

  it("redacts an AWS access key id", () => {
    const k = "AKIAIOSFODNN7EXAMPLE";
    assertRedacts(`aws_access_key_id = ${k}`, "aws-access-key", k);
  });

  it("redacts an AWS secret access key line", () => {
    const line = "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    assertRedacts(line, "aws-secret-line", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
  });

  it("redacts a DigitalOcean PAT", () => {
    const k = "dop_v1_" + "a".repeat(64);
    assertRedacts(`DO_TOKEN=${k}`, "digitalocean", k);
  });

  it("redacts a classic GitHub PAT", () => {
    const k = "ghp_" + "A".repeat(36);
    assertRedacts(`gh auth login --with-token < <(echo ${k})`, "github", k);
  });

  it("redacts a fine-grained GitHub PAT", () => {
    const k = "github_pat_" + "A".repeat(82);
    assertRedacts(`token=${k}`, "github-fine-grained", k);
  });

  it("redacts a GitLab PAT", () => {
    const k = "glpat-" + "A".repeat(20);
    assertRedacts(`GITLAB_TOKEN=${k}`, "gitlab", k);
  });

  it("redacts an npm token", () => {
    const k = "npm_" + "A".repeat(36);
    assertRedacts(`//registry.npmjs.org/:_authToken=${k}`, "npm", k);
  });

  it("redacts a Slack bot token", () => {
    const k = "xoxb-1234567890-12345-abcdefghijklmnopqrstuvwx";
    assertRedacts(`SLACK_BOT_TOKEN=${k}`, "slack", k);
  });

  it("redacts a Slack app-level token", () => {
    const k = "xapp-1-A12345-12345-abcdefghijklmnopqrstuvwx";
    assertRedacts(`SLACK_APP_TOKEN=${k}`, "slack-app", k);
  });

  it("redacts a Stripe live secret key", () => {
    const k = "sk_live_" + "X".repeat(24);
    assertRedacts(`stripe = require('stripe')('${k}');`, "stripe", k);
  });

  it("redacts a Twilio API key", () => {
    const k = "SK" + "0123456789abcdef0123456789abcdef";
    assertRedacts(`TWILIO_API_KEY=${k}`, "twilio-key", k);
  });

  it("redacts a SendGrid API key", () => {
    const k = "SG." + "A".repeat(22) + "." + "B".repeat(43);
    assertRedacts(`SENDGRID_API_KEY=${k}`, "sendgrid", k);
  });

  it("redacts a Mailgun API key", () => {
    const k = "key-" + "0123456789abcdef0123456789abcdef";
    assertRedacts(`MAILGUN_API_KEY=${k}`, "mailgun", k);
  });

  it("redacts a Notion integration token", () => {
    const k = "secret_" + "A".repeat(43);
    assertRedacts(`NOTION_TOKEN=${k}`, "notion", k);
  });

  it("redacts a Linear API key", () => {
    const k = "lin_api_" + "A".repeat(40);
    assertRedacts(`LINEAR_API_KEY=${k}`, "linear", k);
  });

  it("redacts a Mapbox public token before falling back to generic JWT", () => {
    const k =
      "pk.eyJ" + "abcdefghijklmnop".repeat(2) + "." + "ABCDEF".repeat(5);
    const out = redactSecrets(`MAPBOX_TOKEN=${k}`);
    expect(out.events.some((e) => e.kind === "mapbox")).toBe(true);
    expect(out.text).not.toContain(k);
  });

  it("redacts a Discord bot token", () => {
    const k =
      "MTIzNDU2Nzg5MDEyMzQ1Njc4OQ" +
      ".XYZabc" +
      "." +
      "abcdefghijklmnopqrstuvwxyz123";
    assertRedacts(`DISCORD_TOKEN=${k}`, "discord", k);
  });

  it("redacts a Telegram bot token", () => {
    const k = "1234567890:AA" + "abcdefghijklmnopqrstuvwxyz_-1234";
    assertRedacts(`TELEGRAM_BOT_TOKEN=${k}`, "telegram", k);
  });

  it("redacts a generic JWT (e.g. Supabase anon key)", () => {
    const k =
      "eyJhbGciOiJIUzI1NiJ9" +
      "." +
      "eyJzdWIiOiIxMjM0NTY3ODkwIn0" +
      "." +
      "abcdefghij1234567890";
    assertRedacts(`SUPABASE_ANON_KEY=${k}`, "jwt", k);
  });

  it("redacts a PEM private-key block", () => {
    const block = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAwggEvYJKoZIhvcNAQEBBQADggEPADCCAQ
fakebase64linehere
-----END RSA PRIVATE KEY-----`;
    const out = redactSecrets(`prefix\n${block}\nsuffix`);
    expect(out.text).toContain("[REDACTED:private-key]");
    expect(out.text).not.toContain("BEGIN RSA");
    expect(out.text).toContain("prefix");
    expect(out.text).toContain("suffix");
  });

  it("redacts a Postgres connection string with password", () => {
    const url = "postgresql://admin:supersecret@db.example.com:5432/app";
    assertRedacts(`DATABASE_URL=${url}`, "db-url", url);
  });

  it("redacts a MongoDB+SRV connection string", () => {
    const url = "mongodb+srv://user:pwd123@cluster0.mongodb.net/mydb";
    assertRedacts(`mongo URI: ${url}`, "db-url", url);
  });
});

describe("redactSecrets — negative cases (no false positives)", () => {
  it("leaves casual technical talk untouched", () => {
    assertUntouched(
      "We use Postgres for the main DB and Redis for cache. The connection lives in a secret manager.",
    );
  });

  it("leaves the WORD password alone (we redact values, not topics)", () => {
    assertUntouched(
      "The user's password should be hashed with bcrypt before storage.",
    );
  });

  it("leaves a public Postgres URL without credentials untouched", () => {
    assertUntouched("docs at https://postgresql.example.com/getting-started");
  });

  it("leaves discussion of API key handling untouched", () => {
    assertUntouched(
      "We rotate API keys monthly and store them in AWS Secrets Manager. Never commit OPENAI_API_KEY=... to git.",
    );
  });

  it("leaves a short non-key string starting with sk- alone", () => {
    // Below the OpenAI minimum length — must not match.
    assertUntouched("nickname: sk-master");
  });

  it("leaves a discussion mentioning AKIA as a prefix concept untouched", () => {
    assertUntouched("AWS access keys start with the prefix AKIA followed by 16 chars.");
  });

  it("leaves git commit hashes untouched", () => {
    assertUntouched(
      "see commit 9a38478e6f0ce8c3954c32679a173dcd181383c1 for context",
    );
  });

  it("leaves a normal HTTPS URL without auth untouched", () => {
    assertUntouched("docs: https://api.openai.com/v1/chat/completions");
  });
});

describe("redactSecrets — multi-secret behavior", () => {
  it("redacts every occurrence and reports counts", () => {
    const a = "sk-ant-api03-" + "a".repeat(95) + "AA";
    const b = "sk-ant-api03-" + "b".repeat(95) + "BB";
    const k = "AKIAIOSFODNN7EXAMPLE";
    const url = "postgresql://u:p@db/x";
    const text = `keys: ${a} and ${b} and ${k}; conn ${url}`;
    const out = redactSecrets(text);
    expect(out.text).not.toContain(a);
    expect(out.text).not.toContain(b);
    expect(out.text).not.toContain(k);
    expect(out.text).not.toContain(url);
    const counts = Object.fromEntries(out.events.map((e) => [e.kind, e.count]));
    expect(counts["anthropic"]).toBe(2);
    expect(counts["aws-access-key"]).toBe(1);
    expect(counts["db-url"]).toBe(1);
  });
});
