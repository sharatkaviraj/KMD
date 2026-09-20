/**
 * An A4-landscape `@page` rule, scoped to the screen that renders it.
 *
 * `@page` is document-global: a `size: A4 landscape` in `globals.css` would
 * turn every receipt in the app sideways. So the one screen that needs
 * landscape carries the rule itself, and it exists only while that screen is
 * mounted.
 *
 * The monthly attendance register is that screen. A month of columns does not
 * cross A4 portrait, and a register that silently loses its last week is worse
 * than one that needs a setting changed.
 */
export function PrintLandscape() {
  return (
    <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
  );
}
