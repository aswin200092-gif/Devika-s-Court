// Temporary diagnostic — checks the SHAPE of the private key env var without
// ever printing the actual secret. Delete this file once the issue is fixed.
export default async function handler(req, res) {
  const querySecret = req.query.secret;
  if (querySecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const raw = process.env.FIREBASE_PRIVATE_KEY || "";
  const converted = raw.replace(/\\n/g, "\n");

  return res.status(200).json({
    projectIdSet: !!process.env.FIREBASE_PROJECT_ID,
    clientEmailSet: !!process.env.FIREBASE_CLIENT_EMAIL,
    privateKeyLength: raw.length,
    startsWithBeginMarker: converted.trim().startsWith("-----BEGIN PRIVATE KEY-----"),
    endsWithEndMarker: converted.trim().endsWith("-----END PRIVATE KEY-----"),
    containsLiteralBackslashN: raw.includes("\\n"),
    containsRealNewlines: raw.includes("\n"),
    lineCount: converted.split("\n").length
  });
}
