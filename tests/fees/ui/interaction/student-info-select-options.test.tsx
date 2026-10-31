// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudentInfoGroupInputs } from "@/modules/students-fees/ui/student-info-inputs";
import { HOUSE_OPTIONS } from "@/modules/students-fees/domain/info-fields";
import messages from "@/messages/en.json";

/**
 * A stored value the option list does not contain must survive being looked at.
 *
 * A native <select> handed a defaultValue it has no <option> for selects the
 * FIRST option instead — here the blank "not recorded" — so opening a student
 * and pressing Save silently erased the field. This is not hypothetical: 14
 * students on the live roll carry a category of "GENERAL", which the list
 * spells "General". (6 more carried "SBC" until it joined the list.)
 *
 * Ported from the fees app (22e86f35). That repo drives it with
 * @testing-library/react, which One does not install; this renders the same
 * markup with react-dom/server into jsdom and reads the <select> back.
 */
function renderGroup(group: "identity" | "school", values: Record<string, string>) {
  document.body.innerHTML = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <StudentInfoGroupInputs group={group} values={values} />
    </NextIntlClientProvider>,
  );
}

/** The <select> whose <label> text matches, the way getByLabelText finds it. */
function selectLabelled(pattern: RegExp): HTMLSelectElement {
  for (const label of Array.from(document.querySelectorAll("label"))) {
    if (!pattern.test(label.textContent ?? "")) continue;
    const control = label.htmlFor
      ? document.getElementById(label.htmlFor)
      : label.querySelector("select");
    if (control instanceof HTMLSelectElement) return control;
  }
  throw new Error(`No select labelled ${pattern}`);
}

const optionsNamed = (select: HTMLSelectElement, name: string) =>
  Array.from(select.options).filter((option) => option.textContent?.trim() === name);

describe("student info selects", () => {
  it("keeps a category the option list does not know about", () => {
    renderGroup("identity", { category: "GENERAL" });

    const select = selectLabelled(/category/i);
    expect(optionsNamed(select, "GENERAL")).toHaveLength(1);
    // The point of the option existing at all: the field still holds its value.
    expect(select.value).toBe("GENERAL");
  });

  it("offers SBC as an ordinary category, once", () => {
    renderGroup("identity", { category: "SBC" });

    const select = selectLabelled(/category/i);
    expect(optionsNamed(select, "SBC")).toHaveLength(1);
    expect(select.value).toBe("SBC");
  });

  it("does not offer a duplicate option when the value IS in the list", () => {
    renderGroup("identity", { category: "OBC" });

    const select = selectLabelled(/category/i);
    expect(optionsNamed(select, "OBC")).toHaveLength(1);
    expect(select.value).toBe("OBC");
  });

  it("offers the school's four houses, untranslated", () => {
    renderGroup("school", { house: "Rana Kumbha" });

    const select = selectLabelled(/house/i);
    for (const house of HOUSE_OPTIONS) {
      expect(optionsNamed(select, house)).toHaveLength(1);
    }
    expect(select.value).toBe("Rana Kumbha");
  });

  it("keeps a house the list does not know about", () => {
    // The three TEST- students carry Blue / Gandhi / Tagore from older fixtures.
    renderGroup("school", { house: "Tagore" });

    const select = selectLabelled(/house/i);
    expect(select.value).toBe("Tagore");
  });
});
