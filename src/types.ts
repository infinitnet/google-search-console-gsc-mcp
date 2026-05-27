export type SearchDimension = "query" | "page" | "country" | "device" | "date" | "searchAppearance";

export type FilterOperator =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "includingRegex"
  | "excludingRegex";

export interface DimensionFilter {
  dimension: SearchDimension;
  operator: FilterOperator;
  expression: string;
}

export interface SearchRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface SearchQueryRequest {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: SearchDimension[];
  filters?: DimensionFilter[];
  rowLimit?: number;
  startRow?: number;
  dataState?: "all" | "final";
}

export interface SearchRowsSampling {
  coverageLabel: "top_returned_rows";
  dateRange: DateRange;
  dimensions: SearchDimension[];
  filtersApplied: DimensionFilter[];
  dataState: "all" | "final";
  requestedRowLimit: number;
  requestedStartRow: number;
  rowsFetched: number;
  pageSize: number;
  pagesFetched: number;
  responseRowCounts: number[];
  fetchAllWithinRequestedLimit: boolean;
  limitReached: boolean;
  requestedLimitReached: boolean;
  possiblyTruncated: boolean;
  apiMayOmitRows: true;
  sortBasis: "clicks_descending_with_arbitrary_tie_order" | "date_ascending";
  apiLimits: {
    maxRowsPerRequest: number;
    performanceRowsPerDayPerTypePerProperty: number;
  };
  completeness: "returned_less_than_requested_limit" | "capped_at_requested_limit";
  note: string;
}

export interface SearchRowsResult {
  rows: SearchRow[];
  sampling: SearchRowsSampling;
}

export interface MetricSummary {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface ToolEnvelope<T> {
  ok: boolean;
  tool: string;
  input: Record<string, unknown>;
  data?: T;
  error?: {
    message: string;
    code?: string | number;
    hint?: string;
  };
  meta: {
    generatedAt: string;
    source: string;
    siteUrl?: string;
    notes: string[];
    sampling?: unknown;
    [key: string]: unknown;
  };
}
