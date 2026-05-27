# Infinitnet Google Search Console (GSC) MCP Server

Infinitnet Google Search Console (GSC) MCP Server is a local stdio MCP server that lets AI assistants work with Google Search Console data safely and consistently. It provides property discovery, Search Analytics queries, URL Inspection, sitemap operations, Indexing API notifications, and higher-level SEO analysis workflows such as traffic-loss diagnosis, CTR gaps, content decay, query overlap, and prioritized action plans.

## Contents

- [What this server does](#what-this-server-does)
- [Requirements](#requirements)
- [Install from npm](#install-from-npm)
- [Install from source](#install-from-source)
- [Authentication](#authentication)
- [Configure your MCP client](#configure-your-mcp-client)
- [Important: property selection workflow](#important-property-selection-workflow)
- [Usage examples](#usage-examples)
- [Tool reference](#tool-reference)
- [Environment variables](#environment-variables)
- [Response format](#response-format)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## What this server does

The server exposes 26 MCP tools grouped into five areas:

1. **Setup and discovery** — server guide, auth status, and Search Console property listing.
2. **Search Analytics** — flexible GSC performance queries, period comparisons, and page-level query breakdowns.
3. **Technical SEO** — URL Inspection API, batch inspection, indexing issue scans, and sitemap operations.
4. **SEO analysis** — site health, rank-lift opportunities, CTR gaps, uncovered queries, traffic losses, content decay, query overlap, section performance, alerts, action plans, and claim checks.
5. **Indexing API notifications** — single and batch URL update/delete notifications.

Every tool returns a structured JSON response envelope so the assistant can distinguish successful data, errors, input echo, and metadata.

## Requirements

- Node.js **20 or newer**.
- A Google Cloud project with the relevant APIs enabled:
  - Google Search Console API for Search Analytics, properties, sitemaps, and URL Inspection.
  - Indexing API only if you use `gsc_index_notify` or `gsc_index_notify_batch`.
- Access to at least one Google Search Console property.
- Either service-account credentials or OAuth client credentials.

## Install from npm

The npm package is the recommended way to run this MCP server. You can start it directly with `npx` without cloning the repository:

```bash
npx -y @infinitnet/google-search-console-gsc-mcp-server
```

For a persistent local install, install it globally and run the short binary name:

```bash
npm install -g @infinitnet/google-search-console-gsc-mcp-server
gsc-mcp
```

## Install from source

```bash
git clone <this-repository-url>
cd google-search-console-gsc-mcp
npm install
npm run build
```

Start the server manually for a smoke test:

```bash
node dist/index.js
```

When launched manually, the process waits for MCP JSON-RPC messages on stdin. In normal use, your MCP client starts it for you.

## Authentication

The server supports two auth modes. Both can list accessible properties with `gsc_properties_list`; follow-up tool calls should pass the chosen property as `site_url`.

### Service-account mode

Use this when you have a Google Cloud service account and can add its email to the relevant Search Console properties.

1. Create a Google Cloud service account.
2. Create/download a JSON key file.
3. Add the service-account email as a user or owner in Google Search Console for each property it should access.
4. Set one of these env vars in your MCP client config:
   - `GSC_KEY_FILE=/absolute/path/to/service-account.json`
   - `GSC_CREDENTIALS_PATH=/absolute/path/to/service-account.json`
   - `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json`
5. Leave property selection dynamic: call `gsc_properties_list`, then pass the selected property as `site_url`.

### OAuth mode

Use this when the MCP server should act as a specific Google user. On first use, the server opens a local browser auth flow and stores a refresh token.

```bash
GSC_AUTH_MODE=oauth
GSC_OAUTH_SECRETS_FILE=/absolute/path/to/client_secret.json
```

Alternative OAuth env vars:

```bash
GSC_AUTH_MODE=oauth
GSC_OAUTH_CLIENT_ID=your-client-id
GSC_OAUTH_CLIENT_SECRET=your-client-secret
```

Token cache defaults to:

```text
~/.config/gsc-mcp/oauth-token.json
```

Override it with `GSC_OAUTH_TOKEN_FILE` or set the base directory with `GSC_CONFIG_DIR`.

## Configure your MCP client

### npm package config examples

If you installed from npm, point your MCP client at the published binary instead of a local `dist/index.js` path. For one-off `npx` execution:

```json
{
  "mcpServers": {
    "gsc": {
      "command": "npx",
      "args": ["-y", "@infinitnet/google-search-console-gsc-mcp-server"],
      "env": {
        "GSC_KEY_FILE": "/absolute/path/to/service-account.json",
        "GSC_DATA_STATE": "all"
      }
    }
  }
}
```

If you installed globally with `npm install -g @infinitnet/google-search-console-gsc-mcp-server`, use the short binary:

```json
{
  "mcpServers": {
    "gsc": {
      "command": "gsc-mcp",
      "env": {
        "GSC_KEY_FILE": "/absolute/path/to/service-account.json",
        "GSC_DATA_STATE": "all"
      }
    }
  }
}
```

### Claude Desktop / Claude Code style config: service account

```json
{
  "mcpServers": {
    "gsc": {
      "command": "node",
      "args": ["/absolute/path/to/google-search-console-gsc-mcp/dist/index.js"],
      "env": {
        "GSC_KEY_FILE": "/absolute/path/to/service-account.json",
        "GSC_DATA_STATE": "all"
      }
    }
  }
}
```

### Claude Desktop / Claude Code style config: OAuth

```json
{
  "mcpServers": {
    "gsc": {
      "command": "node",
      "args": ["/absolute/path/to/google-search-console-gsc-mcp/dist/index.js"],
      "env": {
        "GSC_AUTH_MODE": "oauth",
        "GSC_OAUTH_SECRETS_FILE": "/absolute/path/to/client_secret.json",
        "GSC_DATA_STATE": "all"
      }
    }
  }
}
```

### Optional fallback property

`GSC_SITE_URL` and `GSC_SITE_URLS` exist only as fallbacks. They are intentionally omitted from the main MCP config examples because agents should normally choose the property dynamically: call `gsc_properties_list`, match the user's requested site, and pass the exact property as `site_url` in the tool call.

## Important: property selection workflow

Do **not** assume a property string. Search Console property identifiers must match exactly.

A good AI-agent workflow is:

1. Call `gsc_server_guide` to check auth mode and available tool groups.
2. Call `gsc_properties_list`.
3. Pick the property that matches the user's requested site.
   - Domain property format: `sc-domain:example.com`
   - URL-prefix property format: `https://www.example.com/`
4. Pass that exact value as `site_url` to each follow-up tool.
5. If a tool returns a 404/property error, call `gsc_properties_list` again and use the exact returned property.

Example property discovery response shape:

```json
{
  "ok": true,
  "tool": "gsc_properties_list",
  "data": {
    "count": 2,
    "properties": [
      { "siteUrl": "sc-domain:example.com", "permissionLevel": "siteOwner" },
      { "siteUrl": "https://www.example.com/", "permissionLevel": "siteFullUser" }
    ]
  }
}
```

## Usage examples

The examples below show MCP tool arguments. Your AI client will issue these as tool calls; you normally do not run them in a shell.

### 1. Discover server capabilities

Tool: `gsc_server_guide`

```json
{}
```

Use this to confirm auth mode, configured fallback sites, and available tool groups.

### 2. List GSC properties

Tool: `gsc_properties_list`

```json
{}
```

Use the returned `siteUrl` exactly in later calls.

### 3. Run a custom Search Analytics query

Tool: `gsc_search_query`

```json
{
  "site_url": "sc-domain:example.com",
  "days": 28,
  "dimensions": ["query", "page"],
  "filters": [
    { "dimension": "country", "operator": "equals", "expression": "usa" }
  ],
  "row_limit": 100,
  "sort_by": "clicks",
  "sort_direction": "desc"
}
```

### 4. Compare performance with the previous period

Tool: `gsc_period_compare`

```json
{
  "site_url": "sc-domain:example.com",
  "days": 28,
  "dimensions": ["page"],
  "row_limit": 250
}
```

### 5. Find queries for one page

Tool: `gsc_page_queries`

```json
{
  "site_url": "sc-domain:example.com",
  "page_url": "https://www.example.com/blog/example-page/",
  "days": 90,
  "row_limit": 50
}
```

### 6. Inspect one URL

Tool: `gsc_url_inspect`

```json
{
  "site_url": "sc-domain:example.com",
  "url": "https://www.example.com/blog/example-page/"
}
```

Returns normalized index status, crawl status, canonical information, robots state, rich result information, and detected issues.

### 7. Inspect a batch of URLs

Tool: `gsc_url_inspect_batch`

```json
{
  "site_url": "sc-domain:example.com",
  "urls": [
    "https://www.example.com/",
    "https://www.example.com/blog/example-page/"
  ]
}
```

Batch inspection is capped at 10 URLs per call.

### 8. Find indexing problems in a URL set

Tool: `gsc_indexing_issue_scan`

```json
{
  "site_url": "sc-domain:example.com",
  "urls": [
    "https://www.example.com/",
    "https://www.example.com/blog/example-page/"
  ]
}
```

This calls URL Inspection and returns a `problemUrls` subset.

### 9. List and submit sitemaps

Tool: `gsc_sitemaps_list`

```json
{
  "site_url": "https://www.example.com/"
}
```

Tool: `gsc_sitemap_get`

```json
{
  "site_url": "https://www.example.com/",
  "sitemap_url": "https://www.example.com/sitemap.xml"
}
```

Tool: `gsc_sitemap_submit`

```json
{
  "site_url": "https://www.example.com/",
  "sitemap_url": "https://www.example.com/sitemap.xml"
}
```

Sitemap operations are Search Console write operations. `gsc_sitemap_submit` is intended to be safe/idempotent, but it still notifies Google about the sitemap. It is disabled by default; set `GSC_ENABLE_WRITE_TOOLS=true` to allow write tools, and keep `GSC_ENABLE_SITEMAP_SUBMIT=true` to allow this specific tool.

### 10. Get site health

Tool: `gsc_site_health`

```json
{
  "site_url": "sc-domain:example.com",
  "days": 28
}
```

Returns current/prior totals and changes for clicks, impressions, CTR, and average position.

### 11. Find rank-lift opportunities

Tool: `gsc_rank_lift_opportunities`

```json
{
  "site_url": "sc-domain:example.com",
  "days": 28,
  "min_impressions": 100,
  "max_position": 15,
  "limit": 25
}
```

Use this for query-page pairs that rank near page one and may benefit from content improvements, internal links, or snippet refinement.

### 12. Find CTR gap pages

Tool: `gsc_ctr_gap_pages`

```json
{
  "site_url": "sc-domain:example.com",
  "days": 28,
  "min_impressions": 300,
  "limit": 25
}
```

CTR benchmarks are heuristics based on average position. Treat estimated extra clicks as prioritization guidance, not a guarantee.

### 13. Find uncovered query demand

Tool: `gsc_uncovered_queries`

```json
{
  "site_url": "sc-domain:example.com",
  "days": 90,
  "min_impressions": 50,
  "min_position": 20,
  "limit": 50
}
```

Use this to discover high-impression queries where the site appears but ranks poorly.

### 14. Diagnose traffic losses

Tool: `gsc_traffic_loss`

```json
{
  "site_url": "sc-domain:example.com",
  "days": 28,
  "min_prior_clicks": 5,
  "limit": 50
}
```

Classifies likely causes as ranking decline, CTR decline, demand/SERP visibility decline, disappearance from returned rows, or mixed signal.

### 15. Detect content decay

Tool: `gsc_content_decay`

```json
{
  "site_url": "sc-domain:example.com",
  "min_oldest_clicks": 10,
  "limit": 50
}
```

Looks for pages with three consecutive 30-day click declines.

### 16. Find query overlap between pages

Tool: `gsc_query_overlap`

```json
{
  "site_url": "sc-domain:example.com",
  "days": 28,
  "min_impressions": 50,
  "min_pages": 2,
  "min_overlap_impressions": 10,
  "min_overlap_percent": 1,
  "limit": 50
}
```

Use this for cannibalization, consolidation, or intent-separation reviews.

The default output focuses on two-page comparisons in `pagePairs`. Each pair
reports overlapping query counts, query-overlap percentages, shared impressions,
and `overlappingImpressions.balanced`, which uses `2 × min(page impressions)` per
shared query. This discounts lopsided cases where one page receives almost all
impressions for a shared query. `cannibalizationScore` and `severity` are
relative: they combine query-overlap share with balanced-impression-overlap share.
`attentionScore` combines that relative severity with absolute balanced-overlap
volume for prioritization. By default, `min_overlap_impressions` and
`min_overlap_percent` only remove tiny/noisy pairs; `min_impressions` continues to
filter query-level groups by total query impressions. Query-level groups remain
available in `queries` for consolidation context.

### 17. Analyze a site section

Tool: `gsc_section_performance`

```json
{
  "site_url": "sc-domain:example.com",
  "path_contains": "/blog/",
  "days": 28,
  "limit": 10
}
```

Returns aggregate section metrics, top pages, and top queries for URLs containing the path fragment.

### 18. Scan for recent alerts

Tool: `gsc_alert_scan`

```json
{
  "site_url": "sc-domain:example.com",
  "days": 7,
  "position_drop": 10,
  "ctr_drop_percent": 30,
  "click_drop_percent": 30
}
```

Use this for quick monitoring of material click, CTR, and position drops.

### 19. Generate an SEO action plan

Tool: `gsc_action_plan`

```json
{
  "site_url": "sc-domain:example.com",
  "days": 28,
  "limit": 15
}
```

Combines multiple signals into prioritized recommendations. Treat recommendations as deterministic analysis output that still needs human SEO judgment before implementation.

### 20. Verify a numeric claim

Tool: `gsc_claim_check`

```json
{
  "site_url": "sc-domain:example.com",
  "claim": "The blog generated about 1,000 clicks in the last 28 days.",
  "metric": "clicks",
  "expected": 1000,
  "days": 28,
  "page_url": "https://www.example.com/blog/"
}
```

Use this before reporting important numbers to users.

### 21. Compare multiple properties

Tool: `gsc_multi_property_health`

```json
{
  "site_urls": ["sc-domain:example.com", "https://www.example.com/"],
  "days": 28
}
```

If `site_urls` is omitted, the tool uses `GSC_SITE_URLS` or `GSC_SITE_URL` fallback configuration.

### 22. Notify the Indexing API

Tool: `gsc_index_notify`

```json
{
  "url": "https://www.example.com/job/example-role/",
  "action": "URL_UPDATED"
}
```

Tool: `gsc_index_notify_batch`

```json
{
  "urls": [
    "https://www.example.com/job/example-role/",
    "https://www.example.com/job/another-role/"
  ],
  "action": "URL_UPDATED"
}
```

Google documents the Indexing API primarily for JobPosting and BroadcastEvent-in-VideoObject pages. A successful notification does not guarantee crawling, indexing, or ranking changes. Indexing API tools are disabled by default; set `GSC_ENABLE_WRITE_TOOLS=true` to allow write tools, and keep `GSC_ENABLE_INDEXING_API=true` to allow this specific tool.

## Tool reference

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `gsc_server_guide` | Capabilities, auth status, tool groups, property workflow | none |
| `gsc_properties_list` | List accessible GSC properties | none |
| `gsc_property_get` | Get one property's details | `site_url` |
| `gsc_search_query` | Custom Search Analytics query | `site_url`, `days` or date range, `dimensions`, `filters`, `row_limit` |
| `gsc_period_compare` | Compare current vs previous period | `site_url`, `days`, `dimensions`, `filters` |
| `gsc_page_queries` | Query performance for one URL | `site_url`, `page_url`, `days` |
| `gsc_url_inspect` | Inspect one URL | `site_url`, `url` |
| `gsc_url_inspect_batch` | Inspect up to 10 URLs | `site_url`, `urls` |
| `gsc_indexing_issue_scan` | Return only inspected URLs with issues | `site_url`, `urls` |
| `gsc_sitemaps_list` | List sitemaps | `site_url` |
| `gsc_sitemap_get` | Get one sitemap | `site_url`, `sitemap_url` |
| `gsc_sitemap_submit` | Submit/resubmit sitemap (write tool; disabled unless write tools are enabled) | `site_url`, `sitemap_url` |
| `gsc_site_health` | Site-level current/prior health | `site_url`, `days` |
| `gsc_rank_lift_opportunities` | Near-page-one opportunities | `site_url`, `days`, `min_impressions`, `max_position` |
| `gsc_ctr_gap_pages` | CTR underperformance opportunities | `site_url`, `days`, `min_impressions` |
| `gsc_uncovered_queries` | Poor-ranking high-impression queries | `site_url`, `days`, `min_impressions`, `min_position` |
| `gsc_traffic_loss` | Diagnose page click losses | `site_url`, `days`, `min_prior_clicks` |
| `gsc_content_decay` | Three-period page decline detection | `site_url`, `min_oldest_clicks` |
| `gsc_query_overlap` | Two-page query/impression overlap with relative cannibalization severity | `site_url`, `days`, `min_impressions`, `min_pages`, overlap filters |
| `gsc_section_performance` | Analyze top returned URLs containing a path fragment | `site_url`, `path_contains`, `days` |
| `gsc_alert_scan` | Recent click/CTR/position alerts | `site_url`, `days`, thresholds |
| `gsc_action_plan` | Prioritized SEO recommendations | `site_url`, `days`, `limit` |
| `gsc_claim_check` | Verify a numeric claim | `site_url`, `claim`, `metric`, `expected`, optional filters |
| `gsc_multi_property_health` | Compare up to 20 properties | `site_urls`, `days` |
| `gsc_index_notify` | Notify one URL update/delete (write tool; disabled unless write tools are enabled) | `url`, `action` |
| `gsc_index_notify_batch` | Notify up to 200 URLs (write tool; disabled unless write tools are enabled) | `urls`, `action` |

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `GSC_AUTH_MODE` | `service_account` | Auth mode: `service_account` or `oauth`. |
| `GSC_KEY_FILE` | unset | Service-account JSON key path. |
| `GSC_CREDENTIALS_PATH` | unset | Alias for service-account JSON key path. |
| `GOOGLE_APPLICATION_CREDENTIALS` | unset | Google-standard service-account key path fallback. |
| `GSC_OAUTH_SECRETS_FILE` | unset | OAuth client secrets JSON file. |
| `GSC_OAUTH_CLIENT_SECRETS_FILE` | unset | Alias for OAuth client secrets JSON file. |
| `GSC_OAUTH_CLIENT_ID` | unset | OAuth client ID, if not using a secrets file. |
| `GSC_OAUTH_CLIENT_SECRET` | unset | OAuth client secret, if not using a secrets file. |
| `GSC_OAUTH_TOKEN_FILE` | `~/.config/gsc-mcp/oauth-token.json` | OAuth token cache path. |
| `GSC_CONFIG_DIR` | `~/.config/gsc-mcp` | Base config directory for OAuth token cache. |
| `GSC_OAUTH_PORT` | `3847` | Local OAuth callback port. |
| `GSC_OAUTH_CALLBACK_PORT` | `3847` | Alias/override for OAuth callback port. |
| `GSC_SITE_URL` | unset | Optional fallback property if a tool call omits `site_url`. |
| `GSC_SITE_URLS` | unset | Optional comma-separated fallback list for multi-property tools. |
| `GSC_DATA_STATE` | `all` | Search Analytics data state: `all` or `final`. |
| `GSC_ENABLE_WRITE_TOOLS` | `false` | Enables external write operations when set to `true`. Read-only tools work without this. |
| `GSC_ENABLE_SITEMAP_SUBMIT` | `true` when write tools are enabled | Set to `false` to keep sitemap submission disabled even when write tools are enabled. |
| `GSC_ENABLE_INDEXING_API` | `true` when write tools are enabled | Set to `false` to keep Indexing API notification tools disabled even when write tools are enabled. |

## Response format

Successful tools return a text content item containing JSON like:

```json
{
  "ok": true,
  "tool": "gsc_site_health",
  "input": { "site_url": "sc-domain:example.com", "days": 28 },
  "data": {},
  "meta": {
    "generatedAt": "2026-05-26T12:00:00.000Z",
    "source": "Google Search Console API via local MCP server",
    "siteUrl": "sc-domain:example.com",
    "notes": [
      "Use only the returned API data for numeric claims; re-run gsc_claim_check before presenting important numbers.",
      "Search Console data may include fresh unfinalized rows unless GSC_DATA_STATE=final is set."
    ]
  }
}
```

Errors use the same envelope:

```json
{
  "ok": false,
  "tool": "gsc_property_get",
  "input": { "site_url": "sc-domain:missing.example" },
  "error": {
    "message": "Property 'sc-domain:missing.example' was not found or is not accessible to the authenticated account.",
    "code": 404,
    "hint": "Domain properties require exact sc-domain:example.com format and explicit user/service-account access."
  },
  "meta": {}
}
```

## Troubleshooting

### `Service-account mode requires GSC_KEY_FILE...`

Set one of `GSC_KEY_FILE`, `GSC_CREDENTIALS_PATH`, or `GOOGLE_APPLICATION_CREDENTIALS` to an absolute service-account JSON path, or switch to OAuth with `GSC_AUTH_MODE=oauth`.

### `Credential file does not exist`

Use an absolute path in the MCP client config. Relative paths may resolve from the MCP client's working directory rather than this repository.

### `No Search Console property selected`

Call `gsc_properties_list`, choose the exact property, and pass it as `site_url`. Optionally set `GSC_SITE_URL` only as a fallback.

### Property not found / 404

Common causes:

- The `site_url` does not exactly match a Search Console property.
- A domain property was passed as a URL-prefix property, or vice versa.
- The authenticated user/service account does not have access to that property.

Fix: call `gsc_properties_list` and copy the exact `siteUrl` value.

### OAuth browser flow does not open

The server prints the auth URL to stderr if opening the browser fails. Open that URL manually, complete consent, and keep the MCP server process running until the callback completes.

### OAuth callback port is already in use

Set a different port:

```bash
GSC_OAUTH_PORT=3850
```

### URL Inspection returns no data or permission errors

Check that the inspected URL belongs to the selected property and that the authenticated account has property access. Domain properties can inspect URLs across protocols/subdomains only when the property/account access is correct.

### Sitemap operations fail for domain properties

Google sitemap calls are often easiest with exact URL-prefix properties such as `https://www.example.com/`. If a domain property fails, list properties and try the matching URL-prefix property if available.

### Indexing API calls succeed but nothing changes

A successful Indexing API notification only means Google accepted the notification. It does not guarantee crawl, index, or ranking changes.

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Typecheck/lint:

```bash
npm run lint
```

Run tests:

```bash
npm test
```

Run a package dry run:

```bash
npm pack --dry-run
```

Project layout:

```text
src/index.ts        MCP server and tool registration
src/auth.ts         Google auth and API client creation
src/config.ts       Environment parsing and property fallback handling
src/analytics.ts    Date windows, Search Analytics fetching, metric helpers
src/gsc.ts          Direct Search Console API operations
src/seo.ts          Higher-level SEO analysis workflows
src/response.ts     Shared JSON response envelope
src/types.ts        Shared TypeScript types
src/__tests__/      Mocked unit/integration tests
```

Design conventions:

- Keep stdout reserved for MCP protocol messages.
- Use `console.error` only for fatal startup/runtime diagnostics.
- Keep Google API calls in `src/gsc.ts` or `src/analytics.ts`.
- Keep pure deterministic analysis in `src/seo.ts` where possible.
- Add mocked tests for new Google API wrappers; tests must not require live credentials.
- Preserve the shared response envelope for every MCP tool.
