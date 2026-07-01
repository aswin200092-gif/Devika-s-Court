// Firebase setup — shared Realtime Database so every device sees the same
// live data (A, B, C, D all read/write the same court).
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyB_toRMxZil0mG1a83lycDvdcKywCEIep4",
  authDomain: "devikas-court.firebaseapp.com",
  databaseURL: "https://devikas-court-default-rtdb.firebaseio.com",
  projectId: "devikas-court",
  storageBucket: "devikas-court.firebasestorage.app",
  messagingSenderId: "742814037841",
  appId: "1:742814037841:web:0ad92ccea7b2d0fcd68570",
  measurementId: "G-BTC2R41DGJ"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
