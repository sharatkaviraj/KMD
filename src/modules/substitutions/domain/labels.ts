import type { MatchTier } from "@/modules/substitutions/domain/engine";
import { t, type Localized } from "@/platform/i18n/language";

/**
 * What the engine's tiers, warnings and blocks are called on a screen.
 *
 * Kept out of `plan.ts` so that module imports nothing but types: the seeding
 * script in `scripts/` loads the planning logic directly under Node's type
 * stripping, and a `@/` alias there would need a bundler. Labels are
 * presentation anyway, and the rules they describe are not.
 */

export const tierLabels: Record<MatchTier, Localized> = {
  class_subject: t("यही कक्षा, यही विषय", "Their class and subject"),
  class: t("यही कक्षा", "Their class"),
  exact: t("यही विषय", "Their subject"),
  approved: t("स्वीकृत", "Approved for it"),
  related: t("मिलता-जुलता विषय", "Related subject"),
  general: t("कोई भी", "Any free teacher"),
  last_resort: t("प्रभारी — अंत में", "Duty-holder, last"),
  reserve: t("कार्यालय — पूछकर", "Office, only if asked"),
};

export const warningLabels: Record<string, Localized> = {
  reserve_staff: t("कार्यालय का स्टाफ़", "Office staff — ask first"),
  duty_holder: t("प्रभारी", "Has a duty this period"),
  class_not_subject: t("विषय अलग है", "Knows the class, not the subject"),
  related_subject: t("मिलता-जुलता विषय", "Related subject only"),
  subject_mismatch: t("विषय नहीं पढ़ाते", "Does not teach this subject"),
  over_substitution_limit: t("आज की सीमा पार", "Over today's cover limit"),
  full_day: t("पूरा दिन भरा", "No free period left"),
  excessive_consecutive: t("लगातार बहुत पीरियड", "Too many periods in a row"),
};

export const blockLabels: Record<string, Localized> = {
  absent: t("अनुपस्थित", "Away this period"),
  regular_class: t("अपनी कक्षा है", "Teaching their own class"),
  double_booked: t("पहले से दिया गया", "Already covering another class"),
  unavailable: t("इस समय विद्यालय में नहीं", "Not in school this period"),
  unknown_teacher: t("यह नाम नहीं मिला", "No such staff member"),
};
