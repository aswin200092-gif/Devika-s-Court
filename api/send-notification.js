if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    ),
    databaseURL: "https://devikas-court-default-rtdb.firebaseio.com"
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { title, body, senderToken } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: "Missing title or body" });
    }

    const db = admin.database();
    const snapshot = await db.ref("notifications/tokens").once("value");
    const tokensObj = snapshot.val() || {};

    // Don't notify the person who just sent the message — they already see it.
    const tokens = Object.keys(tokensObj).filter(t => t !== senderToken);
    if (tokens.length === 0) {
      return res.status(200).json({ sent: 0 });
    }

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body }
    });

    // Clean up any tokens that are no longer valid (app uninstalled, etc.)
    const deadTokens = [];
    response.responses.forEach((r, i) => {
      if (!r.success) deadTokens.push(tokens[i]);
    });
    await Promise.all(
      deadTokens.map(t => db.ref(`notifications/tokens/${t}`).remove())
    );

    return res.status(200).json({ sent: response.successCount });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
                      }

