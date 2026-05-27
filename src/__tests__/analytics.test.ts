import test from "node:test";
import assert from "node:assert/strict";
import { dateRangeForDays, normalizeRows, pctChange, previousRange, summarizeRows } from "../analytics.js";
import { DEFAULT_CONFIG_DIR_NAME, getConfig, parseSiteUrls } from "../config.js";
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

test("date ranges clamp invalid or excessive day counts safely", () => {
  const current = dateRangeForDays(Number.NaN);
  const currentStart = Date.parse(current.startDate);
  const currentEnd = Date.parse(current.endDate);
  assert.equal((currentEnd - currentStart) / 86_400_000, 27);

  const prior = previousRange(10_000);
  const priorStart = Date.parse(prior.startDate);
  const priorEnd = Date.parse(prior.endDate);
  assert.equal((priorEnd - priorStart) / 86_400_000, 547);
});

test("normalizeRows coerces non-finite numeric values to zero", () => {
  const [row] = normalizeRows([{ keys: ["bad"], clicks: Number.NaN, impressions: Infinity, ctr: -Infinity, position: Number.NaN }]);
  assert.deepEqual(row, { keys: ["bad"], clicks: 0, impressions: 0, ctr: 0, position: 0 });
});

test("parseSiteUrls trims comma-separated values", () => {
  assert.deepEqual(parseSiteUrls(" sc-domain:a.com, https://b.com/ ,,"), ["sc-domain:a.com", "https://b.com/"]);
});

test("default OAuth token path uses the branded config directory", () => {
  const previousConfigDir = process.env.GSC_CONFIG_DIR;
  const previousTokenFile = process.env.GSC_OAUTH_TOKEN_FILE;
  const previousWriteTools = process.env.GSC_ENABLE_WRITE_TOOLS;
  delete process.env.GSC_CONFIG_DIR;
  delete process.env.GSC_OAUTH_TOKEN_FILE;
  delete process.env.GSC_ENABLE_WRITE_TOOLS;
  try {
    const config = getConfig();
    assert.match(config.oauthTokenFile, new RegExp(`${DEFAULT_CONFIG_DIR_NAME}/oauth-token\\.json$`));
    assert.equal(config.writeToolsEnabled, true);
  } finally {
    if (previousConfigDir === undefined) delete process.env.GSC_CONFIG_DIR;
    else process.env.GSC_CONFIG_DIR = previousConfigDir;
    if (previousTokenFile === undefined) delete process.env.GSC_OAUTH_TOKEN_FILE;
    else process.env.GSC_OAUTH_TOKEN_FILE = previousTokenFile;
    if (previousWriteTools === undefined) delete process.env.GSC_ENABLE_WRITE_TOOLS;
    else process.env.GSC_ENABLE_WRITE_TOOLS = previousWriteTools;
  }
});

test("ok response envelope is structured JSON text", () => {
  const response = ok("tool", { a: 1 }, { result: true });
  const payload = JSON.parse(response.content[0]!.text);
  assert.equal(payload.ok, true);
  assert.equal(payload.tool, "tool");
  assert.deepEqual(payload.data, { result: true });
  assert.ok(payload.meta.generatedAt);
});
