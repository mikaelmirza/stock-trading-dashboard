import { NextResponse, type NextRequest } from "next/server";
import { decrypt } from "@/app/lib/session";

const PROTECTED_PREFIXES = ["/dashboard"];

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get("session")?.value;
  const session = await decrypt(cookie);

  if (!session) {
    // This app has no signup wall (SPEC §6) — guest provisioning happens via
    // POST /api/session, which needs a DB write Proxy can't perform (no DB
    // round-trip here, per the docs' prefetch warning). Sending an
    // unauthenticated /dashboard visit back to `/` lets page.tsx (PLAN step
    // 25a) trigger provisioning and land back on /dashboard with a real
    // session, instead of Proxy trying to fake one.
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\.png$).*)"],
};
