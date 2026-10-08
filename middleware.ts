// One shared studio login for the dashboard (as agreed). Tool + webhook routes use the Vaani secret instead.
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const [user, pass] = auth.startsWith("Basic ") ? atob(auth.slice(6)).split(":") : [];
  if (user === process.env.DASHBOARD_USER && pass === process.env.DASHBOARD_PASSWORD) return NextResponse.next();
  return new NextResponse("Login required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Aangan dashboard"' } });
}

export const config = { matcher: ["/dashboard/:path*", "/api/leads/:path*"] };
