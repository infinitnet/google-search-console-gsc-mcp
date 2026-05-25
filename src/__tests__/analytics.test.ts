import test from "node:test";
import assert from "node:assert/strict";
import { dateRangeForDays, normalizeRows, pctChange, summarizeRows } from "../analytics.js";
import { parseSiteUrls } from "../config.js";
import { ok } from "../response.js";

test("summarizeRows computes weighted CTR and weighted average position", () => {
  const rows = normalizeRows([
    { keys: ["a"], clicks: 10, impressions: 100, ctr: 0.1, position: 2 },
    { keys: ["b"], clicks: 5, impressions: 50, ctr: 0.1, position: 8 }
  ]);
  assert.deepEqual(summarizeRows(rows), { clicks: 15, impressions: 150, ctr: 10, position: 4 });
});

test("pctChange avoids Infinity for zero prior", () => {
  assert.equal(pctChange(0, 0), 0);
  assert.equal(pctChange(10, 0), null);
  assert.equal(pctChange(75, 100), -25);
});

test("dateRangeForDays returns inclusive ISO range ending yesterday by default", () => {
  const range = dateRangeForDays(28);
  assert.match(range.startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(range.endDate, /^\d{4}-\d{2}-\d{2}$/);
  const start = Date.parse(range.startDate);
  const end = Date.parse(range.endDate);
  assert.equal((end - start) / 86_400_000, 27);
});

test("parseSiteUrls trims comma-separated values", () => {
  assert.deepEqual(parseSiteUrls(" sc-domain:a.com, https://b.com/ ,,"), ["sc-domain:a.com", "https://b.com/"]);
});

test("ok response envelope is structured JSON text", () => {
  const response = ok("tool", { a: 1 }, { result: true });
  const payload = JSON.parse(response.content[0]!.text);
  assert.equal(payload.ok, true);
  assert.equal(payload.tool, "tool");
  assert.deepEqual(payload.data, { result: true });
  assert.ok(payload.meta.generatedAt);
});
