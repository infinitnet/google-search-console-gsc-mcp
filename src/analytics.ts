import type { DateRange, DimensionFilter, MetricSummary, SearchDimension, SearchQueryRequest, SearchRow, SearchRowsResult, SearchRowsSampling } from "./types.js";
import { getConfig } from "./config.js";
import { getSearchConsoleClient } from "./auth.js";

export const MAX_API_LIMIT = 25_000;
export const PERFORMANCE_ROWS_PER_DAY_PER_TYPE_PER_PROPERTY = 50_000;
const MAX_DATE_RANGE_DAYS = 548;

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.max(min, Math.min(max, integer));
}

function finiteNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function dateRangeForDays(days = 28, offsetDays = 1): DateRange {
  const safeDays = boundedInteger(days, 28, 1, MAX_DATE_RANGE_DAYS);
  const safeOffsetDays = boundedInteger(offsetDays, 1, 0, MAX_DATE_RANGE_DAYS);
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - safeOffsetDays);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - safeDays + 1);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

export function previousRange(days = 28, offsetDays = 1): DateRange {
  const safeDays = boundedInteger(days, 28, 1, MAX_DATE_RANGE_DAYS);
  const current = dateRangeForDays(days, offsetDays);
  const end = new Date(`${current.startDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - safeDays + 1);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

export function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null;
  return round(((current - prior) / prior) * 100, 2);
}

export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function summarizeRows(rows: SearchRow[]): MetricSummary {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const weightedPositionNumerator = rows.reduce((sum, row) => sum + row.position * Math.max(row.impressions, 0), 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? round((clicks / impressions) * 100, 2) : 0,
    position: impressions > 0 ? round(weightedPositionNumerator / impressions, 1) : 0
  };
}

export function normalizeRows(rows: Array<{ keys?: string[] | null; clicks?: number | null; impressions?: number | null; ctr?: number | null; position?: number | null }> | undefined): SearchRow[] {
  return (rows ?? []).map((row) => ({
    keys: row.keys ?? [],
    clicks: finiteNumber(row.clicks),
    impressions: finiteNumber(row.impressions),
    ctr: finiteNumber(row.ctr),
    position: finiteNumber(row.position)
  }));
}

export function buildFilterGroups(filters?: DimensionFilter[]) {
  if (!filters?.length) return undefined;
  return [{ filters: filters.map((filter) => ({ dimension: filter.dimension, operator: filter.operator, expression: filter.expression })) }];
}

export async function fetchSearchRows(request: SearchQueryRequest, fetchAll = false): Promise<SearchRow[]> {
  const result = await fetchSearchRowsWithMetadata(request, fetchAll);
  return result.rows;
}

export async function fetchSearchRowsWithMetadata(request: SearchQueryRequest, fetchAll = false): Promise<SearchRowsResult> {
  const client = await getSearchConsoleClient();
  const rowLimit = boundedInteger(request.rowLimit, 1000, 1, MAX_API_LIMIT);
  const allRows: SearchRow[] = [];
  let startRow = boundedInteger(request.startRow, 0, 0, Number.MAX_SAFE_INTEGER);
  const requestedStartRow = startRow;
  const pageSize = fetchAll ? Math.min(rowLimit, MAX_API_LIMIT) : rowLimit;
  const dataState = request.dataState ?? getConfig().dataState;
  const responseRowCounts: number[] = [];

  while (allRows.length < rowLimit) {
    const remaining = rowLimit - allRows.length;
    const requestedPageRows = Math.min(pageSize, remaining);
    const response = await client.searchanalytics.query({
      siteUrl: request.siteUrl,
      requestBody: {
        startDate: request.startDate,
        endDate: request.endDate,
        dimensions: request.dimensions,
        dimensionFilterGroups: buildFilterGroups(request.filters),
        rowLimit: requestedPageRows,
        startRow,
        dataState
      }
    });
    const rows = normalizeRows(response.data.rows);
    responseRowCounts.push(rows.length);
    allRows.push(...rows);
    if (!fetchAll || rows.length < requestedPageRows) break;
    startRow += rows.length;
  }

  return {
    rows: allRows,
    sampling: buildSearchRowsSampling(request, rowLimit, requestedStartRow, pageSize, fetchAll, dataState, responseRowCounts, allRows.length)
  };
}

function buildSearchRowsSampling(
  request: SearchQueryRequest,
  rowLimit: number,
  requestedStartRow: number,
  pageSize: number,
  fetchAll: boolean,
  dataState: "all" | "final",
  responseRowCounts: number[],
  rowsFetched: number
): SearchRowsSampling {
  const limitReached = rowsFetched >= rowLimit;
  return {
    coverageLabel: "top_returned_rows",
    dateRange: { startDate: request.startDate, endDate: request.endDate },
    dimensions: request.dimensions,
    filtersApplied: request.filters ?? [],
    dataState,
    requestedRowLimit: rowLimit,
    requestedStartRow,
    rowsFetched,
    pageSize,
    pagesFetched: responseRowCounts.length,
    responseRowCounts,
    fetchAllWithinRequestedLimit: fetchAll,
    limitReached,
    requestedLimitReached: limitReached,
    possiblyTruncated: limitReached,
    apiMayOmitRows: true,
    sortBasis: request.dimensions.includes("date") ? "date_ascending" : "clicks_descending_with_arbitrary_tie_order",
    apiLimits: {
      maxRowsPerRequest: MAX_API_LIMIT,
      performanceRowsPerDayPerTypePerProperty: PERFORMANCE_ROWS_PER_DAY_PER_TYPE_PER_PROPERTY
    },
    completeness: limitReached ? "capped_at_requested_limit" : "returned_less_than_requested_limit",
    note: limitReached
      ? "The requested row limit was reached. Search Console may have additional rows beyond this result set, and the API can return top rows rather than every row under internal limits."
      : "The API returned fewer rows than requested for this query. Search Console can still apply internal top-row limits, so treat this as returned coverage rather than proof of exhaustive site demand."
  };
}

export function mapByKey(rows: SearchRow[], keyIndex = 0): Map<string, SearchRow> {
  const out = new Map<string, SearchRow>();
  for (const row of rows) out.set(row.keys[keyIndex] ?? "", row);
  return out;
}

export function validDimensions(dimensions: string[]): SearchDimension[] {
  const allowed = new Set(["query", "page", "country", "device", "date", "searchAppearance"]);
  const clean = dimensions.filter((dimension): dimension is SearchDimension => allowed.has(dimension));
  return clean.length ? clean : ["query"];
}
