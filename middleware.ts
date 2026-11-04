import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * The host this platform answers as.
 *
 * Both `polimeter.cayworks.net` and `polling.cayworks.net` reach this Worker;
 * the second is the address it was built under and is kept so that nothing
 * already pointing at it breaks. Everything arriving there is now sent here,
 * so there is one address in search results, one in a shared link, and one in
 * a respondent's call display.
 */
const CANONICAL_HOST = "polimeter.cayworks.net";

/** Named rather than pattern-matched: `workers.dev` and previews keep serving. */
const RETIRED_HOSTS = new Set(["polling.cayworks.net"]);

export function middleware(req: NextRequest): NextResponse {
  // 308, not 301. A 301 is treated by most clients as licence to turn a POST
  // into a GET and drop its body, which would quietly break any webhook still
  // addressed to the old host — the Retell and Telegram registrations were
  // moved before this shipped, but a redirect is exactly the wrong place to
  // assume nothing was missed.
  const host = req.headers.get("host")?.toLowerCase();
  if (host && RETIRED_HOSTS.has(host)) {
    const url = new URL(req.url);
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  const res = NextResponse.next();
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
