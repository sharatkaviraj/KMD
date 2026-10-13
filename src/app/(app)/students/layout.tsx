import type { ReactNode } from "react";

/**
 * The Students list and, over it, Student 360 as the design's drawer (D02).
 *
 * Opening a child from the list is intercepted (`@drawer/(.)[id]`): the list
 * stays where it was, scrolled and filtered, and the child's card slides in
 * over it. Opening `/students/[id]` from anywhere else, or reloading it,
 * renders the page itself, which draws the same drawer.
 */
export default function StudentsLayout({ children, drawer }: { children: ReactNode; drawer: ReactNode }) {
  return (
    <>
      {children}
      {drawer}
    </>
  );
}
