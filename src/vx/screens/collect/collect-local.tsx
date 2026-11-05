"use client";

import { useCallback } from "react";

import { localAdapter } from "@/modules/collect/data/local-adapter";
import type { MoneyPortInfo } from "@/modules/collect/data/money-port";
import type { DeskListStudent } from "@/modules/payments/vx/types";

import { Collect } from "./collect";

/** Collect on the local (TEST) ledger: test accounts and confined deployments. */
export function CollectLocal(props: { info: MoneyPortInfo; roll: DeskListStudent[]; initialStudentId: string | null; testSession: boolean }) {
  const { info, roll } = props;
  const makePort = useCallback(() => localAdapter(info, roll), [info, roll]);
  return <Collect info={info} makePort={makePort} initialStudentId={props.initialStudentId} testSession={props.testSession} />;
}
