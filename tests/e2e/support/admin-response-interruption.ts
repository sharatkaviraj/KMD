import type { Page, Request, Route } from "@playwright/test";

export type AdminInterruptionEvidence = {
  forwarded: number;
  aborted: number;
  serverStatus: number;
  browserFailure: string;
};

/** Own the intercepted request until fetch, abort and browser failure settle. */
export async function interruptOneAdminResponse(page: Page, timeoutMs = 90_000) {
  const pattern = "**/collection/review**";
  let captured: Request | undefined;
  let forwarded = 0;
  let aborted = 0;
  let serverStatus = 0;
  let resolveHandled!: (result: { error?: unknown }) => void;
  let resolveFailed!: (failure: string) => void;
  const handled = new Promise<{ error?: unknown }>(resolve => { resolveHandled = resolve; });
  const failed = new Promise<string>(resolve => { resolveFailed = resolve; });
  const onFailed = (request: Request) => {
    if (request === captured) resolveFailed(request.failure()?.errorText ?? "unknown request failure");
  };
  page.on("requestfailed", onFailed);
  const handler = async (route: Route) => {
    const request = route.request();
    if (captured || request.method() !== "POST" || !request.headers()["next-action"] || new URL(request.url()).pathname !== "/collection/review") {
      await route.continue();
      return;
    }
    captured = request;
    try {
      ++forwarded;
      const response = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: 45_000 });
      serverStatus = response.status();
      if (serverStatus < 200 || serverStatus >= 400) throw new Error(`Admin action returned status ${serverStatus}; post-commit response loss not established`);
      await route.abort("failed");
      ++aborted;
      await response.dispose();
      resolveHandled({});
    } catch (error) {
      // A failed injection must fail its owner, never resolve as success.
      resolveHandled({ error });
    }
  };
  await page.route(pattern, handler);
  return {
    async finish(): Promise<AdminInterruptionEvidence> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          (async () => {
            const result = await handled;
            if (result.error) throw result.error;
            const browserFailure = await failed;
            // Removing a live handler continues the request in Playwright.
            // This happens only after the one terminal abort has completed.
            await page.unroute(pattern, handler);
            page.off("requestfailed", onFailed);
            return { forwarded, aborted, serverStatus, browserFailure };
          })(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Admin response interruption did not settle within its bound")), timeoutMs); }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
