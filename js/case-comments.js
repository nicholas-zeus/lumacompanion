// /js/case-comments.js
import { state } from "/js/case-shared.js";
import {
  listComments,
  addComment,
  upsertCommentMQ,
  getCommentMQ,
  getCase,
  updateCase,
  statusLabel
} from "/js/api.js";
import { toDate } from "/js/utils.js";

// --- DOM ---
const commentsList   = document.getElementById("commentsList");
const commentForm    = document.getElementById("commentForm");
const commentBody    = document.getElementById("commentBody");
const commentMQ      = document.getElementById("commentMQ");
const saveCommentBtn = document.getElementById("saveCommentBtn");
const confirmBtn     = document.getElementById("confirmBtn");
const statusText     = document.getElementById("statusText");

// Ensure the composer is physically before the list in the DOM
function ensureComposerOnTop() {
  if (!commentForm || !commentsList) return;
  const parent = commentsList.parentElement || commentForm.parentElement;
  if (!parent) return;
  if (commentForm.nextElementSibling !== commentsList) {
    // Move form to be the element immediately before the list
    parent.insertBefore(commentForm, commentsList);
  }
}


// --- MQ modal (lazy) ---
let mqModal, mqModalBody;
function ensureMqModal() {
  if (mqModal) return;
  mqModal = document.createElement("div");
  mqModal.className = "mq-modal";    // themed by CSS

  const card = document.createElement("div");
  card.className = "mq-card";        // themed by CSS

  const head = document.createElement("div");
  head.className = "mq-head";
  head.innerHTML = `<strong>Medical Questionnaire</strong>
    <button class="btn" id="mqClose" type="button">Close</button>`;

  mqModalBody = document.createElement("div");
  mqModalBody.style.whiteSpace = "pre-wrap";

  card.appendChild(head);
  card.appendChild(mqModalBody);
  mqModal.appendChild(card);
  document.body.appendChild(mqModal);

  // Close on backdrop click or button
  mqModal.addEventListener("click", (e) => { if (e.target === mqModal) hideMqModal(); });
  card.querySelector("#mqClose").addEventListener("click", hideMqModal);
}

function showMqModal(text) {
  ensureMqModal();
  mqModalBody.textContent = text || "";
  mqModal.classList.add("open");
}

function hideMqModal() {
  if (mqModal) mqModal.classList.remove("open");
}



// --- Render newest → oldest; keep compose box on top ---
// Guard against overlapping renders (latest run wins)
let renderRun = 0;
export async function renderComments() {
  if (!commentsList || !state.caseId) return;
  ensureComposerOnTop();

  const run = ++renderRun;

  // Load & sort
  const itemsAsc = await listComments(state.caseId);
  if (run !== renderRun) return; // a newer render started

  const items = itemsAsc.slice().reverse(); // newest first
  ensureMqModal();

  // Build in fragment, then swap in one go (avoids flicker & race duplicates)
  const frag = document.createDocumentFragment();

  for (const c of items) {
    const who = c.author?.displayName || c.author?.email || "—";
    const when = toDate(c.createdAt);
    const whenText = when ? when.toLocaleString() : "";

    // fetch MQ if present
    let mqText = "";
    try {
      const mq = await getCommentMQ(c.id);
      mqText = mq?.text || "";
    } catch { /* ignore */ }

    const el = document.createElement("div");
    el.className = "comment";
    el.innerHTML = `
      <div><span class="who">${who}</span>
      <span class="when"> • ${whenText}</span></div>
      <div class="body">${(c.body || "").replace(/\n/g, "<br>")}</div>
      ${mqText ? `<div class="mq"><button class="btn" data-mq="${c.id}">View MQ</button></div>` : ""}
    `;

    const btn = el.querySelector("[data-mq]");
    if (btn) {
      btn.addEventListener("click", () => showMqModal(mqText));
    }

    frag.appendChild(el);
  }

  if (run !== renderRun) return; // new render started while we built the list
  commentsList.innerHTML = "";
  commentsList.appendChild(frag);

  // keep compose focused and visible at the top
  ensureComposerOnTop();
  commentForm?.scrollIntoView({ behavior: "auto", block: "start" });
  commentBody?.focus();
}

// --- Save / Confirm flow (assign + optional handoff) ---
async function postComment(confirmHandoff) {
  ensureComposerOnTop();

  const body = (commentBody.value || "").trim();
  const mq = (commentMQ.value || "").trim();
  if (!body && !mq) return;

  // 1) Save the comment
  const created = await addComment(state.caseId, body, state.user);

  // 2) Save MQ (if provided)
  if (mq) {
    await upsertCommentMQ({
      caseId: state.caseId,
      commentId: created.id,
      text: mq,
      currentUser: state.user
    });
  }

  // 3) Auto-assign by role; confirm → handoff
  const role = (state.role || "").toLowerCase();
  const patch = {};
  if (role === "nurse") {
    patch.assignedNurse = {
      email: state.user.email,
      displayName: state.user.displayName || state.user.email
    };
    if (confirmHandoff) patch.status = "awaiting doctor";
  } else if (role === "doctor") {
    patch.assignedDoctor = {
      email: state.user.email,
      displayName: state.user.displayName || state.user.email
    };
    if (confirmHandoff) patch.status = "awaiting nurse";
  }
  if (Object.keys(patch).length) {
    await updateCase(state.caseId, patch, state.user);
  }

  // 4) Clear inputs; refresh list; update status label
  commentBody.value = "";
  commentMQ.value = "";

  await renderComments();

  const updated = await getCase(state.caseId);
  if (updated) {
    state.caseDoc = updated;
    statusText.textContent = statusLabel(updated.status || "—");
  }

  // keep form visible/focused at the top
  ensureComposerOnTop();
  commentForm?.scrollIntoView({ behavior: "auto", block: "start" });
  commentBody?.focus();
}

// --- Wire buttons ---
saveCommentBtn?.addEventListener("click", (e) => { e.preventDefault(); postComment(false); });
confirmBtn?.addEventListener("click", (e) => { e.preventDefault(); postComment(true); });

// NOTE: Do NOT auto-wire tab/caseLoaded listeners here.
// Keep a single source of truth: let case-shared.js call renderComments()
// when the Comments tab is opened or when caseLoaded fires and the tab is active.

// Also ensure on initial script load we place the form first (helpful if commentsList is before form in HTML)
ensureComposerOnTop();
