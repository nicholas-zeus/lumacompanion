// ----- Fill these with your Firebase project values -----
export const firebaseConfig = {
  apiKey:        "AIzaSyDk9XnkfRtrP8AlYMMKs8pqXeZatc8wmCE",
  authDomain:    "lumacompanion1.firebaseapp.com",
  projectId:     "lumacompanion1",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:         "YOUR_APP_ID",
};

// Netlify Functions base (leave default unless you mounted them elsewhere)
export const functionsBase = "/.netlify/functions";

// Firestore collections / docs
export const COLLECTIONS = {
  cases: "cases",
  uploads: "uploads",
  comments: "comments",
  commentMQ: "commentMQ",
  pageTags: "pageTags",
  notifications: "notifications",
  settings: "settings",
  allowlist: "allowlist", // private, read via function only
  userStars: "userStars", // ⭐ new collection for per-user starred list
};

// UI constants
export const PAGE_SIZE = 60; // max cards to pull for dashboard views
