/**
 * A Google access token for the school's Drive, with no key anywhere (D-333).
 *
 * The organisation forbids service-account keys
 * (`iam.disableServiceAccountKeyCreation`), and a long-lived key in an
 * environment variable is the thing that leaks anyway. So the deployment
 * proves who it is with the OIDC token Vercel gives every function, and
 * Google trades it twice:
 *
 *   1. Security Token Service: the Vercel token → a federated token for the
 *      Workload Identity pool. The pool's provider only accepts tokens whose
 *      `sub` is this project's **production** environment, so a preview
 *      deployment or a laptop with `vercel env pull` gets nothing.
 *   2. IAM Credentials: the federated token → a one-hour token for the
 *      service account, which is a member of exactly one Shared Drive.
 *
 * Revoking access is removing the pool binding or the Shared Drive
 * membership; the next exchange then fails with `revoked`, and documents
 * already in Drive stay where they are.
 *
 * No `server-only` import, so the unit tests can exercise the exchange with a
 * fake `fetch`. Nothing in a browser imports this, and it holds no secret.
 */

export type WorkloadIdentityConfig = {
  projectNumber: string;
  poolId: string;
  providerId: string;
  serviceAccountEmail: string;
};

export type GoogleAuthFailure =
  /** No Vercel OIDC token: not running in a Vercel function. */
  | "no_identity"
  /** The pool refused the token, or the binding to the account is gone. */
  | "revoked"
  /** Google did not answer usefully; worth trying again later. */
  | "unavailable";

export class GoogleAuthError extends Error {
  constructor(
    readonly kind: GoogleAuthFailure,
    message: string,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

const STS_URL = "https://sts.googleapis.com/v1/token";
const IAM_CREDENTIALS = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts";
/** Renew this long before Google's expiry, so a slow upload never holds a dead token. */
const EARLY_RENEWAL_MS = 5 * 60 * 1000;

type Deps = {
  fetch: typeof fetch;
  now: () => number;
};

type Cached = { token: string; expiresAt: number; key: string };

let cached: Cached | null = null;

/** For tests: forget the cached token. */
export function forgetGoogleToken() {
  cached = null;
}

export function poolAudience(config: WorkloadIdentityConfig): string {
  return (
    `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/` +
    `workloadIdentityPools/${config.poolId}/providers/${config.providerId}`
  );
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; error_description?: unknown };
    const detail = typeof body.error_description === "string" ? body.error_description : "";
    const code =
      typeof body.error === "string"
        ? body.error
        : body.error && typeof body.error === "object" && "status" in body.error
          ? String((body.error as { status: unknown }).status)
          : "";
    return [code, detail].filter(Boolean).join(": ").slice(0, 200);
  } catch {
    return `HTTP ${response.status}`;
  }
}

function failureFor(status: number): GoogleAuthFailure {
  return status === 400 || status === 401 || status === 403 || status === 404 ? "revoked" : "unavailable";
}

/**
 * A Drive access token for the service account, cached in this function
 * instance until five minutes before it expires.
 */
export async function googleAccessToken(
  config: WorkloadIdentityConfig,
  oidcToken: string | null | undefined,
  deps: Deps = { fetch, now: Date.now },
): Promise<string> {
  const key = `${poolAudience(config)}|${config.serviceAccountEmail}`;
  if (cached && cached.key === key && cached.expiresAt - EARLY_RENEWAL_MS > deps.now()) {
    return cached.token;
  }

  if (!oidcToken) {
    throw new GoogleAuthError("no_identity", "No Vercel OIDC token on this request.");
  }

  let sts: Response;
  try {
    sts = await deps.fetch(STS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audience: poolAudience(config),
        grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
        requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
        scope: "https://www.googleapis.com/auth/cloud-platform",
        subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
        subjectToken: oidcToken,
      }),
      cache: "no-store",
    });
  } catch {
    throw new GoogleAuthError("unavailable", "Could not reach Google's token service.");
  }
  if (!sts.ok) {
    throw new GoogleAuthError(failureFor(sts.status), `Token exchange refused: ${await errorText(sts)}`);
  }
  const federated = (await sts.json()) as { access_token?: string };
  if (!federated.access_token) {
    throw new GoogleAuthError("unavailable", "Token exchange returned no token.");
  }

  let generated: Response;
  try {
    generated = await deps.fetch(
      `${IAM_CREDENTIALS}/${encodeURIComponent(config.serviceAccountEmail)}:generateAccessToken`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${federated.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ scope: [DRIVE_SCOPE], lifetime: "3600s" }),
        cache: "no-store",
      },
    );
  } catch {
    throw new GoogleAuthError("unavailable", "Could not reach Google's credentials service.");
  }
  if (!generated.ok) {
    throw new GoogleAuthError(
      failureFor(generated.status),
      `Service account token refused: ${await errorText(generated)}`,
    );
  }
  const body = (await generated.json()) as { accessToken?: string; expireTime?: string };
  const expiresAt = body.expireTime ? Date.parse(body.expireTime) : Number.NaN;
  if (!body.accessToken || !Number.isFinite(expiresAt)) {
    throw new GoogleAuthError("unavailable", "Service account token was incomplete.");
  }

  cached = { token: body.accessToken, expiresAt, key };
  return body.accessToken;
}
