import type { DateRange, DimensionFilter, MetricSummary, SearchDimension, SearchQueryRequest, SearchRow } from "./types.js";
import { getConfig } from "./config.js";
import { getSearchConsoleClient } from "./auth.js";

const MAX_API_LIMIT = 25_000;

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dateRangeForDays(days = 28, offsetDays = 1): DateRange {
  const safeDays = Math.max(1, Math.min(548, Math.trunc(days)));
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - offsetDays);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - safeDays + 1);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

export function previousRange(days = 28, offsetDays = 1): DateRange {
  const current = dateRangeForDays(days, offsetDays);
  const end = new Date(`${current.startDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(1, Math.trunc(days)) + 1);
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
    clicks: Number(row.clicks ?? 0),
    impressions: Number(row.impressions ?? 0),
    ctr: Number(row.ctr ?? 0),
    position: Number(row.position ?? 0)
  }));
}

export function buildFilterGroups(filters?: DimensionFilter[]) {
  if (!filters?.length) return undefined;
  return [{ filters: filters.map((filter) => ({ dimension: filter.dimension, operator: filter.operator, expression: filter.expression })) }];
}

export async function fetchSearchRows(request: SearchQueryRequest, fetchAll = false): Promise<SearchRow[]> {
  const client = await getSearchConsoleClient();
  const rowLimit = Math.max(1, Math.min(request.rowLimit ?? 1000, MAX_API_LIMIT));
  const allRows: SearchRow[] = [];
  let startRow = request.startRow ?? 0;
  const pageSize = fetchAll ? Math.min(rowLimit, MAX_API_LIMIT) : rowLimit;

  while (allRows.length < rowLimit) {
    const remaining = rowLimit - allRows.length;
    const response = await client.searchanalytics.query({
      siteUrl: request.siteUrl,
      requestBody: {
        startDate: request.startDate,
        endDate: request.endDate,
        dimensions: request.dimensions,
        dimensionFilterGroups: buildFilterGroups(request.filters),
        rowLimit: Math.min(pageSize, remaining),
        startRow,
        dataState: request.dataState ?? getConfig().dataState
      }
    });
    const rows = normalizeRows(response.data.rows);
    allRows.push(...rows);
    if (!fetchAll || rows.length < Math.min(pageSize, remaining)) break;
    startRow += rows.length;
  }
  return allRows;
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
