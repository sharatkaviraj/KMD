/**
 * The small part of @testing-library/react and @testing-library/user-event
 * that the ported pay-page interaction test uses, on react-dom/client and
 * jsdom (go-live Phase E).
 *
 * The fees app drives `tests/ui/interaction/pay-checkout-panel.test.tsx` with
 * those two packages; One does not install them (the same reason
 * `student-info-select-options.test.tsx` renders with react-dom/server). This
 * keeps the ported test's body unchanged: the same queries, by role and
 * accessible name, the same clicks and typing. What it does NOT do is the
 * full accessible-name algorithm: a name is `aria-label`, else the text of
 * `aria-labelledby`, else the element's own text — which is how every control
 * on the pay page is named.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

export function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  mounted.push({ root, container });
  return { container };
}

type Name = string | RegExp;

const ROLE_SELECTORS: Record<string, string> = {
  button: 'button:not([role]), [role="button"], input[type="button"], input[type="submit"]',
  radio: '[role="radio"], input[type="radio"]',
  checkbox: '[role="checkbox"], input[type="checkbox"]',
  spinbutton: '[role="spinbutton"], input[type="number"]',
  dialog: '[role="dialog"]',
  link: "a[href]",
  listitem: 'li, [role="listitem"]',
  status: '[role="status"]',
};

function accessibleName(element: Element): string {
  const label = element.getAttribute("aria-label");
  if (label) return label.trim();
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function hidden(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden")) return true;
  }
  return false;
}

function matches(text: string, name: Name): boolean {
  return typeof name === "string" ? text === name : name.test(text);
}

function queries(scope: ParentNode) {
  const allByRole = (role: string, options: { name?: Name } = {}): HTMLElement[] => {
    const selector = ROLE_SELECTORS[role];
    if (!selector) throw new Error(`dom-testing-lite: no selector for role "${role}"`);
    return Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter(
      (element) => !hidden(element) && (options.name === undefined || matches(accessibleName(element), options.name)),
    );
  };
  const allByText = (text: Name): HTMLElement[] =>
    Array.from(scope.querySelectorAll<HTMLElement>("*")).filter((element) => {
      if (hidden(element)) return false;
      // The innermost element whose own text matches, as getByText finds it.
      const own = Array.from(element.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      const whole = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (typeof text !== "string" && own && text.test(own)) return true;
      if (!matches(whole, text)) return false;
      return !Array.from(element.children).some((child) => matches((child.textContent ?? "").replace(/\s+/g, " ").trim(), text));
    });
  const one = <T,>(found: T[], what: string): T => {
    if (found.length !== 1) throw new Error(`dom-testing-lite: expected one ${what}, found ${found.length}`);
    return found[0];
  };
  const describeRole = (role: string, options?: { name?: Name }) => `${role}${options?.name ? ` named ${String(options.name)}` : ""}`;
  return {
    getByRole: (role: string, options?: { name?: Name }) => one(allByRole(role, options), describeRole(role, options)),
    getAllByRole: (role: string, options?: { name?: Name }) => {
      const found = allByRole(role, options);
      if (found.length === 0) throw new Error(`dom-testing-lite: no ${describeRole(role, options)}`);
      return found;
    },
    queryByRole: (role: string, options?: { name?: Name }) => allByRole(role, options)[0] ?? null,
    findByRole: (role: string, options?: { name?: Name }) => waitFor(() => one(allByRole(role, options), describeRole(role, options))),
    getByText: (text: Name) => one(allByText(text), `text ${String(text)}`),
    getAllByText: (text: Name) => {
      const found = allByText(text);
      if (found.length === 0) throw new Error(`dom-testing-lite: no text ${String(text)}`);
      return found;
    },
    findAllByText: (text: Name) =>
      waitFor(() => {
        const found = allByText(text);
        if (found.length === 0) throw new Error(`dom-testing-lite: no text ${String(text)}`);
        return found;
      }),
  };
}

export const screen = queries(document);
export const within = (element: HTMLElement) => queries(element);

/** Retry until the callback stops throwing, flushing React between tries. */
export async function waitFor<T>(callback: () => T, { timeout = 2000, interval = 20 } = {}): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  for (;;) {
    try {
      return callback();
    } catch (error) {
      lastError = error;
    }
    if (Date.now() - started > timeout) throw lastError;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, interval));
    });
  }
}

export const fireEvent = {
  click(element: Element) {
    act(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  },
};

/** React tracks an input's value; set it through the prototype so the change is seen. */
function setNativeValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

export const userEvent = {
  async click(element: Element) {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  },
  async type(element: HTMLElement, text: string) {
    const input = element as HTMLInputElement;
    for (const character of text) {
      await act(async () => {
        setNativeValue(input, `${input.value}${character}`);
      });
    }
  },
  async clear(element: HTMLElement) {
    await act(async () => {
      setNativeValue(element as HTMLInputElement, "");
    });
  },
};

export default userEvent;
