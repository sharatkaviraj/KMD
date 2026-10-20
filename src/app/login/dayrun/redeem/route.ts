import { type NextRequest } from 'next/server';
import { redeemDayrunPair, dayrunRefusal } from '@/platform/auth/dayrun-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest) {
 try {return await redeemDayrunPair(request);} catch {return dayrunRefusal();}
}
