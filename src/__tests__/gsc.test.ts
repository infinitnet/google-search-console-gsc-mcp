import test from "node:test";
import assert from "node:assert/strict";
import { fetchSearchRows } from "../analytics.js";
import { indexNotify, periodCompare, propertiesList, sitemapSubmit, urlInspect } from "../gsc.js";
import { resetClientsForTests, setClientsForTests } from "../auth.js";

function chain<T>(value: T) {
  return async () => ({ data: value });
}

test.afterEach(() => resetClientsForTests());

function withEnv<T>(updates: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(updates).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("fetchSearchRows sends expected Search Console query body", async () => {
  const calls: any[] = [];
  const mock = {
    searchanalytics: {
      query: async (arg: any) => {
        calls.push(arg);
        return { data: { rows: [{ keys: ["query"], clicks: 3, impressions: 30, ctr: 0.1, position: 4.2 }] } };
      }
    }
  } as any;
  setClientsForTests({ searchConsole: mock });
  const rows = await fetchSearchRows({ siteUrl: "sc-domain:example.com", startDate: "2026-01-01", endDate: "2026-01-31", dimensions: ["query"], filters: [{ dimension: "country", operator: "equals", expression: "usa" }], rowLimit: 10 });
  assert.equal(rows[0]!.clicks, 3);
  assert.equal(calls[0].siteUrl, "sc-domain:example.com");
  assert.deepEqual(calls[0].requestBody.dimensions, ["query"]);
  assert.equal(calls[0].requestBody.dimensionFilterGroups[0].filters[0].expression, "usa");
});

test("propertiesList normalizes site entries", async () => {
  const mock = { sites: { list: chain({ siteEntry: [{ siteUrl: "https://example.com/", permissionLevel: "siteOwner" }] }) } } as any;
  setClientsForTests({ searchConsole: mock });
  assert.deepEqual(await propertiesList(), { count: 1, properties: [{ siteUrl: "https://example.com/", permissionLevel: "siteOwner" }] });
});

test("periodCompare reports CTR as percentage points consistently", async () => {
  let call = 0;
  const mock = {
    searchanalytics: {
      query: async () => {
        call += 1;
        return call === 1
          ? { data: { rows: [{ keys: ["https://example.com/a"], clicks: 20, impressions: 100, ctr: 0.2, position: 2 }] } }
          : { data: { rows: [{ keys: ["https://example.com/a"], clicks: 10, impressions: 100, ctr: 0.1, position: 3 }] } };
      }
    }
  } as any;
  setClientsForTests({ searchConsole: mock });

  const result = await periodCompare({ siteUrl: "sc-domain:example.com", days: 7, dimensions: ["page"], rowLimit: 10 });

  assert.equal(result.rows[0]!.current.ctr, 20);
  assert.equal(result.rows[0]!.prior.ctr, 10);
  assert.equal(result.rows[0]!.change.ctr, 10);
});

test("periodCompare preserves composite keys containing delimiter-like text", async () => {
  let call = 0;
  const key = ["query ||| value", "https://example.com/a|||b"];
  const mock = {
    searchanalytics: {
      query: async () => {
        call += 1;
        return call === 1
          ? { data: { rows: [{ keys: key, clicks: 20, impressions: 100, ctr: 0.2, position: 2 }] } }
          : { data: { rows: [{ keys: key, clicks: 10, impressions: 100, ctr: 0.1, position: 3 }] } };
      }
    }
  } as any;
  setClientsForTests({ searchConsole: mock });

  const result = await periodCompare({ siteUrl: "sc-domain:example.com", days: 7, dimensions: ["query", "page"], rowLimit: 10 });

  assert.deepEqual(result.rows[0]!.keys, key);
});

test("indexNotify respects the global write-tools opt-out", async () => {
  await withEnv({ GSC_ENABLE_WRITE_TOOLS: "false", GSC_ENABLE_INDEXING_API: undefined }, async () => {
    await assert.rejects(
      () => indexNotify({ url: "https://example.com/job/a" }),
      /disabled/
    );
  });
});

test("urlInspect calls URL Inspection API", async () => {
  const calls: any[] = [];
  const mock = { urlInspection: { index: { inspect: async (arg: any) => { calls.push(arg); return { data: { inspectionResult: { indexStatusResult: { verdict: "PASS" } } } }; } } } } as any;
  setClientsForTests({ searchConsole: mock });
  const result = await urlInspect({ siteUrl: "sc-domain:example.com", url: "https://example.com/a" });
  assert.equal(result.verdict, "PASS");
  assert.deepEqual(calls[0].requestBody, { siteUrl: "sc-domain:example.com", inspectionUrl: "https://example.com/a" });
});

test("sitemapSubmit respects the global write-tools opt-out", async () => {
  await withEnv({ GSC_ENABLE_WRITE_TOOLS: "false", GSC_ENABLE_SITEMAP_SUBMIT: undefined }, async () => {
    await assert.rejects(
      () => sitemapSubmit({ siteUrl: "https://example.com/", sitemapUrl: "https://example.com/sitemap.xml" }),
      /disabled/
    );
  });
});

test("sitemapSubmit calls sitemaps.submit by default", async () => {
  const calls: any[] = [];
  const mock = { sitemaps: { submit: async (arg: any) => { calls.push(arg); return { data: {} }; } } } as any;
  setClientsForTests({ searchConsole: mock });
  await withEnv({ GSC_ENABLE_WRITE_TOOLS: undefined, GSC_ENABLE_SITEMAP_SUBMIT: undefined }, async () => {
    const result = await sitemapSubmit({ siteUrl: "https://example.com/", sitemapUrl: "https://example.com/sitemap.xml" });
    assert.equal(result.submitted, true);
    assert.deepEqual(calls[0], { siteUrl: "https://example.com/", feedpath: "https://example.com/sitemap.xml" });
  });
});
