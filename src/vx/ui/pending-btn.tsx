"use client";

import { useFormStatus } from "react-dom";

import { cue } from "@/ui/feedback/cue";
import { Ic, type IconName } from "@/vx/icons";

/**
 * A form's submit button in the screen kit's look, which shows that it is
 * working: the icon turns into a spinning arrow and the label says what is
 * happening ("Checking…", "Saving…") until the server answers. A light tap
 * cue on press; `confirm` asks first for a step that reaches a person.
 *
 * Must sit INSIDE its `<form>`: `useFormStatus` reads the nearest ancestor.
 */
export function PendingBtn({
  label,
  pendingLabel,
  icon,
  variant = "sec",
  big,
  confirm,
  name,
  value,
}: {
  label: string;
  pendingLabel: string;
  icon?: IconName;
  variant?: "pri" | "sec" | "soft" | "ghost" | "danger";
  big?: boolean;
  confirm?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={`tap btn ${variant}${big ? " big" : ""}`}
      disabled={pending}
      aria-busy={pending}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) {
          event.preventDefault();
          return;
        }
        cue("tap");
      }}
    >
      {pending ? (
        <Ic n="refresh" size={big ? 20 : 18} style={{ animation: "xLoop .9s linear infinite" }} />
      ) : icon ? (
        <Ic n={icon} size={big ? 20 : 18} />
      ) : null}
      {pending ? pendingLabel : label}
    </button>
  );
}
