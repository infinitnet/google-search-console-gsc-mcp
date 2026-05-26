import type { DimensionFilter, SearchRow } from "./types.js";
import { dateRangeForDays, fetchSearchRows, previousRange, pctChange, round, summarizeRows } from "./analytics.js";
import { getConfig, resolveSiteUrl } from "./config.js";

const CTR_CURVE = [0.285, 0.157, 0.11, 0.08, 0.072, 0.051, 0.04, 0.032, 0.028, 0.025];

export function expectedCtr(position: number): number {
  if (position <= 1) return CTR_CURVE[0]!;
  if (position <= 10) return CTR_CURVE[Math.max(0, Math.ceil(position) - 1)]!;
  return Math.max(0.005, 0.025 - (position - 10) * 0.002);
}

export async function siteHealthOverview(input: { siteUrl?: string; days?: number }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const days = input.days ?? 28;
  const current = dateRangeForDays(days);
  const prior = previousRange(days);
  const [currentRows, priorRows] = await Promise.all([
    fetchSearchRows({ siteUrl, ...current, dimensions: ["date"], rowLimit: days }, true),
    fetchSearchRows({ siteUrl, ...prior, dimensions: ["date"], rowLimit: days }, true)
  ]);
  const c = summarizeRows(currentRows);
  const p = summarizeRows(priorRows);
  return {
    siteUrl,
    currentRange: current,
    priorRange: prior,
    current: c,
    prior: p,
    change: {
      clicks: c.clicks - p.clicks,
      clicksPercent: pctChange(c.clicks, p.clicks),
      impressions: c.impressions - p.impressions,
      impressionsPercent: pctChange(c.impressions, p.impressions),
      ctrPoints: round(c.ctr - p.ctr, 2),
      position: round(c.position - p.position, 1)
    }
  };
}

export async function rankLiftCandidates(input: { siteUrl?: string; days?: number; minImpressions?: number; maxPosition?: number; limit?: number }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const range = dateRangeForDays(input.days ?? 28);
  const rows = await fetchSearchRows({ siteUrl, ...range, dimensions: ["query", "page"], rowLimit: 5000 }, true);
  const minImpressions = input.minImpressions ?? 100;
  const maxPosition = input.maxPosition ?? 15;
  return rows
    .filter((row) => row.impressions >= minImpressions && row.position >= 4 && row.position <= maxPosition)
    .map((row) => ({
      query: row.keys[0],
      page: row.keys[1],
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: round(row.ctr * 100, 2),
      position: round(row.position, 1),
      estimatedExtraClicks: Math.max(0, Math.round(row.impressions * (expectedCtr(3) - row.ctr)))
    }))
    .sort((a, b) => b.estimatedExtraClicks - a.estimatedExtraClicks)
    .slice(0, input.limit ?? 50);
}

export async function ctrGapCandidates(input: { siteUrl?: string; days?: number; minImpressions?: number; limit?: number }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const range = dateRangeForDays(input.days ?? 28);
  const rows = await fetchSearchRows({ siteUrl, ...range, dimensions: ["page"], rowLimit: 5000 }, true);
  const minImpressions = input.minImpressions ?? 300;
  return rows
    .filter((row) => row.impressions >= minImpressions && row.position <= 20)
    .map((row) => {
      const benchmark = expectedCtr(row.position);
      const gap = benchmark - row.ctr;
      return {
        page: row.keys[0],
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: round(row.ctr * 100, 2),
        position: round(row.position, 1),
        benchmarkCtr: round(benchmark * 100, 2),
        ctrGapPoints: round(gap * 100, 2),
        estimatedExtraClicks: Math.max(0, Math.round(row.impressions * gap))
      };
    })
    .filter((row) => row.estimatedExtraClicks > 0)
    .sort((a, b) => b.estimatedExtraClicks - a.estimatedExtraClicks)
    .slice(0, input.limit ?? 50);
}

export async function uncoveredDemand(input: { siteUrl?: string; days?: number; minImpressions?: number; minPosition?: number; limit?: number }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const range = dateRangeForDays(input.days ?? 90);
  const rows = await fetchSearchRows({ siteUrl, ...range, dimensions: ["query"], rowLimit: 5000 }, true);
  return rows
    .filter((row) => row.impressions >= (input.minImpressions ?? 50) && row.position >= (input.minPosition ?? 20))
    .map((row) => ({ query: row.keys[0], clicks: row.clicks, impressions: row.impressions, position: round(row.position, 1), suggestedIntent: inferIntent(row.keys[0] ?? "") }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, input.limit ?? 50);
}

export async function trafficLossDiagnostics(input: { siteUrl?: string; days?: number; minPriorClicks?: number; limit?: number }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const days = input.days ?? 28;
  const current = dateRangeForDays(days);
  const prior = previousRange(days);
  const [currentRows, priorRows] = await Promise.all([
    fetchSearchRows({ siteUrl, ...current, dimensions: ["page"], rowLimit: 5000 }, true),
    fetchSearchRows({ siteUrl, ...prior, dimensions: ["page"], rowLimit: 5000 }, true)
  ]);
  const currentMap = new Map(currentRows.map((row) => [row.keys[0], row]));
  const minPriorClicks = input.minPriorClicks ?? 5;
  const losses = priorRows
    .filter((priorRow) => priorRow.clicks >= minPriorClicks)
    .map((priorRow) => {
      const currentRow = currentMap.get(priorRow.keys[0]);
      const clickDelta = (currentRow?.clicks ?? 0) - priorRow.clicks;
      const positionDelta = (currentRow?.position ?? 0) - priorRow.position;
      const ctrDelta = (currentRow?.ctr ?? 0) - priorRow.ctr;
      return {
        page: priorRow.keys[0],
        priorClicks: priorRow.clicks,
        currentClicks: currentRow?.clicks ?? 0,
        clickDelta,
        clickDeltaPercent: pctChange(currentRow?.clicks ?? 0, priorRow.clicks),
        positionDelta: round(positionDelta, 1),
        priorCtr: round(priorRow.ctr * 100, 2),
        currentCtr: round((currentRow?.ctr ?? 0) * 100, 2),
        ctrDeltaPoints: round(ctrDelta * 100, 2),
        ctrDeltaPercent: pctChange(currentRow?.ctr ?? 0, priorRow.ctr),
        likelyCause: diagnoseLoss(currentRow, priorRow)
      };
    })
    .filter((row) => row.clickDelta < 0)
    .sort((a, b) => a.clickDelta - b.clickDelta)
    .slice(0, input.limit ?? 50);
  return { siteUrl, current, prior, losses };
}

export async function decayingPages(input: { siteUrl?: string; minOldestClicks?: number; limit?: number }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const ranges = [dateRangeForDays(30, 1), dateRangeForDays(30, 31), dateRangeForDays(30, 61)];
  const [recent, middle, oldest] = await Promise.all(ranges.map((range) => fetchSearchRows({ siteUrl, ...range, dimensions: ["page"], rowLimit: 5000 }, true)));
  const recentMap = new Map(recent.map((row) => [row.keys[0], row]));
  const middleMap = new Map(middle.map((row) => [row.keys[0], row]));
  return oldest
    .filter((old) => old.clicks >= (input.minOldestClicks ?? 10))
    .map((old) => ({ old, mid: middleMap.get(old.keys[0]), recent: recentMap.get(old.keys[0]) }))
    .filter(({ old, mid, recent }) => mid && recent && old.clicks > mid.clicks && mid.clicks > recent.clicks)
    .map(({ old, mid, recent }) => ({
      page: old.keys[0],
      clicksOldest: old.clicks,
      clicksMiddle: mid!.clicks,
      clicksRecent: recent!.clicks,
      totalClickLoss: old.clicks - recent!.clicks,
      positionOldest: round(old.position, 1),
      positionRecent: round(recent!.position, 1),
      diagnosis: recent!.position > old.position + 2 ? "rankings declined" : recent!.ctr < old.ctr * 0.75 ? "CTR declined" : "demand or SERP mix likely declined"
    }))
    .sort((a, b) => b.totalClickLoss - a.totalClickLoss)
    .slice(0, input.limit ?? 50);
}

type QueryOverlapGroup = {
  query: string;
  totalImpressions: number;
  pages: Array<{ page: string | undefined; clicks: number; impressions: number; position: number }>;
};

type PagePairOverlap = {
  pages: [string, string];
  totalQueries: { pageA: number; pageB: number; union: number };
  totalImpressions: { pageA: number; pageB: number; pair: number };
  overlappingQueries: { count: number; percentOfSmallerPage: number; percentOfUnion: number };
  sharedImpressions: { pageA: number; pageB: number; total: number; percentOfPair: number };
  overlappingImpressions: { balanced: number; percentOfPair: number };
  cannibalizationScore: number;
  attentionScore: number;
  severity: "high" | "medium" | "low" | "negligible";
  queries: Array<{
    query: string;
    pageAImpressions: number;
    pageBImpressions: number;
    balancedOverlapImpressions: number;
    pageAPosition: number;
    pageBPosition: number;
  }>;
};

export async function queryPageOverlap(input: { siteUrl?: string; days?: number; minImpressions?: number; minPages?: number; minOverlapImpressions?: number; minOverlapPercent?: number; limit?: number }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const range = dateRangeForDays(input.days ?? 28);
  const rows = await fetchSearchRows({ siteUrl, ...range, dimensions: ["query", "page"], rowLimit: 10000 }, true);
  const grouped = groupRowsByQuery(rows);
  const minImpressions = input.minImpressions ?? 50;
  const minOverlapImpressions = input.minOverlapImpressions ?? 10;
  const minOverlapPercent = input.minOverlapPercent ?? 1;
  const queries = queryOverlapGroups(grouped, input.minPages ?? 2, minImpressions, input.limit ?? 50);
  const pagePairs = pagePairOverlaps(rows, minOverlapImpressions, minOverlapPercent, input.limit ?? 50);
  return {
    siteUrl,
    range,
    summary: {
      pagePairCount: pagePairs.length,
      queryGroupCount: queries.length,
      highSeverityPairCount: pagePairs.filter((pair) => pair.severity === "high").length,
      defaultFilters: { minOverlapImpressions, minOverlapPercent, minQueryGroupImpressions: minImpressions },
      scoring: "Page-pair cannibalization score is the relative geometric mean of query overlap and balanced impression overlap. Balanced impressions use 2 × min(page impressions) per shared query to discount one-sided overlaps. Attention score combines relative severity with absolute balanced-overlap volume for prioritization."
    },
    pagePairs,
    queries
  };
}

function groupRowsByQuery(rows: SearchRow[]): Map<string, SearchRow[]> {
  const grouped = new Map<string, SearchRow[]>();
  for (const row of rows) {
    const query = row.keys[0] ?? "";
    const list = grouped.get(query) ?? [];
    list.push(row);
    grouped.set(query, list);
  }
  return grouped;
}

function queryOverlapGroups(grouped: Map<string, SearchRow[]>, minPages: number, minImpressions: number, limit: number): QueryOverlapGroup[] {
  return [...grouped.entries()]
    .map(([query, entries]) => ({ query, totalImpressions: entries.reduce((sum, row) => sum + row.impressions, 0), pages: entries.sort((a, b) => a.position - b.position).map((row) => ({ page: row.keys[1], clicks: row.clicks, impressions: row.impressions, position: round(row.position, 1) })) }))
    .filter((item) => item.pages.length >= minPages && item.totalImpressions >= minImpressions)
    .sort((a, b) => b.totalImpressions - a.totalImpressions)
    .slice(0, limit);
}

function pagePairOverlaps(rows: SearchRow[], minBalancedOverlapImpressions: number, minBalancedOverlapPercent: number, limit: number): PagePairOverlap[] {
  const pages = new Map<string, { queries: Set<string>; impressions: number }>();
  const rowsByQueryPage = new Map<string, Map<string, SearchRow>>();
  for (const row of rows) {
    const query = row.keys[0] ?? "";
    const page = row.keys[1] ?? "";
    if (!query || !page) continue;
    const pageTotals = pages.get(page) ?? { queries: new Set<string>(), impressions: 0 };
    pageTotals.queries.add(query);
    pageTotals.impressions += row.impressions;
    pages.set(page, pageTotals);

    const queryRows = rowsByQueryPage.get(query) ?? new Map<string, SearchRow>();
    queryRows.set(page, row);
    rowsByQueryPage.set(query, queryRows);
  }

  const pairQueries = new Map<string, { pages: [string, string]; rows: Array<{ query: string; pageA: SearchRow; pageB: SearchRow }> }>();
  for (const [query, queryRows] of rowsByQueryPage) {
    const entries = [...queryRows.entries()].sort(([pageA], [pageB]) => pageA.localeCompare(pageB));
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const [pageA, rowA] = entries[i]!;
        const [pageB, rowB] = entries[j]!;
        const key = `${pageA}\u0000${pageB}`;
        const pair = pairQueries.get(key) ?? { pages: [pageA, pageB] as [string, string], rows: [] };
        pair.rows.push({ query, pageA: rowA, pageB: rowB });
        pairQueries.set(key, pair);
      }
    }
  }

  return [...pairQueries.values()]
    .map(({ pages: pairPages, rows: sharedRows }) => {
      const [pageA, pageB] = pairPages;
      const totalA = pages.get(pageA)!;
      const totalB = pages.get(pageB)!;
      const sharedImpressionsA = sharedRows.reduce((sum, item) => sum + item.pageA.impressions, 0);
      const sharedImpressionsB = sharedRows.reduce((sum, item) => sum + item.pageB.impressions, 0);
      const balancedOverlap = sharedRows.reduce((sum, item) => sum + 2 * Math.min(item.pageA.impressions, item.pageB.impressions), 0);
      const pairImpressions = totalA.impressions + totalB.impressions;
      const sharedQueryCount = sharedRows.length;
      const unionQueryCount = totalA.queries.size + totalB.queries.size - sharedQueryCount;
      const queryOverlapRatio = sharedQueryCount / Math.max(1, Math.min(totalA.queries.size, totalB.queries.size));
      const balancedImpressionRatio = balancedOverlap / Math.max(1, pairImpressions);
      const cannibalizationScore = round(Math.sqrt(queryOverlapRatio * balancedImpressionRatio) * 100, 2);
      return {
        pages: pairPages,
        totalQueries: { pageA: totalA.queries.size, pageB: totalB.queries.size, union: unionQueryCount },
        totalImpressions: { pageA: totalA.impressions, pageB: totalB.impressions, pair: pairImpressions },
        overlappingQueries: {
          count: sharedQueryCount,
          percentOfSmallerPage: round(queryOverlapRatio * 100, 2),
          percentOfUnion: round((sharedQueryCount / Math.max(1, unionQueryCount)) * 100, 2)
        },
        sharedImpressions: {
          pageA: sharedImpressionsA,
          pageB: sharedImpressionsB,
          total: sharedImpressionsA + sharedImpressionsB,
          percentOfPair: round(((sharedImpressionsA + sharedImpressionsB) / Math.max(1, pairImpressions)) * 100, 2)
        },
        overlappingImpressions: {
          balanced: balancedOverlap,
          percentOfPair: round(balancedImpressionRatio * 100, 2)
        },
        cannibalizationScore,
        attentionScore: Math.round(balancedOverlap * (cannibalizationScore / 100)),
        severity: overlapSeverity(cannibalizationScore),
        queries: sharedRows
          .sort((a, b) => Math.min(b.pageA.impressions, b.pageB.impressions) - Math.min(a.pageA.impressions, a.pageB.impressions))
          .slice(0, 10)
          .map((item) => ({
            query: item.query,
            pageAImpressions: item.pageA.impressions,
            pageBImpressions: item.pageB.impressions,
            balancedOverlapImpressions: 2 * Math.min(item.pageA.impressions, item.pageB.impressions),
            pageAPosition: round(item.pageA.position, 1),
            pageBPosition: round(item.pageB.position, 1)
          }))
      };
    })
    .filter((pair) => pair.overlappingImpressions.balanced >= minBalancedOverlapImpressions && pair.overlappingImpressions.percentOfPair >= minBalancedOverlapPercent)
    .sort((a, b) => b.attentionScore - a.attentionScore || b.cannibalizationScore - a.cannibalizationScore || b.overlappingImpressions.balanced - a.overlappingImpressions.balanced)
    .slice(0, limit);
}

function overlapSeverity(score: number): PagePairOverlap["severity"] {
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  if (score >= 15) return "low";
  return "negligible";
}

export async function sectionPerformance(input: { siteUrl?: string; pathContains: string; days?: number; limit?: number }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const range = dateRangeForDays(input.days ?? 28);
  const filters: DimensionFilter[] = [{ dimension: "page", operator: "contains", expression: input.pathContains }];
  const [pages, queries] = await Promise.all([
    fetchSearchRows({ siteUrl, ...range, dimensions: ["page"], filters, rowLimit: 5000 }, true),
    fetchSearchRows({ siteUrl, ...range, dimensions: ["query"], filters, rowLimit: 5000 }, true)
  ]);
  return {
    siteUrl,
    range,
    pathContains: input.pathContains,
    summary: summarizeRows(pages),
    pageCount: pages.length,
    topPages: pages.sort((a, b) => b.clicks - a.clicks).slice(0, input.limit ?? 10).map((row) => ({ page: row.keys[0], clicks: row.clicks, impressions: row.impressions, position: round(row.position, 1) })),
    topQueries: queries.sort((a, b) => b.clicks - a.clicks).slice(0, input.limit ?? 10).map((row) => ({ query: row.keys[0], clicks: row.clicks, impressions: row.impressions, position: round(row.position, 1) }))
  };
}

export async function alertScan(input: { siteUrl?: string; days?: number; positionDrop?: number; ctrDropPercent?: number; clickDropPercent?: number }) {
  const losses = await trafficLossDiagnostics({ siteUrl: input.siteUrl, days: input.days ?? 7, minPriorClicks: 1, limit: 200 });
  const alerts = losses.losses.flatMap((loss) => {
    const out = [] as Array<{ severity: "critical" | "warning" | "info"; type: string; target: string; detail: string }>;
    if (loss.clickDeltaPercent !== null && loss.clickDeltaPercent <= -(input.clickDropPercent ?? 30)) out.push({ severity: loss.clickDeltaPercent <= -60 ? "critical" : "warning", type: "click_loss", target: loss.page ?? "", detail: `Clicks changed ${loss.clickDeltaPercent}% (${loss.priorClicks} -> ${loss.currentClicks}).` });
    if (loss.positionDelta >= (input.positionDrop ?? 10)) out.push({ severity: loss.positionDelta >= 20 ? "critical" : "warning", type: "position_loss", target: loss.page ?? "", detail: `Average position worsened by ${loss.positionDelta}.` });
    if (loss.ctrDeltaPercent !== null && loss.ctrDeltaPercent <= -(input.ctrDropPercent ?? 30)) out.push({ severity: loss.ctrDeltaPercent <= -60 ? "critical" : "warning", type: "ctr_loss", target: loss.page ?? "", detail: `CTR changed ${loss.ctrDeltaPercent}% (${loss.priorCtr}% -> ${loss.currentCtr}%).` });
    return out;
  });
  return { siteUrl: losses.siteUrl, current: losses.current, prior: losses.prior, counts: countSeverities(alerts), alerts };
}

export async function actionPlan(input: { siteUrl?: string; days?: number; limit?: number }) {
  const limit = input.limit ?? 15;
  const [rank, ctr, gaps, overlap, decay] = await Promise.all([
    rankLiftCandidates({ siteUrl: input.siteUrl, days: input.days, limit }),
    ctrGapCandidates({ siteUrl: input.siteUrl, days: input.days, limit }),
    uncoveredDemand({ siteUrl: input.siteUrl, days: 90, limit }),
    queryPageOverlap({ siteUrl: input.siteUrl, days: input.days, limit }),
    decayingPages({ siteUrl: input.siteUrl, limit })
  ]);
  const recommendations = [
    ...rank.slice(0, 5).map((item) => ({ priorityScore: item.estimatedExtraClicks, action: "strengthen_existing_page", target: item.page, query: item.query, reason: `Near page-one ranking at position ${item.position} with estimated ${item.estimatedExtraClicks} extra clicks.` })),
    ...ctr.slice(0, 5).map((item) => ({ priorityScore: item.estimatedExtraClicks, action: "improve_snippet_ctr", target: item.page, reason: `CTR is ${item.ctrGapPoints} percentage points below benchmark.` })),
    ...gaps.slice(0, 5).map((item) => ({ priorityScore: item.impressions, action: "cover_unmet_search_intent", query: item.query, reason: `${item.impressions} impressions while average position is ${item.position}.` })),
    ...overlap.pagePairs.slice(0, 3).map((item) => {
      const primaryIndex = item.totalImpressions.pageA >= item.totalImpressions.pageB ? 0 : 1;
      return {
        priorityScore: item.attentionScore,
        action: "resolve_query_overlap",
        target: item.pages[primaryIndex],
        secondaryTarget: item.pages[primaryIndex === 0 ? 1 : 0],
        reason: `${item.overlappingQueries.count} shared queries; ${item.overlappingQueries.percentOfSmallerPage}% of the smaller query set and ${item.overlappingImpressions.percentOfPair}% balanced impression overlap (${item.overlappingImpressions.balanced} impressions). Severity: ${item.severity}.`
      };
    }),
    ...decay.slice(0, 3).map((item) => ({ priorityScore: item.totalClickLoss, action: "refresh_declining_content", target: item.page, reason: `Three-period click decline; lost ${item.totalClickLoss} clicks.` }))
  ].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, limit);
  return { generatedFrom: { rankLift: rank.length, ctrGaps: ctr.length, uncoveredDemand: gaps.length, overlap: overlap.pagePairs.length, decay: decay.length }, recommendations };
}

export async function claimCheck(input: { siteUrl?: string; claim: string; metric: "clicks" | "impressions" | "ctr" | "position"; expected: number; days?: number; pageUrl?: string; query?: string }) {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const range = dateRangeForDays(input.days ?? 28);
  const filters: DimensionFilter[] = [];
  if (input.pageUrl) filters.push({ dimension: "page", operator: "equals", expression: input.pageUrl });
  if (input.query) filters.push({ dimension: "query", operator: "equals", expression: input.query });
  const dimensions = filters.length ? filters.map((f) => f.dimension) : ["date" as const];
  const rows = await fetchSearchRows({ siteUrl, ...range, dimensions, filters, rowLimit: 5000 }, true);
  const summary = summarizeRows(rows);
  const actual = summary[input.metric];
  const tolerance = input.metric === "position" ? 0.5 : Math.max(1, Math.abs(input.expected) * 0.05);
  return { siteUrl, claim: input.claim, metric: input.metric, expected: input.expected, actual, tolerance, verified: Math.abs(actual - input.expected) <= tolerance, range, rowsConsidered: rows.length };
}

export async function multiPropertyOverview(input: { siteUrls?: string[]; days?: number }) {
  const urls = input.siteUrls?.length ? input.siteUrls : undefined;
  const siteUrls = urls ?? getConfig().siteUrls;
  if (!siteUrls.length) throw new Error("Provide site_urls or set GSC_SITE_URLS for multi-property overview.");
  const sites = await Promise.all(siteUrls.map((siteUrl) => siteHealthOverview({ siteUrl, days: input.days }).then((overview) => ({ ...overview, status: overview.change.clicksPercent == null || overview.change.clicksPercent >= 0 ? "stable_or_growing" : overview.change.clicksPercent <= -25 ? "declining" : "watch" }))));
  return { count: sites.length, sites };
}

function diagnoseLoss(current: SearchRow | undefined, prior: SearchRow): string {
  if (!current) return "page disappeared from returned Search Console rows";
  if (current.position > prior.position + 2) return "ranking decline";
  if (prior.ctr > 0 && current.ctr < prior.ctr * 0.7) return "CTR decline with mostly stable rankings";
  if (current.impressions < prior.impressions * 0.7) return "impression demand/SERP visibility decline";
  return "mixed signal; inspect query/page details";
}

function inferIntent(query: string): string {
  if (/\b(best|top|review|vs|compare)\b/i.test(query)) return "commercial investigation";
  if (/\b(price|buy|near me|coupon|deal)\b/i.test(query)) return "transactional";
  if (/\b(how|what|why|guide|tutorial)\b/i.test(query)) return "informational";
  return "unspecified";
}

function countSeverities(alerts: Array<{ severity: "critical" | "warning" | "info" }>) {
  return alerts.reduce((acc, alert) => ({ ...acc, [alert.severity]: acc[alert.severity] + 1, total: acc.total + 1 }), { critical: 0, warning: 0, info: 0, total: 0 });
}
