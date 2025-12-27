import { serialize } from "cookie";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const cookie = serialize("session", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Set-Cookie": cookie,
      },
    });
  } catch (err: any) {
    console.error("Logout error:", err);
    return new Response(JSON.stringify({ error: "Logout failed" }), {
      status: 500,
    });
  }
}
