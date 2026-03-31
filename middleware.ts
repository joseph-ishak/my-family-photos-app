import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getVerifiedUser } from "@/lib/auth-server";

const PUBLIC_PATHS = new Set(["/", "/login", "/favicon.ico"]);

function isPublic(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname === "/") {
    const user = await getVerifiedUser(req);
    return NextResponse.redirect(
      new URL(user ? "/home" : "/login", req.url)
    );
  }

  if (isPublic(pathname)) return NextResponse.next();

  const user = await getVerifiedUser(req);
  if (!user) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname + (search || ""));
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
