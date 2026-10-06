/** Next can stream an error after returning 200; read visible text and RSC frames. */
export function hasRenderedError(body) {
  const visible = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ");
  if (/कुछ गड़बड़ हो गई|Something went wrong|hit an error|Access not permitted/.test(visible)) return true;
  for (const match of body.matchAll(/self\.__next_f\.push\((\[1,"(?:\\.|[^"\\])*"\])\)/g)) {
    const [, payload] = JSON.parse(match[1]);
    if (/(?:^|\n)[\da-f]+:E\{/.test(payload)) return true;
  }
  return false;
}
