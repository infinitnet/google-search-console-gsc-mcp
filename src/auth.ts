import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import { searchconsole, searchconsole_v1 } from "@googleapis/searchconsole";
import { indexing, indexing_v3 } from "@googleapis/indexing";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import open from "open";
import { getConfig } from "./config.js";

const WEBMASTERS_SCOPE = "https://www.googleapis.com/auth/webmasters";
const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
const OAUTH_CALLBACK_PORT = Number(process.env.GSC_OAUTH_CALLBACK_PORT ?? process.env.GSC_OAUTH_PORT ?? 3847);

let searchConsoleClient: searchconsole_v1.Searchconsole | undefined;
let indexingClient: indexing_v3.Indexing | undefined;
let authPromise: Promise<unknown> | undefined;

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readOAuthSecrets(file?: string): { clientId: string; clientSecret: string } | undefined {
  if (!file) return undefined;
  if (!fs.existsSync(file)) throw new Error(`GSC OAuth secrets file does not exist: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    installed?: { client_id?: string; client_secret?: string };
    web?: { client_id?: string; client_secret?: string };
  };
  const block = parsed.installed ?? parsed.web;
  if (!block?.client_id || !block?.client_secret) throw new Error("OAuth secrets file must contain installed.client_id/client_secret or web.client_id/client_secret.");
  return { clientId: block.client_id, clientSecret: block.client_secret };
}

async function getOAuthClient(scopes: string[]): Promise<OAuth2Client> {
  const config = getConfig();
  const fromFile = readOAuthSecrets(config.oauthSecretsFile);
  const clientId = config.oauthClientId ?? fromFile?.clientId;
  const clientSecret = config.oauthClientSecret ?? fromFile?.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error("OAuth mode requires GSC_OAUTH_SECRETS_FILE or GSC_OAUTH_CLIENT_ID/GSC_OAUTH_CLIENT_SECRET.");
  }

  const redirectUri = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/oauth2callback`;
  const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);
  if (fs.existsSync(config.oauthTokenFile)) {
    oauth2.setCredentials(JSON.parse(fs.readFileSync(config.oauthTokenFile, "utf8")));
    return oauth2;
  }

  if (!authPromise) {
    authPromise = new Promise<string>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        try {
          const requestUrl = new URL(req.url ?? "/", redirectUri);
          if (requestUrl.pathname !== "/oauth2callback") return;
          const code = requestUrl.searchParams.get("code");
          if (!code) throw new Error("OAuth callback did not include an authorization code.");
          res.end("Google Search Console MCP authentication complete. You can close this tab.");
          server.close();
          resolve(code);
        } catch (error) {
          res.statusCode = 500;
          res.end("Authentication failed.");
          server.close();
          reject(error);
        }
      });
      server.listen(OAUTH_CALLBACK_PORT, "127.0.0.1", () => {
        const authUrl = oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: scopes });
        void open(authUrl).catch(() => console.error(`Open this URL to authenticate Google Search Console MCP: ${authUrl}`));
      });
      server.on("error", reject);
    });
  }

  const code = await authPromise;
  const { tokens } = await oauth2.getToken(code as string);
  oauth2.setCredentials(tokens);
  ensureDir(config.oauthTokenFile);
  fs.writeFileSync(config.oauthTokenFile, JSON.stringify(tokens, null, 2));
  authPromise = undefined;
  return oauth2;
}

async function getGoogleAuth(scopes: string[]): Promise<GoogleAuth | OAuth2Client> {
  const config = getConfig();
  if (config.authMode === "oauth") return getOAuthClient(scopes);
  if (!config.keyFile) throw new Error("Service-account mode requires GSC_KEY_FILE, GSC_CREDENTIALS_PATH, or GOOGLE_APPLICATION_CREDENTIALS.");
  if (!fs.existsSync(config.keyFile)) throw new Error(`Credential file does not exist: ${config.keyFile}`);
  return new GoogleAuth({ keyFile: config.keyFile, scopes });
}

export async function getSearchConsoleClient(): Promise<searchconsole_v1.Searchconsole> {
  if (!searchConsoleClient) {
    const auth = await getGoogleAuth([WEBMASTERS_SCOPE]);
    searchConsoleClient = searchconsole({ version: "v1", auth });
  }
  return searchConsoleClient;
}

export async function getIndexingClient(): Promise<indexing_v3.Indexing> {
  if (!indexingClient) {
    const auth = await getGoogleAuth([INDEXING_SCOPE]);
    indexingClient = indexing({ version: "v3", auth });
  }
  return indexingClient;
}

export function setClientsForTests(clients: { searchConsole?: searchconsole_v1.Searchconsole; indexing?: indexing_v3.Indexing }): void {
  searchConsoleClient = clients.searchConsole;
  indexingClient = clients.indexing;
}

export function resetClientsForTests(): void {
  searchConsoleClient = undefined;
  indexingClient = undefined;
  authPromise = undefined;
}

export function authStatusSummary(): { mode: string; configured: boolean; details: string[] } {
  const config = getConfig();
  const details: string[] = [];
  let configured = false;
  if (config.authMode === "oauth") {
    configured = Boolean(config.oauthSecretsFile || (config.oauthClientId && config.oauthClientSecret));
    details.push(`token cache: ${config.oauthTokenFile}`);
  } else {
    configured = Boolean(config.keyFile);
    details.push(config.keyFile ? `key file: ${config.keyFile}` : "no service-account key configured");
  }
  return { mode: config.authMode, configured, details };
}
