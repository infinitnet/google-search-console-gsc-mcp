import test from "node:test";
import assert from "node:assert/strict";
import { fetchSearchRows } from "../analytics.js";
import { propertiesList, sitemapSubmit, urlInspect } from "../gsc.js";
import { resetClientsForTests, setClientsForTests } from "../auth.js";

function chain<T>(value: T) {
  return async () => ({ data: value });
}

test.afterEach(() => resetClientsForTests());

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

test("urlInspect calls URL Inspection API", async () => {
  const calls: any[] = [];
  const mock = { urlInspection: { index: { inspect: async (arg: any) => { calls.push(arg); return { data: { inspectionResult: { indexStatusResult: { verdict: "PASS" } } } }; } } } } as any;
  setClientsForTests({ searchConsole: mock });
  const result = await urlInspect({ siteUrl: "sc-domain:example.com", url: "https://example.com/a" });
  assert.equal(result.verdict, "PASS");
  assert.deepEqual(calls[0].requestBody, { siteUrl: "sc-domain:example.com", inspectionUrl: "https://example.com/a" });
});

test("sitemapSubmit calls sitemaps.submit", async () => {
  const calls: any[] = [];
  const mock = { sitemaps: { submit: async (arg: any) => { calls.push(arg); return { data: {} }; } } } as any;
  setClientsForTests({ searchConsole: mock });
  const result = await sitemapSubmit({ siteUrl: "https://example.com/", sitemapUrl: "https://example.com/sitemap.xml" });
  assert.equal(result.submitted, true);
  assert.deepEqual(calls[0], { siteUrl: "https://example.com/", feedpath: "https://example.com/sitemap.xml" });
});
