// Triggered automatically by Vercel Cron every Friday at 5:00 PM IST (see
// vercel.json). This does exactly what tapping "Close the Court & Reset"
// does in the app — but nobody needs to be there to tap it.
//
// Built using plain REST calls to Firebase (not the Admin SDK's realtime
// connection) because that persistent-connection style doesn't play well
// with short-lived serverless functions — it can hang waiting to establish
// a live socket that never gets the chance to finish before the function
// is torn down.
import admin from "firebase-admin";

// Cleans up the private key regardless of how it was pasted — handles
// literal "\n" text, accidental wrapping quotes, and a stray trailing comma,
// all common mistakes when copying a value straight out of a JSON file.
function getCleanPrivateKey() {
  let key = (process.env.FIREBASE_PRIVATE_KEY || "").trim();
  if (key.endsWith(",")) key = key.slice(0, -1).trim();
  if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);
  return key.replace(/\\n/g, "\n");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: getCleanPrivateKey()
    })
  });
}

const DB_URL = "https://devikas-court-default-rtdb.firebaseio.com";

async function getAccessToken() {
  const token = await admin.app().options.credential.getAccessToken();
  return token.access_token;
}

async function restGet(path, accessToken) {
  const res = await fetch(`${DB_URL}/${path}.json?access_token=${accessToken}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function restPatch(path, body, accessToken) {
  const res = await fetch(`${DB_URL}/${path}.json?access_token=${accessToken}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
  return res.json();
}

async function restPost(path, body, accessToken) {
  const res = await fetch(`${DB_URL}/${path}.json?access_token=${accessToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

async function restPut(path, body, accessToken) {
  const res = await fetch(`${DB_URL}/${path}.json?access_token=${accessToken}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  // Vercel's own scheduler sends this header automatically. For manually
  // triggering a catch-up close (e.g. a missed Friday), the same secret can
  // instead be passed as ?secret=... directly in the browser.
  const authHeader = req.headers["authorization"];
  const querySecret = req.query.secret;
  const isAuthorized =
    authHeader === `Bearer ${process.env.CRON_SECRET}` ||
    querySecret === process.env.CRON_SECRET;
  if (!isAuthorized) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const accessToken = await getAccessToken();

    // Guard against double-firing on the same day.
    const today = new Date().toISOString().slice(0, 10);
    const lastClosed = await restGet("court/lastAutoClosedDate", accessToken);
    if (lastClosed === today) {
      return res.status(200).json({ skipped: "already closed today" });
    }

    const peopleObj = await restGet("court/people", accessToken);
    if (!peopleObj) {
      return res.status(200).json({ skipped: "no members" });
    }
    const people = Object.values(peopleObj);

    // Save a backup snapshot BEFORE wiping anything, same as the manual button does.
    await restPost("backups", { people, ts: Date.now(), by: "Auto-close (5PM)" }, accessToken);

    // Move each unpaid fine into their persistent "owed" balance, then zero the jar.
    const totalCleared = people.reduce((s, p) => s + (p.amt || 0), 0);
    const updates = {};
    people.forEach(p => {
      updates[`court/people/${p.id}/amt`] = 0;
      if (p.amt > 0) updates[`court/people/${p.id}/owed`] = (p.owed || 0) + p.amt;
    });
    await restPatch("", updates, accessToken);

    // Log it, same as every other action in the app.
    await restPost("court/auditLog", {
      action: "reset",
      by: "Auto-close (5PM)",
      ts: Date.now(),
      totalCleared
    }, accessToken);

    await restPut("court/lastAutoClosedDate", today, accessToken);

    return res.status(200).json({ closed: true, totalCleared, memberCount: people.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
