import type { ReactNode } from "react";

/**
 * Step 1 of the send screen: the message, and what it looks like.
 *
 * Side by side on a wide desk; below `xl` the WhatsApp preview is a fold right
 * under the picker. It used to sit after the whole list — up to 400 rows down,
 * far from the choice it shows.
 *
 * A SERVER component handed to the workspace as one slot. Composed in the
 * client workspace it cost ~150 gzip bytes against `/fees/reminders`'
 * ceiling, which only ratchets down; here it costs the browser nothing.
 */
export function MessageBlock({
  savedCampaignName,
  noticeControls,
  preview,
}: {
  /** The saved campaign this run came from, if any. */
  savedCampaignName: string | null;
  noticeControls: ReactNode;
  /** The server-rendered WhatsApp bubble, or null when there is no family to show. */
  preview: ReactNode;
}) {
  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start xl:gap-6">
      <div className="min-w-0">
        {savedCampaignName ? (
          <p className="mb-2 text-xs text-muted-foreground">
            Running the saved campaign{" "}
            <strong className="font-semibold text-foreground">{savedCampaignName}</strong>. The
            list below is rebuilt from today&rsquo;s ledger, so anyone who has paid since the last
            run is already gone from it.
          </p>
        ) : null}
        {noticeControls}
        {preview ? (
          <details className="reveal mt-3 rounded-lg border border-border bg-card xl:hidden">
            <summary className="tap focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 text-[12.5px] font-bold text-foreground">
              See the message parents get
              <span className="text-[11px] font-semibold text-muted-foreground">Preview</span>
            </summary>
            <div className="px-3 pb-3">{preview}</div>
          </details>
        ) : null}
      </div>
      {preview ? <div className="hidden xl:sticky xl:top-4 xl:block">{preview}</div> : null}
    </div>
  );
}
