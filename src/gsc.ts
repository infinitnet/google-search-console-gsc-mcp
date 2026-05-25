import type { DimensionFilter, SearchDimension, SearchRow } from "./types.js";
import { getConfig, resolveSiteUrl } from "./config.js";
import { getIndexingClient, getSearchConsoleClient } from "./auth.js";
import { dateRangeForDays, fetchSearchRows, previousRange, summarizeRows, validDimensions } from "./analytics.js";

export async function propertiesList() {
  const client = await getSearchConsoleClient();
  const response = await client.sites.list();
  const properties = (response.data.siteEntry ?? []).map((entry) => ({
    siteUrl: entry.siteUrl ?? "",
    permissionLevel: entry.permissionLevel ?? "unknown"
  }));
  return { count: properties.length, properties };
}

export async function propertyDetails(siteUrlInput?: string) {
  const siteUrl = resolveSiteUrl(siteUrlInput);
  const client = await getSearchConsoleClient();
  const response = await client.sites.get({ siteUrl });
  return { siteUrl, permissionLevel: response.data.permissionLevel ?? "unknown", raw: response.data };
}

export async function searchAnalyticsCustom(input: {
  siteUrl?: string;
  days?: number;
  startDate?: string;
  endDate?: string;
  dimensions?: string[];
  filters?: DimensionFilter[];
  rowLimit?: number;
  startRow?: number;
  sortBy?: "clicks" | "impressions" | "ctr" | "position";
  sortDirection?: "asc" | "desc";
}) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const range = input.startDate && input.endDate ? { startDate: input.startDate, endDate: input.endDate } : dateRangeForDays(input.days ?? 28);
  const dimensions = validDimensions(input.dimensions ?? ["query"]);
  const rows = await fetchSearchRows({ siteUrl, ...range, dimensions, filters: input.filters, rowLimit: input.rowLimit ?? 100, startRow: input.startRow }, false);
  const sorted = sortRows(rows, input.sortBy ?? "clicks", input.sortDirection ?? "desc");
  return { siteUrl, range, dimensions, totalReturned: sorted.length, rows: labelRows(sorted, dimensions) };
}

export async function periodCompare(input: { siteUrl?: string; days?: number; dimensions?: string[]; filters?: DimensionFilter[]; rowLimit?: number }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const days = input.days ?? 28;
  const current = dateRangeForDays(days);
  const prior = previousRange(days);
  const dimensions = validDimensions(input.dimensions ?? ["page"]);
  const [currentRows, priorRows] = await Promise.all([
    fetchSearchRows({ siteUrl, ...current, dimensions, filters: input.filters, rowLimit: input.rowLimit ?? 250 }, true),
    fetchSearchRows({ siteUrl, ...prior, dimensions, filters: input.filters, rowLimit: input.rowLimit ?? 250 }, true)
  ]);
  const priorMap = new Map(priorRows.map((row) => [row.keys.join("|||"), row]));
  const currentMap = new Map(currentRows.map((row) => [row.keys.join("|||"), row]));
  const keys = new Set([...currentMap.keys(), ...priorMap.keys()]);
  const comparisons = [...keys].map((key) => {
    const c = currentMap.get(key);
    const p = priorMap.get(key);
    return { keys: key.split("|||"), current: c ? metrics(c) : emptyMetrics(), prior: p ? metrics(p) : emptyMetrics(), change: compareMetrics(c, p) };
  }).sort((a, b) => a.change.clicks - b.change.clicks);
  return { siteUrl, current, prior, dimensions, summary: { current: summarizeRows(currentRows), prior: summarizeRows(priorRows) }, rows: comparisons };
}

export async function pageQueryBreakdown(input: { siteUrl?: string; pageUrl: string; days?: number; rowLimit?: number }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const range = dateRangeForDays(input.days ?? 28);
  const rows = await fetchSearchRows({
    siteUrl,
    ...range,
    dimensions: ["query"],
    filters: [{ dimension: "page", operator: "equals", expression: input.pageUrl }],
    rowLimit: input.rowLimit ?? 100
  }, false);
  return { siteUrl, pageUrl: input.pageUrl, range, summary: summarizeRows(rows), queries: labelRows(sortRows(rows, "clicks", "desc"), ["query"]) };
}

export async function urlInspect(input: { siteUrl?: string; url: string }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const client = await getSearchConsoleClient();
  const response = await client.urlInspection.index.inspect({ requestBody: { siteUrl, inspectionUrl: input.url } });
  const result = response.data.inspectionResult;
  const index = result?.indexStatusResult;
  const rich = result?.richResultsResult;
  return {
    siteUrl,
    url: input.url,
    inspectionResultLink: result?.inspectionResultLink ?? null,
    verdict: index?.verdict ?? "UNKNOWN",
    coverageState: index?.coverageState ?? null,
    indexingState: index?.indexingState ?? null,
    lastCrawlTime: index?.lastCrawlTime ?? null,
    pageFetchState: index?.pageFetchState ?? null,
    robotsTxtState: index?.robotsTxtState ?? null,
    crawledAs: index?.crawledAs ?? null,
    googleCanonical: index?.googleCanonical ?? null,
    userCanonical: index?.userCanonical ?? null,
    referringUrls: index?.referringUrls ?? [],
    richResults: rich ? { verdict: rich.verdict, detectedItems: rich.detectedItems ?? [] } : null,
    issues: inspectionIssues(index, rich)
  };
}

export async function urlInspectBatch(input: { siteUrl?: string; urls: string[] }) {
  const urls = input.urls.slice(0, 10);
  const results = [];
  for (const url of urls) {
    try { results.push(await urlInspect({ siteUrl: input.siteUrl, url })); }
    catch (error) { results.push({ url, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { count: results.length, limit: 10, results };
}

export async function sitemapList(input: { siteUrl?: string }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const client = await getSearchConsoleClient();
  const response = await client.sitemaps.list({ siteUrl });
  return {
    siteUrl,
    count: response.data.sitemap?.length ?? 0,
    sitemaps: (response.data.sitemap ?? []).map((sitemap) => ({
      path: sitemap.path,
      lastSubmitted: sitemap.lastSubmitted ?? null,
      isPending: Boolean(sitemap.isPending),
      lastDownloaded: sitemap.lastDownloaded ?? null,
      warnings: Number(sitemap.warnings ?? 0),
      errors: Number(sitemap.errors ?? 0),
      contents: sitemap.contents ?? []
    }))
  };
}

export async function sitemapDetails(input: { siteUrl?: string; sitemapUrl: string }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const client = await getSearchConsoleClient();
  const response = await client.sitemaps.get({ siteUrl, feedpath: input.sitemapUrl });
  return { siteUrl, sitemapUrl: input.sitemapUrl, sitemap: response.data };
}

export async function sitemapSubmit(input: { siteUrl?: string; sitemapUrl: string }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const client = await getSearchConsoleClient();
  await client.sitemaps.submit({ siteUrl, feedpath: input.sitemapUrl });
  return { siteUrl, sitemapUrl: input.sitemapUrl, submitted: true };
}

export async function indexNotify(input: { url: string; action?: "URL_UPDATED" | "URL_DELETED" }) {
  const client = await getIndexingClient();
  const response = await client.urlNotifications.publish({ requestBody: { url: input.url, type: input.action ?? "URL_UPDATED" } });
  return { url: input.url, action: input.action ?? "URL_UPDATED", metadata: response.data.urlNotificationMetadata ?? null };
}

export async function indexNotifyBatch(input: { urls: string[]; action?: "URL_UPDATED" | "URL_DELETED" }) {
  if (input.urls.length > 200) throw new Error("Indexing API batch limit is 200 URLs per request set.");
  const results = [];
  for (const url of input.urls) {
    try { results.push({ ok: true, ...(await indexNotify({ url, action: input.action })) }); }
    catch (error) { results.push({ ok: false, url, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { total: input.urls.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

function inspectionIssues(index: NonNullable<Awaited<ReturnType<typeof getSearchConsoleClient>>> extends never ? never : any, rich: any): string[] {
  const issues: string[] = [];
  if (!index) return ["No index status returned by URL Inspection API."];
  if (index.verdict && index.verdict !== "PASS") issues.push(`Index verdict: ${index.verdict}`);
  if (index.robotsTxtState && index.robotsTxtState !== "ALLOWED") issues.push(`robots.txt: ${index.robotsTxtState}`);
  if (index.indexingState && index.indexingState !== "INDEXING_ALLOWED") issues.push(`indexing state: ${index.indexingState}`);
  if (index.googleCanonical && index.userCanonical && index.googleCanonical !== index.userCanonical) issues.push("Google-selected canonical differs from declared canonical.");
  if (rich?.verdict && rich.verdict !== "PASS") issues.push(`Rich results verdict: ${rich.verdict}`);
  return issues;
}

function metrics(row: SearchRow) { return { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }; }
function emptyMetrics() { return { clicks: 0, impressions: 0, ctr: 0, position: 0 }; }
function compareMetrics(current?: SearchRow, prior?: SearchRow) {
  return {
    clicks: (current?.clicks ?? 0) - (prior?.clicks ?? 0),
    impressions: (current?.impressions ?? 0) - (prior?.impressions ?? 0),
    ctr: Number(((current?.ctr ?? 0) - (prior?.ctr ?? 0)).toFixed(4)),
    position: Number(((current?.position ?? 0) - (prior?.position ?? 0)).toFixed(2))
  };
}

export function sortRows(rows: SearchRow[], by: "clicks" | "impressions" | "ctr" | "position", direction: "asc" | "desc") {
  return [...rows].sort((a, b) => (a[by] - b[by]) * (direction === "asc" ? 1 : -1));
}

export function labelRows(rows: SearchRow[], dimensions: SearchDimension[]) {
  return rows.map((row) => ({
    dimensions: Object.fromEntries(dimensions.map((dimension, index) => [dimension, row.keys[index] ?? null])),
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Number((row.ctr * 100).toFixed(2)),
    position: Number(row.position.toFixed(1))
  }));
}
