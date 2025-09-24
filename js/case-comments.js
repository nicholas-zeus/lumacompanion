// case-comments.js
// Logic for the "Comments" tab

import { db } from "./firebase.js";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Keep unsubscribe handle for live listener
let unsubscribeComments = null;

// --- Render one comment row
function renderComment(c) {
  const el = document.createElement("div");
  el.className = "comment-item";
  el.innerHTML = `
    <div class="comment-meta">
      <span class="comment-user">${c.user || "Unknown"}</span>
      <span class="comment-time">${c.createdAt?.toDate?.().toLocaleString?.() || ""}</span>
    </div>
    <div class="comment-text">${c.text || ""}</div>
  `;
  return el;
}

// --- Load & listen for comments
export function initComments(caseId, currentUser) {
  // Remove old listener if any
  if (unsubscribeComments) {
    unsubscribeComments();
    unsubscribeComments = null;
  }

  const commentsBox = document.getElementById("comments-list");
  commentsBox.innerHTML = `<div class="loading">Loading comments…</div>`;

  const q = query(
    collection(db, "comments"),
    where("caseId", "==", caseId),
    orderBy("createdAt", "asc")
  );

  unsubscribeComments = onSnapshot(q, (snap) => {
    commentsBox.innerHTML = "";
    if (snap.empty) {
      commentsBox.innerHTML = `<div class="empty">No comments yet.</div>`;
      return;
    }
    snap.forEach((doc) => {
      const data = doc.data();
      commentsBox.appendChild(renderComment(data));
    });
  });

  // Hook submit button
  const form = document.getElementById("comment-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = document.getElementById("comment-input").value.trim();
    if (!text) return;

    try {
      await addDoc(collection(db, "comments"), {
        caseId,
        user: currentUser?.name || "Anonymous",
        userId: currentUser?.id || "",
        text,
        createdAt: serverTimestamp(),
      });
      document.getElementById("comment-input").value = "";
    } catch (err) {
      console.error("Failed to add comment:", err);
    }
  });
}

// --- Hook when Comments tab is shown
document.addEventListener("DOMContentLoaded", () => {
  const caseId = window.caseId;
  const currentUser = window.currentUser;
  if (!caseId) return;

  const tab = document.getElementById("tab-comments");
  tab?.addEventListener("click", () => {
    initComments(caseId, currentUser);
  });

  // If comments tab is default active
  if (tab?.classList.contains("active")) {
    initComments(caseId, currentUser);
  }
});
