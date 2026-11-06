import { t } from "@/platform/i18n/language";

/**
 * Task-assignment words that everyday list screens use (the "Assign work"
 * launcher and the missing-details filter on /students). A module of their
 * own because webpack keeps a module whole: any client file importing anything
 * from `./setup` ships the entire set-up catalogue, so /students used to carry
 * it for these eight labels (D-229). `ms` in `./setup` re-spreads them, so
 * `ms.taskAssign` and friends keep working everywhere else.
 */
export const taskAssignMessages = {
  taskAssign: t("काम सौंपें", "Assign work"),
  taskMissing: t("अधूरी जानकारी छाँटें", "Filter missing details"),
  taskMissingAny: t("अधूरी जानकारी…", "Missing details…"),
  taskMissingTitle: t("अधूरी जानकारी", "Missing details"),
  taskNoPhoto: t("फोटो नहीं", "No photo"),
  taskUnavailable: t("शिक्षकों के काम अभी पढ़ नहीं सके। फिर प्रयास करें।", "Teacher tasks could not be read. Try again."),
  taskTryAgain: t("फिर प्रयास करें", "Try again"),
  taskUnmatched: t(
    "कुछ बच्चे One में इस सत्र में दर्ज हैं पर Fees की मौजूदा सूची में नहीं हैं (छोड़ दिया, कक्षा बदली या रोका गया)। वे इस सूची में नहीं दिखेंगे। संख्या:",
    "Some children are enrolled in One this session but not on the current Fees roster (left, moved class or held). They are left out of this list. Count:",
  ),
};
