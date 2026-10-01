import { lazy, Suspense, type ComponentType } from "react";

// Standalone browser fixtures retain the real desk/sheets and replace only
// Next's chunk loader, which needs a Next runtime.
export default function dynamic<P extends object>(load: () => Promise<ComponentType<P>>) {
  const Component = lazy(async () => ({ default: await load() }));
  return function FixtureDynamic(props: P) { return <Suspense fallback={null}><Component {...props} /></Suspense>; };
}
