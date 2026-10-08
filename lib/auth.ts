// Vaani calls our tools and webhook with a shared secret header.
export function checkToolSecret(req: Request): Response | null {
  const got = req.headers.get("x-aangan-secret");
  if (!process.env.AANGAN_TOOL_SECRET || got !== process.env.AANGAN_TOOL_SECRET) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  return null;
}
