import os from "node:os";
import path from "node:path";

export type AuthMode = "service_account" | "oauth";

export interface ServerConfig {
  authMode: AuthMode;
  keyFile?: string;
  oauthSecretsFile?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthTokenFile: string;
  siteUrl?: string;
  siteUrls: string[];
  dataState: "all" | "final";
  writeToolsEnabled: boolean;
  allowSitemapSubmit: boolean;
  allowIndexingApi: boolean;
}

function expandPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let out = value.trim();
  if (!out) return undefined;
  if (out === "~") out = os.homedir();
  else if (out.startsWith("~/")) out = path.join(os.homedir(), out.slice(2));
  return out.replace(/\$HOME/g, os.homedir());
}

function boolEnv(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function parseSiteUrls(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getConfig(): ServerConfig {
  const authMode = (process.env.GSC_AUTH_MODE?.toLowerCase() === "oauth" ? "oauth" : "service_account") as AuthMode;
  const siteUrls = parseSiteUrls(process.env.GSC_SITE_URLS);
  const siteUrl = process.env.GSC_SITE_URL?.trim() || siteUrls[0];
  const dataStateRaw = process.env.GSC_DATA_STATE?.toLowerCase() ?? "all";
  const dataState = dataStateRaw === "final" ? "final" : "all";
  const configDir = expandPath(process.env.GSC_CONFIG_DIR) ?? path.join(os.homedir(), ".config", "gsc-mcp");
  const writeToolsEnabled = boolEnv("GSC_ENABLE_WRITE_TOOLS", false);
  return {
    authMode,
    keyFile: expandPath(process.env.GSC_KEY_FILE ?? process.env.GSC_CREDENTIALS_PATH ?? process.env.GOOGLE_APPLICATION_CREDENTIALS),
    oauthSecretsFile: expandPath(process.env.GSC_OAUTH_SECRETS_FILE ?? process.env.GSC_OAUTH_CLIENT_SECRETS_FILE),
    oauthClientId: process.env.GSC_OAUTH_CLIENT_ID,
    oauthClientSecret: process.env.GSC_OAUTH_CLIENT_SECRET,
    oauthTokenFile: expandPath(process.env.GSC_OAUTH_TOKEN_FILE) ?? path.join(configDir, "oauth-token.json"),
    siteUrl,
    siteUrls: siteUrls.length ? siteUrls : siteUrl ? [siteUrl] : [],
    dataState,
    writeToolsEnabled,
    allowSitemapSubmit: writeToolsEnabled && boolEnv("GSC_ENABLE_SITEMAP_SUBMIT", true),
    allowIndexingApi: writeToolsEnabled && boolEnv("GSC_ENABLE_INDEXING_API", true)
  };
}

export function resolveSiteUrl(input?: string): string {
  const siteUrl = input?.trim() || getConfig().siteUrl;
  if (!siteUrl) {
    throw new Error("No Search Console property selected. Call gsc_properties_list, choose the exact property requested by the user, and pass it as site_url. GSC_SITE_URL is only an optional fallback.");
  }
  return siteUrl;
}

export function explainPropertyFormat(siteUrl: string): string | undefined {
  if (siteUrl.startsWith("sc-domain:")) return undefined;
  try {
    new URL(siteUrl);
    return undefined;
  } catch {
    return "GSC properties must exactly match Search Console, e.g. sc-domain:example.com or https://www.example.com/. Use gsc_properties_list to confirm.";
  }
}
