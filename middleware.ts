// One shared studio login for the dashboard (as agreed). Tool + webhook routes use the Vaani secret instead.
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const [user, pass] = auth.startsWith("Basic ") ? atob(auth.slice(6)).split(":") : [];
  const { DASHBOARD_USER, DASHBOARD_PASSWORD } = process.env;
  // Fail closed: if the login isn't configured, nobody gets in.
  if (DASHBOARD_USER && DASHBOARD_PASSWORD && user === DASHBOARD_USER && pass === DASHBOARD_PASSWORD) return NextResponse.next();
  return new NextResponse("Login required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Aangan dashboard"' } });
}

export const config = { matcher: ["/dashboard/:path*", "/api/leads/:path*"] };
