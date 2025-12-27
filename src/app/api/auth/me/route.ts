import type { NextRequest } from "next/server";
import jwt from "jsonwebtoken";

export async function GET(req: NextRequest) {
  const token = req.cookies.get("idToken")?.value;
  if (!token)
    return new Response(JSON.stringify({ user: null }), { status: 200 });

  try {
    const decoded = jwt.decode(token);
    return new Response(JSON.stringify({ user: decoded }), { status: 200 });
  } catch {
    return new Response(JSON.stringify({ user: null }), { status: 200 });
  }
}
