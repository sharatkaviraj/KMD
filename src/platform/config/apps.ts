import * as m from "@/messages/pairs";
import type { Localized } from "@/platform/i18n/language";
import type { StaffRole } from "@/platform/auth/permissions";
import {
  idsTravelBetween,
  verifiedOrigin,
  type AppId,
  type OriginEnvironment,
} from "@/platform/config/app-origins";

/**
 * The school's three applications, and how to get from here to the other two.
 *
 * PLAN §2 asks for "a typed registry with stable IDs, names, environment,
 * origin, visibility and validated route builders". This is it. Two properties
 * are doing the work:
 *
 * **Every URL is built here, from `app-origins.ts`.** Nothing else in the app
 * writes a sibling hostname, because two of the three a reader would guess are
 * wrong and one of them belongs to a different company (B-15, D-108).
 *
 * **A link never carries an id across a dataset boundary.** VPPS One runs on
 * schoolfees-dev and both siblings run on live data, so a student id from here
 * means nothing there. The builders below fall back to the destination's own
 * search screen rather than emitting a URL that will 404 with a child's name on
 * it — which is PLAN §2's rule, made into a function instead of a habit.
 *
 * What this file is **not**: a claim about what the destination will let you
 * do. A launcher does not grant a fee role. The destination decides, and the
 * card says so.
 */

export type AppLinkKind = "home" | "search" | "detail";

export type AppLink = {
  href: string;
  /**
   * What the link will actually open.
   *
   * The caller needs this to label the button honestly: "Find this child in
   * School Fees" is a different promise from "Open this child in School Fees",
   * and shipping the second while doing the first is how a member of staff
   * stops trusting the button.
   */
  kind: AppLinkKind;
};

export type StudentContext = {
  /** `public.students.id` as VPPS One holds it. */
  studentId?: string | null;
  /** What to type into the destination's search box: an SR number or a name. */
  search?: string | null;
  /**
   * The destination app's **own** id for this child, if we hold a mapping.
   *
   * Only SamPark needs one — the fee app's ids are the ids VPPS One already
   * holds. Resolved by `external-ids-repo.ts`; null whenever no mapping row
   * applies to the dataset being read, which today is always (S-10).
   */
  externalId?: string | null;
};

export type SchoolApp = {
  id: AppId;
  /** The name staff already use, with what it is for (PLAN §3a). */
  name: Localized;
  purpose: Localized;
  origin: string;
  /** Which dataset the destination serves, which is not always this app's. */
  environment: OriginEnvironment;
  /** False only for VPPS One itself. */
  isExternal: boolean;
  /** Roles that see the app offered. The destination still decides access. */
  visibleTo: readonly StaffRole[];
  /** The app's own front door. */
  home: AppLink;
  /** Where to send somebody looking for one child. */
  student(context: StudentContext, from: OriginEnvironment): AppLink;
};

/* --------------------------------------------------------- building URLs */

/**
 * The paths each app is allowed to be linked to.
 *
 * An allow-list rather than string concatenation at the call site, because
 * "validated route builders" has to mean something a test can check. A path
 * that is not in here cannot be linked to at all, so a typo becomes a build
 * error rather than a 404 somebody finds in a corridor.
 */
const PATHS = {
  schoolfees: {
    home: "/protected/dashboard",
    students: "/protected/students",
    student: (id: string) => `/protected/students/${id}`,
    payments: "/protected/payments",
    transactions: "/protected/transactions",
    defaulters: "/protected/defaulters",
    reminders: "/protected/reminders",
  },
  sampark: {
    home: "/",
    students: "/students",
    // SamPark's admin routes sit in an `(admin)` route group, so the URL is
    // `/students/<its own text id>`. Read off its own `src/app` tree at
    // `830548c`, not guessed.
    student: (id: string) => `/students/${id}`,
    requests: "/requests",
    review: "/review",
  },
  vppsone: {
    home: "/dashboard",
  },
} as const;

function url(appId: AppId, path: string, query?: Record<string, string>): string {
  const origin = verifiedOrigin(appId).origin;

  if (!path.startsWith("/")) {
    throw new Error(`Refusing to build ${appId} link: "${path}" is not a path.`);
  }

  const search = new URLSearchParams(
    Object.entries(query ?? {}).filter(([, value]) => value.trim() !== ""),
  ).toString();

  return `${origin}${path}${search ? `?${search}` : ""}`;
}

/* ------------------------------------------------------------ the three */

const OFFICE_AND_ADMIN: readonly StaffRole[] = ["admin", "office"];

export const SCHOOL_APPS: readonly SchoolApp[] = [
  {
    id: "schoolfees",
    name: m.appSchoolFees,
    purpose: m.appSchoolFeesPurpose,
    origin: verifiedOrigin("schoolfees").origin,
    environment: verifiedOrigin("schoolfees").environment,
    isExternal: true,
    visibleTo: OFFICE_AND_ADMIN,
    home: { href: url("schoolfees", PATHS.schoolfees.home), kind: "home" },
    student(context, from) {
      const to = verifiedOrigin("schoolfees").environment;

      // The fee app owns `public.students`, so its ids are the ones VPPS One
      // already holds — this is the one deep link that could ever be exact.
      // It still only fires when both sides are looking at the same database.
      if (context.studentId && idsTravelBetween(from, to)) {
        return {
          href: url("schoolfees", PATHS.schoolfees.student(context.studentId)),
          kind: "detail",
        };
      }

      return {
        href: url("schoolfees", PATHS.schoolfees.students, {
          query: context.search ?? "",
        }),
        kind: "search",
      };
    },
  },
  {
    id: "sampark",
    name: m.appSampark,
    purpose: m.appSamparkPurpose,
    origin: verifiedOrigin("sampark").origin,
    environment: verifiedOrigin("sampark").environment,
    isExternal: true,
    visibleTo: OFFICE_AND_ADMIN,
    home: { href: url("sampark", PATHS.sampark.home), kind: "home" },
    student(context, from) {
      const to = verifiedOrigin("sampark").environment;

      // **Two gates, and both have to clear.** SamPark keeps its own student
      // ids — text, from its own imports — so a deep link needs a mapping row
      // (`vppsone.external_student_ids`, S-10) *and* the same dataset on both
      // sides. The mapping alone is not enough: a row matched against dev
      // would not 404 on live, it would open a different child.
      //
      // Nothing populates the mapping table yet — the matcher lands with the
      // student source tooling in R4.1 — so `externalId` is null in practice
      // and this still degrades to search. That is the same honest behaviour
      // as before; what changed is that it is now a missing row rather than a
      // missing mechanism.
      if (context.externalId && idsTravelBetween(from, to)) {
        return {
          href: url("sampark", PATHS.sampark.student(context.externalId)),
          kind: "detail",
        };
      }

      // Guessing by name is the one thing PARITY.md says never to do, so the
      // search box is the honest destination.
      return {
        href: url("sampark", PATHS.sampark.students, { query: context.search ?? "" }),
        kind: "search",
      };
    },
  },
];

export function schoolApp(id: AppId): SchoolApp {
  const found = SCHOOL_APPS.find((app) => app.id === id);
  if (!found) throw new Error(`No app registered as ${id}`);
  return found;
}

/** The apps this role is offered, in the order they appear on a hub. */
export function appsFor(role: StaffRole): SchoolApp[] {
  return SCHOOL_APPS.filter((app) => app.visibleTo.includes(role));
}

/**
 * How an app's data should be described beside its name.
 *
 * VPPS One's own environment badge says "test", and PLAN §2 is explicit that
 * it must not be read as covering a linked app. Both siblings are pointed at
 * live school data while this app is on schoolfees-dev, so every card carries
 * its **own** label rather than inheriting this one's.
 */
export function environmentLabel(environment: OriginEnvironment): Localized {
  return environment === "live" ? m.appLiveData : m.appTestData;
}

/**
 * The warning a card shows when this app and the destination hold different
 * data. Null when they match, so the notice does not become wallpaper.
 */
export function crossEnvironmentNotice(
  from: OriginEnvironment,
  app: SchoolApp,
): Localized | null {
  if (idsTravelBetween(from, app.environment)) return null;
  return app.environment === "live" ? m.appOpensLiveData : m.appOpensTestData;
}

/**
 * A short, honest label for what a student link will do.
 *
 * Used instead of a single "Open in School Fees" everywhere, because a search
 * link and a detail link are different promises.
 */
export function studentLinkLabel(kind: AppLinkKind): Localized {
  return kind === "detail" ? m.appOpenThisChild : m.appFindThisChild;
}

/** Every path this registry can build, for the test that no link is invented. */
export const LINKABLE_PATHS: readonly string[] = [
  ...Object.values(PATHS.schoolfees).map((entry) =>
    typeof entry === "function" ? entry(":id") : entry,
  ),
  ...Object.values(PATHS.sampark).map((entry) =>
    typeof entry === "function" ? entry(":id") : entry,
  ),
  ...Object.values(PATHS.vppsone),
];
