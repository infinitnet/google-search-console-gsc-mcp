import type { ToolEnvelope } from "./types.js";

const SOURCE = "Google Search Console API via local MCP server";
const DEFAULT_NOTES = [
  "Use only the returned API data for numeric claims; re-run gsc_claim_check before presenting important numbers.",
  "Search Console data may include fresh unfinalized rows unless GSC_DATA_STATE=final is set."
];

export function ok<T>(tool: string, input: Record<string, unknown>, data: T, notes: string[] = [], siteUrl?: string) {
  return asText<T>({
    ok: true,
    tool,
    input,
    data,
    meta: { generatedAt: new Date().toISOString(), source: SOURCE, siteUrl, notes: [...DEFAULT_NOTES, ...notes] }
  });
}

export function fail(tool: string, input: Record<string, unknown>, error: unknown, hint?: string, siteUrl?: string) {
  const maybe = error as { message?: string; code?: string | number; response?: { status?: number; data?: unknown } };
  const status = maybe.response?.status ?? maybe.code;
  let message = maybe.message ?? String(error);
  if (status === 404 && siteUrl) {
    message = `Property '${siteUrl}' was not found or is not accessible to the authenticated account.`;
    hint ??= siteUrl.startsWith("sc-domain:")
      ? "Domain properties require exact sc-domain:example.com format and explicit user/service-account access."
      : "If this is a domain property, use sc-domain:example.com instead of a URL-prefix property.";
  }
  return asText<never>({
    ok: false,
    tool,
    input,
    error: { message, code: status, hint },
    meta: { generatedAt: new Date().toISOString(), source: SOURCE, siteUrl, notes: DEFAULT_NOTES }
  });
}

export function asText<T>(payload: ToolEnvelope<T>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
