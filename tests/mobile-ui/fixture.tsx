import { useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import en from "../../src/messages/en.json";
import hi from "../../src/messages/hi.json";
import both from "../../src/messages/hi-en.json";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { SelectNative } from "@/ui/primitives/select-native";
import { Textarea } from "@/ui/primitives/textarea";
import { Sheet } from "@/ui/primitives/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/primitives/tabs";
import { MobileScreen, MobileRecordCard, MobileSectionCard, HeroMoney } from "@/ui/mobile/mobile-kit";
import { MobileBottomNav } from "@/ui/shell/mobile-bottom-nav";
import { mobileMoreGroupsFor } from "@/platform/config/mobile-navigation";
import { navigationFor } from "@/platform/config/navigation";
import { feeRoleFor } from "@/platform/auth/fee-roles";
import { roleLabel, staffRoles, type StaffRole } from "@/platform/auth/permissions";
import { primary, type Language } from "@/platform/i18n/language";
import "../../src/app/globals.css";

const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "hi" ? "hi" : params.get("locale") === "hi-en" ? "hi-en" : "en";
const language: Language = locale === "hi-en" ? "both" : locale;
const requestedRole = params.get("role");
const role: StaffRole = staffRoles.find((value) => value === requestedRole) ?? "teacher";
const catalogs = { en, hi, "hi-en": both };
document.documentElement.lang = locale === "hi-en" ? "hi" : locale;
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");

function Fixture() {
  const [open, setOpen] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);
  return <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>
    <main className="mobile-app-main px-4 py-4" data-bottom-nav="true" id="main-content" tabIndex={-1}>
      <MobileScreen>
        <h1 className="text-2xl font-semibold">Mobile workspace fixture</h1>
        <p className="text-sm text-muted-foreground">Synthetic test records. No database or account sign-in.</p>
        <MobileSectionCard title="Today's work">
          <HeroMoney value={98765432} />
          <Button className="mt-4" onClick={() => setOpen(true)}>Open task sheet</Button>
        </MobileSectionCard>
        <form className="space-y-4" onSubmit={event => event.preventDefault()}>
          <label className="block">Student search<Input id="student-search" inputSize="sm" placeholder="Name or SR" /></label>
          <label className="block">Class<SelectNative id="class"><option>Class 10 · Long bilingual section दसवीं कक्षा</option></SelectNative></label>
          <label className="block">Notes<Textarea id="notes" /></label>
          <Button type="submit" size="icon-lg" aria-label="Save notes">✓</Button>
        </form>
        <Tabs defaultValue="today">
          <TabsList aria-label="Work views"><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
          <TabsContent value="today"><p className="py-2">Today&apos;s register</p></TabsContent>
          <TabsContent value="history"><p className="py-2">Saved registers</p></TabsContent>
        </Tabs>
        <ul className="space-y-4" aria-label="Synthetic student records">
          {Array.from({ length: 14 }, (_, index) => <MobileRecordCard key={index}
            title={`Test student ${index + 1} · लंबा परीक्षण नाम बालक और छात्रा के लिए SyntheticLongUnbrokenNameToTestWrapping`}
            subtitle="Class 10 · Admission SR-012345 · enrolled"
            amount="₹12,34,567" status="Pending"
            fields={[{ label: "Amount due", value: "₹12,34,567" }, { label: "Reason", value: "A long explanation remains readable and wraps across multiple lines" }]}
            actions={<Button variant="outline">Open record</Button>}
          />)}
        </ul>
        <Button id="last-row" variant="outline">Last task on the page</Button>
      </MobileScreen>
    </main>
    <MobileBottomNav staffRole={feeRoleFor(role)} staffRoleLabel={primary(roleLabel(role), language)} staffEmail="synthetic.staff@example.invalid"
      items={navigationFor(role).map(item => ({ href: item.href, label: primary(item.label, language) }))}
      moreGroups={mobileMoreGroupsFor(role, language)} />
    <Sheet open={open} onClose={() => setOpen(false)} title="Task sheet" description="Choose a synthetic task" historyDismiss={false}
      footer={<Button fullWidth onClick={() => setOpen(false)}>Finish task</Button>}>
      <label className="block">Sheet notes<Input id="sheet-notes" /></label>
      <Button className="mt-4" onClick={() => setNestedOpen(true)}>Open nested sheet</Button>
      {Array.from({ length: 20 }, (_, index) => <p className="py-3" key={index}>Task detail {index + 1}</p>)}
    </Sheet>
    <Sheet open={nestedOpen} onClose={() => setNestedOpen(false)} title="Nested task" historyDismiss={false}>
      <Button onClick={() => setNestedOpen(false)}>Return to task</Button>
    </Sheet>
  </NextIntlClientProvider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
