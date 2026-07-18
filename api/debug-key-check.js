// Temporary diagnostic — checks the SHAPE of the private key both before and
// after cleanup, without ever printing the actual secret. Delete once fixed.
function getCleanPrivateKey(raw) {
  let key = raw.trim();
  if (key.endsWith(",")) key = key.slice(0, -1).trim();
  if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);
  return key.replace(/\\n/g, "\n");
}

export default async function handler(req, res) {
  const querySecret = req.query.secret;
  if (querySecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const raw = process.env.FIREBASE_PRIVATE_KEY || "";
  const cleaned = getCleanPrivateKey(raw);

  return res.status(200).json({
    projectIdSet: !!process.env.FIREBASE_PROJECT_ID,
    clientEmailSet: !!process.env.FIREBASE_CLIENT_EMAIL,
    rawLength: raw.length,
    cleanedLength: cleaned.length,
    rawFirstChar: JSON.stringify(raw.slice(0, 1)),
    rawLastChar: JSON.stringify(raw.slice(-1)),
    cleanedStartsWithBegin: cleaned.startsWith("-----BEGIN PRIVATE KEY-----"),
    cleanedEndsWithEnd: cleaned.endsWith("-----END PRIVATE KEY-----\n") || cleaned.endsWith("-----END PRIVATE KEY-----"),
    cleanedLineCount: cleaned.split("\n").length,
    first40OfCleaned: cleaned.slice(0, 40),
    last40OfCleaned: cleaned.slice(-40)
  });
}
