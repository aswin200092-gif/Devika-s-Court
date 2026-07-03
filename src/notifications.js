import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { ref, set, remove } from "firebase/database";
import { app, db } from "./firebase";

// ⚠️ Paste the "Web Push certificate" key pair value from:
// Firebase console → ⚙️ Project settings → Cloud Messaging tab → Web configuration
const VAPID_KEY = "BK3p2CF_wjKsU5_XrgqMuBQnf94rJzoCX5WaDeT3-72oOSxqezwlTfOqje-cJgYWJJCi13n9c53tEOjRPyVuvvw";

let messaging = null;
let initError = null;
try {
  messaging = getMessaging(app);
} catch (e) {
  initError = e;
  console.warn("Push messaging not supported here:", e);
}

// Call this once the person picks their name — asks for permission, registers
// this specific device/browser with Firebase, and saves its token so the
// server knows where to deliver pushes.
// Returns { token } on success, or { error } with a human-readable reason on failure —
// so the UI can actually show what went wrong instead of failing silently.
export async function enableNotifications(personName) {
  if (!messaging) {
    return { error: `Messaging not supported on this browser: ${initError?.message || "unknown reason"}` };
  }
  try {
    if (!("Notification" in window)) {
      return { error: "This browser doesn't support notifications at all." };
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { error: `Permission was "${permission}" — you likely tapped Block, or it's blocked in browser settings.` };
    }

    let registration;
    try {
      registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      await navigator.serviceWorker.ready;
    } catch (e) {
      return { error: `Service worker failed to register: ${e.message}` };
    }

    let token;
    try {
      token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration
      });
    } catch (e) {
      return { error: `getToken failed: ${e.code || e.message}` };
    }
    if (!token) {
      return { error: "getToken returned empty — permission or VAPID key issue." };
    }

    try {
      await set(ref(db, `notifications/tokens/${token}`), {
        name: personName,
        ts: Date.now()
      });
    } catch (e) {
      return { error: `Saved token locally but failed to write to database: ${e.message}` };
    }

    localStorage.setItem("devikas_fcm_token", token);
    return { token };
  } catch (e) {
    console.error("Failed to enable notifications:", e);
    return { error: e.message || String(e) };
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
