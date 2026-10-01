/** Shared shell only. Fee screens provide their full catalogue locally. */
export const shellMessageNamespaces = ['Navigation', 'MobileApp', 'Roles', 'Locale', 'Segments', 'ShellStatus'] as const;

export function shellMessages(catalog: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(shellMessageNamespaces.map((key) => [key, catalog[key]]).filter(([, value]) => value !== undefined));
}
