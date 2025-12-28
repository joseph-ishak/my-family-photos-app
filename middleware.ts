import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = new Set(["/", "/login", "/favicon.ico"]);

function isPublic(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname === "/") {
    const accessToken = req.cookies.get("accessToken")?.value;
    return NextResponse.redirect(
      new URL(accessToken ? "/home" : "/login", req.url)
    );
  }

  if (isPublic(pathname)) return NextResponse.next();

  const accessToken = req.cookies.get("accessToken")?.value;
  if (!accessToken) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname + (search || ""));
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
