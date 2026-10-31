import { PAY_COPY, type Bilingual } from "@/modules/payments/domain/online/pay-page-copy";
import { UPI_APPS, chromeIntentUrl, upiAppIntentUrl, type UpiApp } from "@/modules/payments/domain/online/upi-launch";
import { formatInr } from "@/platform/helpers/currency";

import { BRAND, Both, FullScreen } from "./pay-ui";

/**
 * "Which app will you pay with?" — the second, deliberate tap. WhatsApp's
 * browser will not follow Razorpay's redirect into a UPI app, but it does open
 * one the parent taps.
 *
 * Each app in its own colour, by name: recognisable at a glance with no logo
 * files (owner's decision, 2026-10-30). The app this phone used last time
 * comes first. An app that is not installed sends Android back to this page
 * with `?notice=app_missing`, and the panel brings these tiles back.
 */

const APP_STYLE: Record<UpiApp["key"], { background: string; color: string; border?: string }> = {
  phonepe: { background: "#5F259F", color: "#FFFFFF" },
  gpay: { background: "#FFFFFF", color: "#1A73E8", border: "#DADCE0" },
  paytm: { background: "#00BAF2", color: "#002E6E" },
  bhim: { background: "#F47920", color: "#FFFFFF" },
};

const LAST_APP_KEY = "vpps-pay-last-app";

function lastApp(): string | null {
  try {
    return localStorage.getItem(LAST_APP_KEY);
  } catch {
    return null;
  }
}

function rememberApp(key: string) {
  try {
    localStorage.setItem(LAST_APP_KEY, key);
  } catch {
    // Storage off: the order just stays the default one.
  }
}

export type UpiLink = { amountPaise: number; upiUri: string | null; shortUrl: string | null };

export function AppPicker({
  link,
  android,
  pageUrl,
  notice,
  onAppTapped,
  onBack,
}: {
  link: UpiLink;
  android: boolean;
  pageUrl: string;
  notice: Bilingual | null;
  onAppTapped: () => void;
  onBack: () => void;
}) {
  const amount = formatInr(link.amountPaise / 100);
  const last = lastApp();
  const apps = [...UPI_APPS].sort((a, b) => Number(b.key === last) - Number(a.key === last));
  const missingFallback = pageUrl ? `${pageUrl}?notice=app_missing` : undefined;
  const inChrome = pageUrl ? chromeIntentUrl(pageUrl) : null;

  return (
    <FullScreen label={PAY_COPY.chooseApp.en}>
      <div className="text-center">
        <Both text={PAY_COPY.chooseApp} className="text-lg font-bold text-foreground" />
        <p className="mt-2 text-4xl font-bold tabular-nums text-foreground">{amount}</p>
      </div>

      {notice ? (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <Both text={notice} />
        </div>
      ) : null}

      {android && link.upiUri ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {apps.map((app) => {
              const style = APP_STYLE[app.key];
              return (
                <a
                  key={app.key}
                  href={upiAppIntentUrl(link.upiUri as string, app, missingFallback)}
                  onClick={() => {
                    rememberApp(app.key);
                    onAppTapped();
                  }}
                  className="focus-ring flex min-h-[76px] flex-col items-center justify-center rounded-2xl border-2 px-2 text-lg font-bold shadow-sm"
                  style={{ backgroundColor: style.background, color: style.color, borderColor: style.border ?? style.background }}
                >
                  {app.label}
                  {app.key === last ? (
                    <span className="mt-0.5 rounded-full bg-black/15 px-2 text-[11px] font-semibold">{PAY_COPY.lastUsed.hi}</span>
                  ) : null}
                </a>
              );
            })}
          </div>
          <a
            href={link.upiUri}
            onClick={onAppTapped}
            className="focus-ring flex min-h-[56px] items-center justify-center rounded-xl border-2 border-border bg-card px-4 text-base font-semibold text-foreground"
          >
            <Both text={PAY_COPY.otherApp} />
          </a>
          {inChrome ? (
            <a href={inChrome} className="text-center text-sm text-muted-foreground underline underline-offset-4">
              {PAY_COPY.openInChrome.hi}
            </a>
          ) : null}
        </>
      ) : link.shortUrl ? (
        // iPhone or desktop: Razorpay's own page lists the UPI apps there.
        <a
          href={link.shortUrl}
          onClick={onAppTapped}
          className="focus-ring flex min-h-[60px] w-full items-center justify-center rounded-xl px-4 text-lg font-bold text-white"
          style={{ backgroundColor: BRAND }}
        >
          <Both text={PAY_COPY.continueToPay(amount)} />
        </a>
      ) : inChrome ? (
        // Android with no readable UPI address: Chrome follows Razorpay's redirect itself.
        <a href={inChrome} className="focus-ring flex min-h-[56px] items-center justify-center rounded-xl border-2 border-border px-4 text-base font-semibold">
          <Both text={PAY_COPY.openInChrome} />
        </a>
      ) : null}

      <button type="button" onClick={onBack} className="focus-ring mt-auto text-center text-base font-semibold text-foreground">
        <Both text={PAY_COPY.backToAmount} />
      </button>
    </FullScreen>
  );
}
