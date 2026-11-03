// Browser fixtures outside School Office never perform certificate mutations.
// Keep the new lazy Student 360 module behind an explicit synthetic boundary.
export async function generateStudyCertificateAction() { return { ok: false as const, code: "unavailable" as const }; }
export async function certificateEventAction() { return { ok: false as const }; }
