import { logoutAction } from "@/app/login/actions";
import { requireStaff } from "@/platform/auth/current-staff";
import {
  permissionsFor,
  roleLabels,
  roleLabelsEn,
} from "@/platform/auth/permissions";
import { getSchoolName } from "@/platform/env";
import { EnvironmentBadge } from "@/ui/environment-badge";

export const runtime = "nodejs";

export const metadata = {
  title: "डैशबोर्ड · VPPS One",
};

/**
 * A placeholder, and deliberately a thin one: it exists to prove that sign-in
 * works, that the profile was found, and that the role came from
 * `vppsone.staff_profiles`. Phase 1.2 replaces it with the real shell.
 */
export default async function DashboardPage() {
  const staff = await requireStaff("/dashboard");
  const permissions = permissionsFor(staff.role);

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <div className="mb-6 space-y-3">
        <EnvironmentBadge />
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          VPPS One
        </h1>
        <p className="text-[15px] leading-6 text-slate-600">{getSchoolName()}</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-[13px] font-medium uppercase tracking-wide text-slate-500">
          साइन इन · Signed in
        </p>

        <p className="mt-2 text-xl font-semibold text-slate-900">
          {staff.displayName}
        </p>
        <p className="text-[14px] text-slate-600">{staff.email}</p>

        <dl className="mt-5 space-y-3 text-[15px]">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-slate-500">भूमिका · Role</dt>
            <dd className="text-right font-medium text-slate-900">
              {roleLabels[staff.role]}
              <span className="ml-2 text-[13px] font-normal text-slate-500">
                {roleLabelsEn[staff.role]}
              </span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-slate-500">संक्षिप्त नाम · Short name</dt>
            <dd className="font-mono text-[14px] font-medium text-slate-900">
              {staff.shortName}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-slate-500">अध्यापन · Teaching</dt>
            <dd className="font-medium text-slate-900">
              {staff.isTeaching ? "हाँ · Yes" : "नहीं · No"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-[13px] font-medium uppercase tracking-wide text-slate-500">
          अनुमतियाँ · Permissions ({permissions.length})
        </p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {permissions.map((permission) => (
            <li
              key={permission}
              className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700"
            >
              {permission}
            </li>
          ))}
        </ul>
      </section>

      <form action={logoutAction} className="mt-6">
        <button
          type="submit"
          className="h-12 w-full rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-900 transition active:scale-[0.99]"
        >
          साइन आउट · Sign out
        </button>
      </form>
    </main>
  );
}
