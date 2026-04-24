// Shared output format all importers normalize into. Downstream code
// (database upsert, Phase 4 terraforming) sees only this shape — never the
// vendor-specific raw export.

export type NormalizedRole = "user" | "assistant" | "system" | "tool";

export type NormalizedMessage = {
  role: NormalizedRole;
  text: string;
  createdAt?: Date;
};

export type NormalizedArtifact = {
  kind: "code" | "document" | "image" | "diagram";
  title: string;
  content: string;
};

export type NormalizedConversation = {
  source: "chatgpt" | "claude" | "claude_code" | "cursor" | "manual";
  // Upstream identifier, used for deduplication on re-import.
  externalId: string;
  title: string;
  createdAt?: Date;
  messages: NormalizedMessage[];
  artifacts?: NormalizedArtifact[];
  metadata?: Record<string, unknown>;
};

export type ParseIssue =
  | { level: "warning"; code: string; message: string; conversationId?: string }
  | { level: "error"; code: string; message: string; conversationId?: string };

export type ParseResult = {
  conversations: NormalizedConversation[];
  issues: ParseIssue[];
};
