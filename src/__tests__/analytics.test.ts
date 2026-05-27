import test from "node:test";
import assert from "node:assert/strict";
import { dateRangeForDays, fetchSearchRowsWithMetadata, normalizeRows, pctChange, previousRange, summarizeRows } from "../analytics.js";
import { DEFAULT_CONFIG_DIR_NAME, getConfig, parseSiteUrls } from "../config.js";
import { ok } from "../response.js";
import { resetClientsForTests, setClientsForTests } from "../auth.js";

test.afterEach(() => resetClientsForTests());

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

test("fetchSearchRowsWithMetadata reports row-limit coverage and API limits", async () => {
  const requestBodies: any[] = [];
  const mock = {
    searchanalytics: {
      query: async ({ requestBody }: any) => {
        requestBodies.push(requestBody);
        return {
          data: {
            rows: [
              { keys: ["a"], clicks: 2, impressions: 20, ctr: 0.1, position: 3 },
              { keys: ["b"], clicks: 1, impressions: 10, ctr: 0.1, position: 5 }
            ]
          }
        };
      }
    }
  } as any;
  setClientsForTests({ searchConsole: mock });

  const result = await fetchSearchRowsWithMetadata({
    siteUrl: "sc-domain:example.com",
    startDate: "2026-01-01",
    endDate: "2026-01-02",
    dimensions: ["query"],
    rowLimit: 2
  }, true);

  assert.equal(result.rows.length, 2);
  assert.equal(result.sampling.coverageLabel, "top_returned_rows");
  assert.equal(result.sampling.requestedRowLimit, 2);
  assert.equal(result.sampling.rowsFetched, 2);
  assert.equal(result.sampling.limitReached, true);
  assert.equal(result.sampling.requestedLimitReached, true);
  assert.equal(result.sampling.possiblyTruncated, true);
  assert.equal(result.sampling.apiMayOmitRows, true);
  assert.equal(result.sampling.completeness, "capped_at_requested_limit");
  assert.equal(result.sampling.sortBasis, "clicks_descending_with_arbitrary_tie_order");
  assert.equal(result.sampling.apiLimits.maxRowsPerRequest, 25000);
  assert.equal(result.sampling.apiLimits.performanceRowsPerDayPerTypePerProperty, 50000);
  assert.deepEqual(requestBodies[0].dimensions, ["query"]);
  assert.deepEqual(result.sampling.responseRowCounts, [2]);
});

test("fetchSearchRowsWithMetadata reports date sort basis and incomplete coverage", async () => {
  const mock = {
    searchanalytics: {
      query: async () => ({
        data: { rows: [{ keys: ["2026-01-01"], clicks: 1, impressions: 10, ctr: 0.1, position: 4 }] }
      })
    }
  } as any;
  setClientsForTests({ searchConsole: mock });

  const result = await fetchSearchRowsWithMetadata({
    siteUrl: "sc-domain:example.com",
    startDate: "2026-01-01",
    endDate: "2026-01-02",
    dimensions: ["date"],
    rowLimit: 2
  }, true);

  assert.equal(result.sampling.sortBasis, "date_ascending");
  assert.equal(result.sampling.limitReached, false);
  assert.equal(result.sampling.requestedLimitReached, false);
  assert.equal(result.sampling.possiblyTruncated, false);
  assert.equal(result.sampling.apiMayOmitRows, true);
  assert.equal(result.sampling.completeness, "returned_less_than_requested_limit");
});

test("fetchSearchRowsWithMetadata clamps row limit and preserves start row", async () => {
  const requestBodies: any[] = [];
  const mock = {
    searchanalytics: {
      query: async ({ requestBody }: any) => {
        requestBodies.push(requestBody);
        return { data: { rows: [] } };
      }
    }
  } as any;
  setClientsForTests({ searchConsole: mock });

  const result = await fetchSearchRowsWithMetadata({
    siteUrl: "sc-domain:example.com",
    startDate: "2026-01-01",
    endDate: "2026-01-02",
    dimensions: ["query"],
    rowLimit: 999_999,
    startRow: 25_000
  }, true);

  assert.equal(requestBodies[0].rowLimit, 25000);
  assert.equal(requestBodies[0].startRow, 25000);
  assert.equal(result.sampling.requestedRowLimit, 25000);
  assert.equal(result.sampling.requestedStartRow, 25000);
  assert.equal(result.sampling.rowsFetched, 0);
});
