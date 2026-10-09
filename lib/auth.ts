// Vaani calls our tools and webhook with a shared secret: in the x-aangan-secret header, or as
// ?key=… on the URL for Vaani screens that can't add custom headers.
export function checkToolSecret(req: Request): Response | null {
  const expected = process.env.AANGAN_TOOL_SECRET;
  const got = req.headers.get("x-aangan-secret") ?? new URL(req.url).searchParams.get("key");
  if (!expected || got !== expected) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  return null;
}
