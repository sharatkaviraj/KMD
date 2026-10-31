export type DeliveryReason = "changed" | "complete" | "phone" | "reconcile" | "already_handled" | "unavailable" | "test_mode" | "rejected" | "no_consent";
export type DeliveryResult = { ok: true; state: "accepted" | "manual_opened"; url?: string } | { ok: false; reason: DeliveryReason };
export type DeliveryPreview = { ok: true; id: string; digest: string; taskId: string; kind: "initial" | "reminder"; phone: string; name: string; title: string; due: string | null; expected: number; answered: number; textHi: string; textEn: string;
  studentCount: number; fields: {id:string;hi:string;en:string}[]; scope: {session:string;classLabel:string|null;subject:{hi:string;en:string}|null;day:string|null};
};
export type DeliverySummary = {
  pending?: boolean; openedAt?: string | null; expected?: number; answered?: number; approved?: number; rejected?: number;
  deliveries: { id: string; state: "ready" | "unknown" | "rejected" | "accepted" | "manual_opened" | "human_confirmed" | "legacy_recorded"; transport: "aisensy" | "manual" | null; phone: string; at: string; round: string; attempt: string | null; history: { event: string; actor: string; at: string; note?: string; resolution?: string }[] }[];
};
