"use client";

import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, EmptyState } from "@/vx/ui/primitives";

const TEXT = {
  "no-session": { title: p("No academic session yet", "अभी कोई सत्र नहीं"), body: p("The office sets the session up first.", "पहले ऑफ़िस सत्र तय करता है।") },
  "not-yours": { title: p("This is not your class", "यह आपकी कक्षा नहीं"), body: p("You can open only the classes you teach.", "आप सिर्फ़ अपनी कक्षाएँ खोल सकते हैं।") },
  "not-found": { title: p("Not found", "नहीं मिला"), body: p("It may have been removed, or it is not in your classes.", "शायद हटा दिया गया, या आपकी कक्षाओं में नहीं।") },
} as const;

/** The empty and refused states of the teacher screens, in the reader's language. */
export function TeachEmpty({ kind, title, back }: { kind: keyof typeof TEXT; title: { en: string; hi: string }; back: string }) {
  const { tx } = useVx();
  const t = TEXT[kind];
  return (
    <VxPage>
      <TopBar title={tx(title)} mBack={back} />
      <Section>
        <Card>
          <EmptyState icon={kind === "not-yours" ? "lock" : "inbox"} title={tx(t.title)} body={tx(t.body)} action={<Btn href={back} icon="chevLeft">{tx(p("Back", "पीछे"))}</Btn>} />
        </Card>
      </Section>
    </VxPage>
  );
}
