/** Background route warming must not compete with a constrained connection. */
export type ConnectionHints = {
  saveData?: boolean;
  effectiveType?: string;
};

export function mayPrefetchRoutes({
  online,
  visible,
  connection,
}: {
  online: boolean;
  visible: boolean;
  connection?: ConnectionHints;
}): boolean {
  return online && visible && !connection?.saveData &&
    connection?.effectiveType !== "slow-2g" && connection?.effectiveType !== "2g";
}
