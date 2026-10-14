"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { logoutAction } from "@/app/login/actions";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { DesignMenu } from "@/vx/nav";
import { MenuToggles, PinnedRow, usePins } from "@/vx/shell/menu-prefs";
import { openSearch } from "@/vx/shell/top-actions";
import { setViewAsAction } from "@/vx/shell/view-as-actions";
import type { Pair } from "@/vx/text";
import { TopBar } from "@/vx/ui/page";

import { pinnedTiles, type MenuGroup } from "./menu-items";

export type MenuScreenProps = {
  menu: DesignMenu;
  name: string;
  initials: string;
  /** "Admin · every workspace", "Accountant". */
  sub: string;
  groups: MenuGroup[];
  /** "See the app as" — the admin only (UI-12, read-only). */
  previews: { key: string; label: Pair; icon: IconName }[];
  previewing: string | null;
};

const ACCOUNT: { title: Pair; tiles: { key: string; label: Pair; icon: IconName; href: string }[] } = {
  title: { en: "My account", hi: "मेरा खाता" },
  tiles: [
    { key: "language", label: { en: "Language and start screen", hi: "भाषा और पहली स्क्रीन" }, icon: "globe", href: "/preferences" },
    { key: "password", label: { en: "Change password", hi: "पासवर्ड बदलें" }, icon: "key", href: "/preferences/password" },
    { key: "session", label: { en: "Session", hi: "सत्र" }, icon: "calendar", href: "/preferences/session" },
  ],
};

const tileStyle = { display: "flex", alignItems: "center", gap: 10, minHeight: 58, padding: "8px 10px", borderRadius: 16, background: "var(--card)", border: "1px solid var(--bd)", color: "var(--fg)", textAlign: "left" } as const;

function TileIcon({ icon }: { icon: IconName }) {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: 36, height: 36, borderRadius: 11, background: "var(--s2)", color: "var(--pri)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Ic n={icon} size={18} />
    </span>
  );
}

function GroupHead({ title }: { title: Pair }) {
  const { tx, sub } = useVx();
  const second = sub(title);
  return (
    <h2 className="sech" style={{ gridColumn: "1 / -1", padding: "14px 2px 2px" }}>
      {tx(title)}
      {second ? <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}> · {second}</span> : null}
    </h2>
  );
}

function TileText({ label }: { label: Pair }) {
  const { tx, sub } = useVx();
  const second = sub(label);
  return (
    <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25 }}>{tx(label)}</span>
      {second ? <span style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.35 }}>{second}</span> : null}
    </span>
  );
}

function PreviewTile({ menu, label, icon, on }: { menu: string; label: Pair; icon: IconName; on: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="tap"
      aria-current={on ? "page" : undefined}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const href = await setViewAsAction(menu);
          router.push(href);
          router.refresh();
        })
      }
      style={{ ...tileStyle, borderColor: on ? "var(--acc)" : "var(--bd)" }}
    >
      <TileIcon icon={pending ? "refresh" : icon} />
      <TileText label={label} />
    </button>
  );
}

/**
 * The phone Menu (F13-Menu): the title, a search field that opens Ctrl K,
 * the person with Dark mode and Hindi labels, four pinned tiles, then every
 * screen this reader may open as two-column tiles grouped as the design
 * groups them, the account pages and Sign out. On a desk it is reached from
 * the person at the foot of the sidebar and draws the same, under a top bar.
 */
export function MenuScreen(props: MenuScreenProps) {
  const { tx } = useVx();
  const pins = usePins();
  const pinned = pinnedTiles(props.groups, pins, props.menu);
  const all = props.groups.flatMap((g) => g.tiles);

  return (
    <>
      <div className="only-d" style={{ display: "contents" }}>
        <TopBar title={tx({ en: "Menu", hi: "मेनू" })} />
      </div>
      <main>
        <div className="vx-menu" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
          <h1 className="serif only-m" style={{ margin: 0, fontSize: 30, fontWeight: 600 }}>{tx({ en: "Menu", hi: "मेनू" })}</h1>
          <button type="button" className="tap" onClick={openSearch} style={{ height: 48, borderRadius: 24, background: "var(--card)", border: "1px solid var(--bds)", color: "var(--mut)", display: "flex", alignItems: "center", gap: 10, padding: "0 16px", fontSize: 15, textAlign: "left" }}>
            <Ic n="search" />
            {tx({ en: "Search students, receipts, pages…", hi: "विद्यार्थी, रसीदें, पेज खोजें…" })}
          </button>

          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
              <span aria-hidden="true" style={{ flex: "none", width: 48, height: 48, borderRadius: 24, background: "var(--pri)", color: "var(--prifg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700 }}>{props.initials}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="clip" style={{ fontSize: 16, fontWeight: 700 }}>{props.name}</span>
                <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{props.sub}</span>
              </span>
            </div>
            <MenuToggles />
          </div>

          {pinned.length ? <PinnedRow pinned={pinned} all={all} /> : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {props.groups.map((g) => [
              <GroupHead key={`h-${g.title.en}`} title={g.title} />,
              ...g.tiles.map((x) => (
                <Link key={x.key} href={x.href} className="tap" style={tileStyle}>
                  <TileIcon icon={x.icon} />
                  <TileText label={x.label} />
                </Link>
              )),
            ])}
            {props.previews.length ? <GroupHead title={{ en: "See the app as", hi: "दूसरे रूप में देखें" }} /> : null}
            {props.previews.map((m) => (
              <PreviewTile key={m.key} menu={m.key} label={m.label} icon={m.icon} on={props.previewing === m.key} />
            ))}
            <GroupHead title={ACCOUNT.title} />
            {ACCOUNT.tiles.map((x) => (
              <Link key={x.key} href={x.href} className="tap" style={tileStyle}>
                <TileIcon icon={x.icon} />
                <TileText label={x.label} />
              </Link>
            ))}
          </div>

          <form action={logoutAction} style={{ marginTop: 10, display: "flex" }}>
            <button type="submit" className="tap btn sec" style={{ flex: 1, color: "var(--bad)" }}>
              <Ic n="logout" size={18} /> {tx({ en: "Sign out", hi: "साइन आउट" })}
            </button>
          </form>
          <span style={{ textAlign: "center", fontSize: 12, color: "var(--sub)" }}>{tx({ en: "VPPS One · staff workspace", hi: "VPPS One · स्टाफ़ कार्यक्षेत्र" })}</span>
        </div>
      </main>
    </>
  );
}
