import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getVerifiedUser } from "@/lib/auth-server";

export async function GET(req: NextRequest) {
  const user = await getVerifiedUser(req);
  return NextResponse.json({ user: user ?? null }, { status: 200 });
}
