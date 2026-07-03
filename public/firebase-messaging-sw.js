// This file MUST live at the site root (public/ → deployed to /firebase-messaging-sw.js)
// so the browser is allowed to let it run in the background, even after the
// app itself is closed. It uses the older "importScripts" style because
// service workers can't use normal npm imports.
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyB_toRMxZil0mG1a83lycDvdcKywCEIep4",
  authDomain: "devikas-court.firebaseapp.com",
  databaseURL: "https://devikas-court-default-rtdb.firebaseio.com",
  projectId: "devikas-court",
  storageBucket: "devikas-court.firebasestorage.app",
  messagingSenderId: "742814037841",
  appId: "1:742814037841:web:0ad92ccea7b2d0fcd68570"
});

const messaging = firebase.messaging();

// Fires when a push arrives and the app is NOT open/focused.
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Devika's Court";
  const options = {
    body: payload.notification?.body || "New message",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: "devikas-court-chat" // replaces older notifications instead of stacking
  };
  self.registration.showNotification(title, options);
});

// Tapping the notification focuses/opens the app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
    })
  );
});
