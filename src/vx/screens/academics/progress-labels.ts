import type { Say } from "./ui";

/** What was done about a child, in a few words: "Spoke to parent", "Improving". */
export function followLabel(kind: string, outcome: string | null, say: Say): string {
  if (kind === "improving") return say("Improving", "सुधार");
  if (kind === "follow_up") return say("Follow-up assigned", "फ़ॉलो-अप सौंपा");
  const map: Record<string, [string, string]> = {
    reached: ["Spoke to parent", "अभिभावक से बात"],
    no_answer: ["No answer", "जवाब नहीं"],
    wrong_number: ["Wrong number", "गलत नंबर"],
    will_come: ["Will come", "आएगा"],
    visit_school: ["Parent visiting", "अभिभावक आएँगे"],
    // Family contact (D-265): what happened, never "message sent".
    attempted: ["Tried, not reached", "संपर्क की कोशिश"],
    spoke: ["Spoke with family", "परिवार से बात हुई"],
    follow_up_agreed: ["Follow-up agreed", "आगे की बात तय"],
  };
  const [en, hi] = map[outcome ?? ""] ?? ["Called", "कॉल किया"];
  return say(en, hi);
}
