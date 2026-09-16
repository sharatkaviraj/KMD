import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "VPPS One",
    template: "%s",
  },
  description:
    "Shri Veer Patta Senior Secondary School — staff, timetable, attendance, assessments.",
};

export const viewport: Viewport = {
  // Phones first. `maximumScale` is deliberately not set: capping zoom locks
  // out anybody who needs to enlarge the text.
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // lang="hi": the interface is Hindi first, with English alongside. This is
  // what tells a screen reader which voice to read the labels in.
  return (
    <html lang="hi" className="h-full">
      <body className="min-h-dvh bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
