import { p } from '@/vx/text';
export const siblingActionAttempts = { count: 0 };
const refuse = async (...args: unknown[]) => {
  void args;
  siblingActionAttempts.count += 1;
  return { ok: false as const, error: p('Synthetic action refused', 'परीक्षण कार्रवाई रोकी गई') };
};
export const checkFamilyContactAction = refuse;
export const logFamilyContactAction = refuse;
export const replyToNoteAction = refuse;
export const setNoteStatusAction = refuse;
export const saveLanguageAction = refuse;
export const setViewAsAction = refuse;
