import Link from "next/link";

import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";

export default function NotFound() {
  return (
    <div className="py-6">
      <EmptyState
        hi="यह पेज नहीं मिला।"
        en="That page does not exist."
        action={
          <Link href="/dashboard" className={buttonClasses({ variant: "outline" })}>
            मुख्य पर जाएँ · Go home
          </Link>
        }
      />
    </div>
  );
}
