# Infinitnet Google Search Console (GSC) MCP Server

A modern Google Search Console MCP server for AI assistants. It combines reliable Search Console API access with practical SEO analysis workflows: performance queries, URL inspection, sitemap operations, traffic-loss diagnostics, content decay, CTR gaps, ranking opportunities, query overlap, and prioritized action plans.

## Highlights

- **Lean TypeScript/Node runtime** using the official MCP SDK and lean Google API subpackages.
- **stdio MCP transport** for Claude Desktop, Claude Code, Cursor, and other MCP hosts.
- **Service-account and OAuth support** for different local authentication needs.
- **Structured JSON response envelope** for every tool: `ok`, `tool`, `input`, `data`/`error`, and `meta`.
- **Dynamic property selection**: agents should call `gsc_properties_list`, choose the exact property the user wants, and pass it as `site_url` in each request.
- **Fresh or finalized GSC data** via `GSC_DATA_STATE=all|final`.
- **Mock-tested Google API calls**; no credentials required for the test suite.

## Install / run

```bash
npm install
npm run build
node dist/index.js
```

For local development:

```bash
npm run lint
npm test
```

## MCP client config

Example Claude Desktop / Claude Code MCP config using a service-account key:

```json
{
  "mcpServers": {
    "gsc": {
      "command": "node",
      "args": ["/absolute/path/to/google-search-console-gsc-mcp/dist/index.js"],
      "env": {
        "GSC_KEY_FILE": "/absolute/path/to/service-account.json"
      }
    }
  }
}
```

Do **not** hardcode a property in the MCP client config unless you intentionally want a fallback default. The normal workflow is:

1. Call `gsc_properties_list`.
2. Select the exact Search Console property that matches the user's requested site.
3. Pass that property string as `site_url` to each follow-up tool call.

Important: do not log to stdout in stdio mode. This server only writes protocol messages to stdout and sends fatal startup errors to stderr.

## Authentication

### Service account

1. Create a Google Cloud service account and JSON key.
2. Add the service-account email as a user/owner in Google Search Console for the target property/properties.
3. Set one of:
   - `GSC_KEY_FILE=/absolute/path/key.json`
   - `GSC_CREDENTIALS_PATH=/absolute/path/key.json`
   - `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/key.json`
4. Call `gsc_properties_list` to discover accessible properties, then pass the chosen property as `site_url` in tool calls.

### OAuth mode

```bash
GSC_AUTH_MODE=oauth
GSC_OAUTH_SECRETS_FILE=/absolute/path/client_secret.json
```

OAuth tokens are cached at `~/.config/gsc-mcp/oauth-token.json` by default. Override with `GSC_OAUTH_TOKEN_FILE` or `GSC_CONFIG_DIR`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `GSC_AUTH_MODE` | `service_account` (default) or `oauth`. |
| `GSC_KEY_FILE` / `GSC_CREDENTIALS_PATH` / `GOOGLE_APPLICATION_CREDENTIALS` | Service-account JSON key path. |
| `GSC_OAUTH_SECRETS_FILE` / `GSC_OAUTH_CLIENT_SECRETS_FILE` | OAuth client secrets JSON. |
| `GSC_OAUTH_CLIENT_ID`, `GSC_OAUTH_CLIENT_SECRET` | OAuth credentials as env vars instead of a file. |
| `GSC_OAUTH_TOKEN_FILE` | OAuth token cache path. |
| `GSC_OAUTH_PORT` / `GSC_OAUTH_CALLBACK_PORT` | Local OAuth callback port; default `3847`. |
| `GSC_SITE_URL` | Optional fallback property if a tool call omits `site_url`; dynamic per-request `site_url` is preferred. |
| `GSC_SITE_URLS` | Optional comma-separated property fallback list for multi-property tools. |
| `GSC_DATA_STATE` | `all` (default, fresher) or `final` (confirmed data only). |

## Tool groups

### Setup and property tools

- `gsc_server_guide` — capabilities, auth status, configured fallbacks, and tool groups.
- `gsc_properties_list` — list accessible properties and exact identifiers.
- `gsc_property_get` — fetch details for one property.

### Search analytics tools

- `gsc_search_query` — flexible Search Console query with dimensions, filters, sorting, and row limits.
- `gsc_period_compare` — current-vs-prior period comparison grouped by chosen dimensions.
- `gsc_page_queries` — queries driving one page.

### Technical SEO tools

- `gsc_url_inspect` — normalized URL Inspection API result.
- `gsc_url_inspect_batch` — inspect up to ten URLs.
- `gsc_indexing_issue_scan` — batch inspection filtered to problem URLs.
- `gsc_sitemaps_list` — sitemap list and status metadata.
- `gsc_sitemap_get` — one sitemap detail.
- `gsc_sitemap_submit` — submit/resubmit a sitemap.

### SEO analysis tools

- `gsc_site_health` — site-level current/prior performance health.
- `gsc_rank_lift_opportunities` — near-page-one query/page opportunities.
- `gsc_ctr_gap_pages` — pages underperforming a position-based CTR benchmark.
- `gsc_uncovered_queries` — high-impression poor-ranking queries.
- `gsc_traffic_loss` — page losses with likely-cause diagnosis.
- `gsc_content_decay` — pages declining across three 30-day periods.
- `gsc_query_overlap` — queries with multiple competing pages.
- `gsc_section_performance` — performance for pages matching a path fragment.
- `gsc_alert_scan` — configurable recent performance alerts.
- `gsc_action_plan` — combined prioritized SEO recommendations.
- `gsc_claim_check` — verify a numeric claim against fresh GSC data.
- `gsc_multi_property_health` — compare multiple configured properties.

### Indexing API tools

- `gsc_index_notify` — notify Google about one updated/deleted URL.
- `gsc_index_notify_batch` — notify Google about up to 200 URLs.

Google documents the Indexing API primarily for JobPosting and BroadcastEvent-in-VideoObject pages. Acceptance by the API does not guarantee crawling, indexing, or ranking changes.

## Development notes

- Tests use mocked Google clients; no real GSC credentials are needed.
- Prefer adding pure transforms to `src/seo.ts` and Google API wrappers to `src/gsc.ts`.
- Keep every tool response in the shared envelope from `src/response.ts`.
- Use exact GSC property strings from `gsc_properties_list` to avoid `404` surprises.
