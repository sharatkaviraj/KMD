import { requirePermission } from "@/platform/auth/current-staff";
import { schoolNow } from "@/platform/auth/qa-clock";
import { isIsoDay, schoolToday } from "@/platform/dates";
import { listSubjects, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { loadCoverDraft, loadGuidedSetup } from "@/modules/substitutions/data/guided";
import { absencePeriods, normalizeChoices } from "@/modules/substitutions/domain/guided";
import { coverPhotoEnabled } from "@/lib/ai/access";
import { GuidedCoverScreen } from "@/vx/screens/timetable/guided-cover";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

export const metadata = { title: "Arrange cover" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Arrange cover, step by step (review C01): the primary way to mark a
 * teacher away and choose who covers. The Cover tab (`/timetable?view=subs`)
 * and the classic page (`/substitutions`) stay for the whole day at a glance.
 *
 *   ?day=YYYY-MM-DD                    the day (default today)
 *   ?staff=<id>&periods=0,1,2          open with who and when filled in; with
 *                                      both, it opens at the lessons step
 *   ?draft=<id>                        a saved suggestion to open with — see
 *                                      `loadCoverDraft`; none exist yet
 *
 * Only people who may manage cover open it: the same `substitutions:manage`
 * every cover write already asks for.
 */
export default async function ArrangeCoverPage(props: PageProps<"/substitutions/arrange">) {
  const staff = await requirePermission("substitutions:manage", "/substitutions/arrange");
  const { previewing } = await getViewer();
  const params = await props.searchParams;
  const today = schoolToday(await schoolNow(staff));
  const sessionLabel = await resolveSessionLabel();

  const draftId = typeof params.draft === "string" && UUID.test(params.draft) ? params.draft : null;
  const draft = draftId ? await loadCoverDraft(draftId, staff.id) : null;

  const askedDay = typeof params.day === "string" && isIsoDay(params.day) ? params.day : null;
  const day = draft?.day ?? askedDay ?? today;
  const askedStaff = typeof params.staff === "string" && UUID.test(params.staff) ? params.staff : null;
  const askedPeriods =
    typeof params.periods === "string" && params.periods
      ? absencePeriods("periods", params.periods.split(",").map((value) => Number(value)))
      : null;

  const [setup, subjects] = await Promise.all([
    sessionLabel ? loadGuidedSetup(sessionLabel, day) : Promise.resolve(null),
    listSubjects(),
  ]);

  const staffProfileId = draft?.staffProfileId ?? askedStaff;
  const photoTeacher = setup?.teachers.find((teacher) => teacher.id === askedStaff);
  const photoChoices = !draft && !previewing && coverPhotoEnabled(staff, sessionLabel) && photoTeacher && askedPeriods?.length === 1 &&
    photoTeacher.lessons.some((lesson) => lesson.period === askedPeriods[0]) &&
    typeof params.photoCover === "string" && setup?.teachers.some((teacher) => teacher.id === params.photoCover)
    ? normalizeChoices([{ needKey: params.photoNeed, coveringStaffId: params.photoCover }]) : null;
  const periods = draft?.periods ?? (photoChoices
    ? absencePeriods("periods", [...(photoTeacher?.away ?? []), ...(askedPeriods ?? [])])
    : askedPeriods && askedPeriods.length ? askedPeriods : null);

  return (
    <GuidedCoverScreen
      key={day}
      setup={setup}
      today={today}
      subjects={Object.fromEntries(subjects.filter((s) => s.isActive).map((s) => [s.code, { en: s.nameEn || s.code, hi: s.nameHi || undefined }]))}
      previewing={Boolean(previewing)}
      initial={{
        staffProfileId,
        periods,
        choices: draft?.choices ?? photoChoices ?? [],
        autoPreview: Boolean(staffProfileId && periods),
        fromDraft: Boolean(draft),
        draftMissing: Boolean(params.draft) && !draft,
      }}
    />
  );
}
