import { firebaseConfig } from "/js/config.js";

// Firebase v10 ESM CDN imports
import {
  initializeApp, getApps
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth, onAuthStateChanged, signInWithPopup, signOut, OAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let app, auth, db;

/** Initialize once */
export function initFirebase() {
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
  auth = getAuth(app);
  db = getFirestore(app);
}

/** Subscribe to auth changes */
export function onAuth(cb) {
  if (!auth) throw new Error("initFirebase() not called");
  onAuthStateChanged(auth, (user) => cb(user));
}

/** Microsoft sign-in via Firebase Auth */
export async function signInWithMicrosoft() {
  const provider = new OAuthProvider("microsoft.com");
  // Optional: force account picker each time
  provider.setCustomParameters({ prompt: "select_account" });
  await signInWithPopup(auth, provider);
}

/** Sign out */
export async function signOutNow() {
  await signOut(auth);
}

export { app, auth, db };
