import { type NextRequest } from 'next/server';
import { endDayrunSession, dayrunRefusal } from '@/platform/auth/dayrun-server';
export async function POST(request:NextRequest) {
 try { return await endDayrunSession(request); } catch { return dayrunRefusal(); }
}
