import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { ref, set, remove } from "firebase/database";
import { app, db } from "./firebase";

// ⚠️ Paste the "Web Push certificate" key pair value from:
// Firebase console → ⚙️ Project settings → Cloud Messaging tab → Web configuration
const VAPID_KEY = "PASTE_YOUR_VAPID_KEY_HERE";

let messaging = null;
try {
  messaging = getMessaging(app);
} catch (e) {
  // Messaging isn't supported in this browser (e.g. very old Safari) — fail quietly.
  console.warn("Push messaging not supported here:", e);
}

// Call this once the person picks their name — asks for permission, registers
// this specific device/browser with Firebase, and saves its token so the
// server knows where to deliver pushes.
export async function enableNotifications(personName) {
  if (!messaging) return null;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });
    if (!token) return null;

    // Save this device's token, keyed by the token itself (naturally de-duplicates
    // if the same device registers twice).
    await set(ref(db, `notifications/tokens/${token}`), {
      name: personName,
      ts: Date.now()
    });
    localStorage.setItem("devikas_fcm_token", token);
    return token;
  } catch (e) {
    console.error("Failed to enable notifications:", e);
    return null;
  }
}

export async function disableNotifications() {
  const token = localStorage.getItem("devikas_fcm_token");
  if (token) {
    await remove(ref(db, `notifications/tokens/${token}`)).catch(() => {});
    localStorage.removeItem("devikas_fcm_token");
  }
}

// Fires when a push arrives WHILE the app is open/focused — browsers don't
// show OS notifications automatically in that case, so we hand it to a
// callback (e.g. to show an in-app toast instead).
export function onForegroundMessage(callback) {
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => callback(payload));
}
