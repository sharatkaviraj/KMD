import { expect, it } from "vitest";
import { hasRenderedError } from "../scripts/smoke-response.mjs";

it("detects a streamed server error even when no error boundary was rendered", () => {
  const payload = '1:I["module"]\n3:E{"digest":"500313300"}\n';
  expect(hasRenderedError(`<script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`)).toBe(true);
});
it.each(["Something went wrong.", "कुछ गड़बड़ हो गई।", "The protected workspace hit an error", "Campaigns hit an error"])("detects visible %s", message => {
  expect(hasRenderedError(`<h2>${message}</h2>`)).toBe(true);
});
it("does not mistake an unused translated error message for a rendered failure", () => {
  const payload = '3:["$","div",null,{"catalog":{"error":"Something went wrong."}}]\n';
  expect(hasRenderedError(`<h1>Students</h1><script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`)).toBe(false);
});
