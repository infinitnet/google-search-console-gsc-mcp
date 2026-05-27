#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { authStatusSummary } from "./auth.js";
import { getConfig } from "./config.js";
import { fail, ok } from "./response.js";
import { propertiesList, propertyDetails, searchAnalyticsCustom, periodCompare, pageQueryBreakdown, urlInspect, urlInspectBatch, sitemapList, sitemapDetails, sitemapSubmit, indexNotify, indexNotifyBatch } from "./gsc.js";
import { actionPlan, alertScan, claimCheck, ctrGapCandidates, decayingPages, multiPropertyOverview, queryPageOverlap, rankLiftCandidates, sectionPerformance, siteHealthOverview, trafficLossDiagnostics, uncoveredDemand } from "./seo.js";

const server = new McpServer({ name: "infinitnet-google-search-console-gsc-mcp-server", version: "1.0.0" });

const siteUrl = z.string().optional().describe("Exact GSC property chosen from gsc_properties_list, e.g. sc-domain:example.com or https://www.example.com/. If omitted, the server uses optional GSC_SITE_URL fallback.");
const days = z.number().int().min(1).max(548).default(28).describe("Number of recent days to analyze, ending yesterday.");
const limit = z.number().int().min(1).max(200).default(50).describe("Maximum rows/items to return.");
const filterSchema = z.object({
  dimension: z.enum(["query", "page", "country", "device", "date", "searchAppearance"]),
  operator: z.enum(["contains", "notContains", "equals", "notEquals", "includingRegex", "excludingRegex"]),
  expression: z.string()
});

function register<I extends Record<string, unknown>, T>(
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>,
  handler: (input: I) => Promise<T>,
  notes: string[] = []
) {
  server.tool(name, description, schema, async (input) => {
    try {
      const data = await handler(input as I);
      const resolvedSite = typeof input.site_url === "string" ? input.site_url : undefined;
      return ok(name, input, data, notes, resolvedSite);
    } catch (error) {
      const resolvedSite = typeof input.site_url === "string" ? input.site_url : getConfig().siteUrl;
      return fail(name, input, error, undefined, resolvedSite);
    }
  });
}

register("gsc_server_guide", "Summarize Infinitnet Google Search Console (GSC) MCP Server capabilities, auth configuration, property-selection workflow, available tool groups, and setup hints. Call this first when discovering what the GSC MCP can do.", {}, async () => ({
  auth: authStatusSummary(),
  configuredFallbackSites: getConfig().siteUrls,
  recommendedWorkflow: ["Call gsc_properties_list to list accessible Search Console properties.", "Choose the exact property matching the user request.", "Pass that property string as site_url in each follow-up tool call."],
  dataState: getConfig().dataState,
  toolGroups: {
    setup: ["gsc_server_guide", "gsc_properties_list", "gsc_property_get"],
    analytics: ["gsc_search_query", "gsc_period_compare", "gsc_page_queries"],
    technical: ["gsc_url_inspect", "gsc_url_inspect_batch", "gsc_indexing_issue_scan", "gsc_sitemaps_list", "gsc_sitemap_get", "gsc_sitemap_submit"],
    seo: ["gsc_site_health", "gsc_rank_lift_opportunities", "gsc_ctr_gap_pages", "gsc_uncovered_queries", "gsc_traffic_loss", "gsc_content_decay", "gsc_query_overlap", "gsc_section_performance", "gsc_alert_scan", "gsc_action_plan", "gsc_claim_check", "gsc_multi_property_health"],
    indexingApi: ["gsc_index_notify", "gsc_index_notify_batch"]
  }
}));

register("gsc_properties_list", "List Search Console properties visible to the authenticated account, including exact property identifiers to pass to other tools.", {}, propertiesList);
register("gsc_property_get", "Fetch permission and raw property details for one exact Search Console property.", { site_url: siteUrl }, (i: { site_url?: string }) => propertyDetails(i.site_url));

register("gsc_search_query", "Run a flexible Search Console performance query with dimensions, filters, sorting, and row limits.", {
  site_url: siteUrl,
  days,
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  dimensions: z.array(z.string()).default(["query"]),
  filters: z.array(filterSchema).default([]),
  row_limit: z.number().int().min(1).max(25000).default(100),
  start_row: z.number().int().min(0).default(0),
  sort_by: z.enum(["clicks", "impressions", "ctr", "position"]).default("clicks"),
  sort_direction: z.enum(["asc", "desc"]).default("desc")
}, (i: any) => searchAnalyticsCustom({ siteUrl: i.site_url, days: i.days, startDate: i.start_date, endDate: i.end_date, dimensions: i.dimensions, filters: i.filters, rowLimit: i.row_limit, startRow: i.start_row, sortBy: i.sort_by, sortDirection: i.sort_direction }));

register("gsc_period_compare", "Compare Search Console metrics for a current period against the immediately preceding period, grouped by dimensions.", { site_url: siteUrl, days, dimensions: z.array(z.string()).default(["page"]), filters: z.array(filterSchema).default([]), row_limit: z.number().int().min(1).max(25000).default(250) }, (i: any) => periodCompare({ siteUrl: i.site_url, days: i.days, dimensions: i.dimensions, filters: i.filters, rowLimit: i.row_limit }));
register("gsc_page_queries", "Show which search queries drive impressions and clicks for a specific page URL.", { site_url: siteUrl, page_url: z.string().url(), days, row_limit: z.number().int().min(1).max(1000).default(100) }, (i: any) => pageQueryBreakdown({ siteUrl: i.site_url, pageUrl: i.page_url, days: i.days, rowLimit: i.row_limit }));

register("gsc_url_inspect", "Inspect one URL with Google's URL Inspection API and normalize indexing, crawl, canonical, robots, and rich result signals.", { site_url: siteUrl, url: z.string().url() }, (i: any) => urlInspect({ siteUrl: i.site_url, url: i.url }));
register("gsc_url_inspect_batch", "Inspect up to ten URLs and return per-URL indexing summaries without failing the whole batch on one bad URL.", { site_url: siteUrl, urls: z.array(z.string().url()).min(1).max(10) }, (i: any) => urlInspectBatch({ siteUrl: i.site_url, urls: i.urls }));
register("gsc_indexing_issue_scan", "Inspect up to ten URLs and return only URLs with indexing/crawl/canonical/rich-result issues.", { site_url: siteUrl, urls: z.array(z.string().url()).min(1).max(10) }, async (i: any) => {
  const batch = await urlInspectBatch({ siteUrl: i.site_url, urls: i.urls });
  return { ...batch, problemUrls: batch.results.filter((r: any) => r.error || (Array.isArray(r.issues) && r.issues.length > 0)) };
});
register("gsc_sitemaps_list", "List submitted sitemaps for a property with status counts and content metadata.", { site_url: siteUrl }, (i: any) => sitemapList({ siteUrl: i.site_url }));
register("gsc_sitemap_get", "Fetch details for one sitemap URL/path inside a Search Console property.", { site_url: siteUrl, sitemap_url: z.string() }, (i: any) => sitemapDetails({ siteUrl: i.site_url, sitemapUrl: i.sitemap_url }));
register("gsc_sitemap_submit", "Submit or resubmit a sitemap URL to Google Search Console for the selected property.", { site_url: siteUrl, sitemap_url: z.string().url() }, (i: any) => sitemapSubmit({ siteUrl: i.site_url, sitemapUrl: i.sitemap_url }), ["This is a write operation to Search Console but is safe/idempotent for sitemap notification."]);

register("gsc_site_health", "Return high-level search performance health with current/prior clicks, impressions, CTR, position, and deltas.", { site_url: siteUrl, days }, (i: any) => siteHealthOverview({ siteUrl: i.site_url, days: i.days }));
register("gsc_rank_lift_opportunities", "Find query-page pairs ranking near page one where rank improvement could produce the largest click lift.", { site_url: siteUrl, days, min_impressions: z.number().int().min(1).default(100), max_position: z.number().min(4).max(50).default(15), limit }, (i: any) => rankLiftCandidates({ siteUrl: i.site_url, days: i.days, minImpressions: i.min_impressions, maxPosition: i.max_position, limit: i.limit }));
register("gsc_ctr_gap_pages", "Find pages whose click-through rate trails a position-based benchmark, prioritized by estimated lost clicks.", { site_url: siteUrl, days, min_impressions: z.number().int().min(1).default(300), limit }, (i: any) => ctrGapCandidates({ siteUrl: i.site_url, days: i.days, minImpressions: i.min_impressions, limit: i.limit }), ["CTR benchmarks are heuristic estimates, not Google-provided ground truth."]);
register("gsc_uncovered_queries", "Surface high-impression queries where the site appears but ranks poorly, indicating possible unmet content demand.", { site_url: siteUrl, days: z.number().int().min(1).max(548).default(90), min_impressions: z.number().int().min(1).default(50), min_position: z.number().min(1).default(20), limit }, (i: any) => uncoveredDemand({ siteUrl: i.site_url, days: i.days, minImpressions: i.min_impressions, minPosition: i.min_position, limit: i.limit }));
register("gsc_traffic_loss", "Diagnose pages with the largest recent click losses and classify likely ranking, CTR, demand, or disappearance causes.", { site_url: siteUrl, days, min_prior_clicks: z.number().int().min(1).default(5), limit }, (i: any) => trafficLossDiagnostics({ siteUrl: i.site_url, days: i.days, minPriorClicks: i.min_prior_clicks, limit: i.limit }));
register("gsc_content_decay", "Find pages with three consecutive 30-day click declines and explain whether rankings, CTR, or demand likely changed.", { site_url: siteUrl, min_oldest_clicks: z.number().int().min(1).default(10), limit }, (i: any) => decayingPages({ siteUrl: i.site_url, minOldestClicks: i.min_oldest_clicks, limit: i.limit }));
register("gsc_query_overlap", "Find two-page query and impression overlap, scoring cannibalization severity by relative balanced overlap while using absolute overlap only as a materiality guard.", { site_url: siteUrl, days, min_impressions: z.number().int().min(1).default(50), min_pages: z.number().int().min(2).default(2), min_overlap_impressions: z.number().int().min(1).default(10), min_overlap_percent: z.number().min(0).max(100).default(1), limit }, (i: any) => queryPageOverlap({ siteUrl: i.site_url, days: i.days, minImpressions: i.min_impressions, minPages: i.min_pages, minOverlapImpressions: i.min_overlap_impressions, minOverlapPercent: i.min_overlap_percent, limit: i.limit }));
register("gsc_section_performance", "Analyze all pages matching a URL path fragment as a content section, with aggregate metrics plus top pages and queries.", { site_url: siteUrl, path_contains: z.string().min(1), days, limit: z.number().int().min(1).max(50).default(10) }, (i: any) => sectionPerformance({ siteUrl: i.site_url, pathContains: i.path_contains, days: i.days, limit: i.limit }));
register("gsc_alert_scan", "Scan recent performance for material click losses, position drops, and CTR drops using configurable thresholds.", { site_url: siteUrl, days: z.number().int().min(1).max(90).default(7), position_drop: z.number().min(1).default(10), ctr_drop_percent: z.number().min(1).default(30), click_drop_percent: z.number().min(1).default(30) }, (i: any) => alertScan({ siteUrl: i.site_url, days: i.days, positionDrop: i.position_drop, ctrDropPercent: i.ctr_drop_percent, clickDropPercent: i.click_drop_percent }));
register("gsc_action_plan", "Combine ranking, CTR, demand-gap, overlap, and decay signals into prioritized SEO action recommendations.", { site_url: siteUrl, days, limit: z.number().int().min(1).max(30).default(15) }, (i: any) => actionPlan({ siteUrl: i.site_url, days: i.days, limit: i.limit }), ["Recommendations are deterministic heuristics based on Search Console data; review before implementation."]);
register("gsc_claim_check", "Re-query Search Console to verify a numeric claim before presenting it as fact.", { site_url: siteUrl, claim: z.string().min(1), metric: z.enum(["clicks", "impressions", "ctr", "position"]), expected: z.number(), days, page_url: z.string().url().optional(), query: z.string().optional() }, (i: any) => claimCheck({ siteUrl: i.site_url, claim: i.claim, metric: i.metric, expected: i.expected, days: i.days, pageUrl: i.page_url, query: i.query }));
register("gsc_multi_property_health", "Compare health summaries across multiple Search Console properties configured for one account or agency workflow.", { site_urls: z.array(z.string()).optional(), days }, (i: any) => multiPropertyOverview({ siteUrls: i.site_urls, days: i.days }));

register("gsc_index_notify", "Notify Google's Indexing API about one URL update or deletion, returning Google's notification metadata.", { url: z.string().url(), action: z.enum(["URL_UPDATED", "URL_DELETED"]).default("URL_UPDATED") }, (i: any) => indexNotify({ url: i.url, action: i.action }), ["Google documents the Indexing API for JobPosting and BroadcastEvent-in-VideoObject pages; acceptance does not guarantee crawling or ranking changes."]);
register("gsc_index_notify_batch", "Notify Google's Indexing API about up to 200 URL updates/deletions and return per-URL success or failure.", { urls: z.array(z.string().url()).min(1).max(200), action: z.enum(["URL_UPDATED", "URL_DELETED"]).default("URL_UPDATED") }, (i: any) => indexNotifyBatch({ urls: i.urls, action: i.action }), ["Google documents the Indexing API for JobPosting and BroadcastEvent-in-VideoObject pages; daily quotas apply."]);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("GSC MCP server failed:", error);
    process.exit(1);
  });
}

export { server };
