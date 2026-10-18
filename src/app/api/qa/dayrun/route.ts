import { type NextRequest } from 'next/server';
import { administerDayrun, dayrunResponse } from '@/platform/auth/dayrun-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest) {
 try {return await administerDayrun(request);} catch {return dayrunResponse('/qa/dayrun?status=unavailable');}
}
