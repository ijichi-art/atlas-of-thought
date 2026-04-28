import { describe, expect, it } from "vitest";
import { repairTruncatedJson } from "./terraform";

describe("repairTruncatedJson", () => {
  it("returns null for irrecoverable garbage", () => {
    expect(repairTruncatedJson("just plain text")).toBeNull();
  });

  it("returns null when the FIRST top-level array never closes (no field ever completed)", () => {
    // Truncated mid-second element of countries[]. The countries array
    // hasn't closed yet, so no top-level field has completed — irrecoverable.
    // This matches reality: real LLM truncation usually happens deep into
    // cities[], by which point countries[] has long since closed.
    const truncated = `{
  "countries": [
    {
      "name": "Architectura",
      "theme": "design",
      "color": "#a",
      "districts": [{ "name": "D", "cityIndexes": [0, 1] }]
    },
    {
      "name": "Cogni`;
    expect(repairTruncatedJson(truncated)).toBeNull();
  });

  it("recovers a complete first top-level field even when later fields are truncated", () => {
    // countries is fully closed; cities is truncated mid-element.
    const truncated = `{
  "countries": [{ "name": "X", "theme": "t", "districts": [] }],
  "cities": [
    { "conversationIndex": 0, "topic": "a", "summary": "b", "rank": "capital" },
    { "conversationIndex": 1, "topic": "c", "summa`;
    const out = repairTruncatedJson(truncated) as {
      countries: unknown[];
      cities?: unknown[];
    };
    expect(out).not.toBeNull();
    expect(out.countries).toHaveLength(1);
    // cities field's array might or might not be retained depending on where
    // the snip lands, but the outer JSON must be valid.
  });

  it("recovers when the truncation is inside a nested string with escapes", () => {
    // A string containing a stray '"' would normally break our depth tracker,
    // but escape-aware parsing keeps it correct.
    const truncated = `{
  "countries": [{ "name": "She said \\"hi\\"", "theme": "t", "districts": [] }],
  "cities": [
    { "conversationIndex": 0, "topic": "a"`;
    const out = repairTruncatedJson(truncated) as { countries: unknown[] };
    expect(out).not.toBeNull();
    expect(out.countries).toHaveLength(1);
  });

  it("returns null when even the first top-level field never completes", () => {
    const truncated = `{
  "countries": [
    { "name": "Architectura", "theme": "design"`;
    expect(repairTruncatedJson(truncated)).toBeNull();
  });
});
