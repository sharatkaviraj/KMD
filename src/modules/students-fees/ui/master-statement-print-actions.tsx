"use client";

import { useTranslations } from "next-intl";

import Link from "@/ui/link";

import { Button } from "@/ui/primitives/button";

export function MasterStatementPrintActions({
  backHref,
}: {
  backHref: string;
}) {
  const t = useTranslations("FeeScreens");
  return (
    <div className="no-print flex flex-wrap items-center justify-end gap-2">
      <Button type="button" variant="outline" onClick={() => window.print()}>
        {t("printStatement")}
      </Button>
      <Button asChild variant="secondary">
        <Link href={backHref}>{t("backToStudent")}</Link>
      </Button>
    </div>
  );
}
