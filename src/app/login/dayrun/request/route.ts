import { type NextRequest } from 'next/server';
import { requestDayrunPair, dayrunRefusal } from '@/platform/auth/dayrun-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest) {
 try {return await requestDayrunPair(request);} catch {return dayrunRefusal();}
}
