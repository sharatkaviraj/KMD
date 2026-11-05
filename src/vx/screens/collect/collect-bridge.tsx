"use client";

import { useCallback } from "react";

import { bridgeAdapter } from "@/modules/collect/data/bridge-adapter";
import type { MoneyPortInfo } from "@/modules/collect/data/money-port";
import type { LikelyRow } from "@/modules/collect/domain/types";

import { Collect } from "./collect";

/** Collect on the Fees bridge: real staff. Imports only the bridge's actions. */
export function CollectBridge(props: { info: MoneyPortInfo; initialStudentId: string | null }) {
  const { info } = props;
  const makePort = useCallback((recall: () => readonly LikelyRow[]) => bridgeAdapter(info, recall), [info]);
  return <Collect info={info} makePort={makePort} initialStudentId={props.initialStudentId} testSession={false} />;
}
