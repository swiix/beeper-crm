import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAppView } from "@/lib/app-routes";

/** Legacy ?view=… → /{view}; / → /chat (preserve other query params). */
export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const legacyView = searchParams.get("view");

  if (legacyView) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("view");
    url.pathname = legacyView === "chat" || !isAppView(legacyView) ? "/chat" : `/${legacyView}`;
    return NextResponse.redirect(url);
  }

  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/chat";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
