import { type ReactNode } from "react";

import { Section } from "@/ui/primitives/section";

type SectionCardProps = {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * Backwards-compatible wrapper around the new `Section` primitive.
 * Renders the canonical card chrome (the design's 18px card) so legacy callers
 * keep their familiar shape. New code can import `Section` directly.
 */
export function SectionCard({ id, title, description, children, actions, className }: SectionCardProps) {
  return (
    <Section
      id={id}
      title={title}
      description={description}
      actions={actions}
      className={className}
    >
      {children}
    </Section>
  );
}
