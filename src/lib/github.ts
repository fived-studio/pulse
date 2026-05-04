import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { env } from "~/env";

let cached: Octokit | null = null;
let cachedAt = 0;

/**
 * Returns an Octokit client authenticated as the App's installation on the
 * configured org. Returns null if the App credentials aren't configured —
 * callers should treat that as "feature disabled".
 *
 * Octokit handles installation-token rotation internally; we cache the
 * client itself for 30 minutes to avoid the org-installation lookup on
 * every call.
 */
export async function getInstallationOctokit(): Promise<Octokit | null> {
  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_APP_PRIVATE_KEY ||
    env.GITHUB_APP_PRIVATE_KEY === "placeholder"
  ) {
    return null;
  }

  if (cached && Date.now() - cachedAt < 30 * 60 * 1000) return cached;

  const privateKey = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: env.GITHUB_APP_ID, privateKey },
  });

  let installationId: number;
  try {
    const { data } = await appOctokit.request("GET /orgs/{org}/installation", {
      org: env.FIVED_ORG,
    });
    installationId = data.id;
  } catch (err) {
    console.error("[github] failed to resolve installation id", err);
    return null;
  }

  cached = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: env.GITHUB_APP_ID, privateKey, installationId },
  });
  cachedAt = Date.now();
  return cached;
}
