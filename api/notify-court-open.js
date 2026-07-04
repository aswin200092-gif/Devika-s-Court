// Triggered automatically by Vercel Cron every Friday at 3:00 PM IST (see
// vercel.json). Unlike the chat notification, nobody needs to have the app
// open for this to fire — Vercel's own server calls this on schedule.
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    ),
    databaseURL: "https://devikas-court-default-rtdb.firebaseio.com"
  });
}

export default async function handler(req, res) {
  // Vercel automatically sends this header on scheduled cron requests — this
  // check stops randoms from hitting the URL directly to spam notifications.
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = admin.database();

    // Guard against accidentally notifying twice on the same day, in case
    // Vercel ever retries or double-fires the schedule.
    const today = new Date().toISOString().slice(0, 10); // "2026-07-10"
    const lastNotifiedRef = db.ref("court/lastOpenNotifiedDate");
    const lastNotifiedSnap = await lastNotifiedRef.once("value");
    if (lastNotifiedSnap.val() === today) {
      return res.status(200).json({ skipped: "already notified today" });
    }

    const snapshot = await db.ref("notifications/tokens").once("value");
    const tokensObj = snapshot.val() || {};
    const tokens = Object.keys(tokensObj);

    if (tokens.length === 0) {
      return res.status(200).json({ sent: 0 });
    }

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: "⚖️ Court is now in session!",
        body: "Judge Devika is ready to deliver her verdict. Open the app now."
      }
    });

    // Clean up dead tokens (uninstalled app, revoked permission, etc.)
    const deadTokens = [];
    response.responses.forEach((r, i) => { if (!r.success) deadTokens.push(tokens[i]); });
    await Promise.all(deadTokens.map(t => db.ref(`notifications/tokens/${t}`).remove()));

    await lastNotifiedRef.set(today);

    return res.status(200).json({ sent: response.successCount });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
