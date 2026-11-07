/**
 * The conduct a character certificate or a TC states. On its own, without
 * zod, so a screen that only offers the choice stays light.
 */
export const conductGrades = ["excellent", "very_good", "good", "satisfactory"] as const;
export type ConductGrade = (typeof conductGrades)[number];
