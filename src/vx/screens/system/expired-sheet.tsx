"use client";

import { clock } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import { Avatar, Btn } from "@/vx/ui/primitives";

/*
 * The signed-out dialog (design `Auth` · expired), drawn on its own so the
 * design fixture can show it without a Supabase client. The listening is in
 * `session-expired.tsx`.
 *
 * The design types the password into this dialog. Signing in stays on the
 * sign-in screen — one door, one admission check — so the dialog says who
 * was signed in and sends them there.
 */

const T = {
  title: p("You were signed out", "आप साइन आउट हो गए"),
  sub: p("Sign in again — nothing you saved is lost.", "फिर से साइन इन करें — सहेजा हुआ कुछ नहीं खोया।"),
  signedInAt: (time: string) => p(`Signed in at ${time} on this phone`, `इस फ़ोन पर ${time} बजे साइन इन किया`),
  signedIn: p("Signed in on this phone", "इस फ़ोन पर साइन इन था"),
  saved: p("Everything you saved is safe. Forms that keep a draft still have what you typed.", "जो सहेजा वह सुरक्षित है। ड्राफ़्ट रखने वाले फ़ॉर्म में आपका लिखा अब भी है।"),
  switchUser: p("Switch user", "दूसरा खाता"),
  signIn: p("Sign in", "साइन इन करें"),
};

export type ExpiredWho = { name: string; at: string | null };

function initialsOf(name: string): string {
  const words = name.replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

export function ExpiredSheet({ open, who, href }: { open: boolean; who: ExpiredWho | null; href: string }) {
  const { tx } = useVx();
  return (
    <Sheet
      open={open}
      onClose={() => undefined}
      dismissable={false}
      title={tx(T.title)}
      sub={tx(T.sub)}
      footer={
        <>
          <Btn variant="sec" icon="user" href="/login" style={{ flex: 1 }}>{tx(T.switchUser)}</Btn>
          <Btn variant="pri" icon="arrowRight" href={href} style={{ flex: 1.3 }}>{tx(T.signIn)}</Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 6 }}>
        {who ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 16, background: "var(--s2)" }}>
            <Avatar text={initialsOf(who.name)} size={42} bg="#81DAE4" />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span className="clip" style={{ fontSize: 15, fontWeight: 700 }}>{who.name}</span>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(who.at ? T.signedInAt(clock(who.at)) : T.signedIn)}</span>
            </span>
            <Ic n="clock" size={18} style={{ color: "var(--mut)" }} />
          </div>
        ) : null}
        <span style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12, color: "var(--mut)" }}>
          <Ic n="checkCircle" size={15} style={{ color: "var(--ok)", marginTop: 1 }} />
          {tx(T.saved)}
        </span>
      </div>
    </Sheet>
  );
}
