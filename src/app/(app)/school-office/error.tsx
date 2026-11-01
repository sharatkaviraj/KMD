"use client";
import { useVx } from "@/vx/i18n";
import { Btn } from "@/vx/ui/primitives";
import { O } from "@/vx/screens/school-office/text";
export default function ErrorState({ reset }: { reset: () => void }) { const { tx } = useVx(); return <div className="vx pad" role="alert" style={{ padding: 24 }}><p>{tx(O.loadFailed)}</p><Btn onClick={reset}>{tx(O.retry)}</Btn></div>; }
