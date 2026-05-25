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
  };
}
