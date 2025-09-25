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

// --- MQ modal (lazy) ---
let mqModal, mqModalBody;
function ensureMqModal() {
  if (mqModal) return;
  mqModal = document.createElement("div");
  mqModal.style.position = "fixed";
  mqModal.style.inset = "0";
  mqModal.style.background = "rgba(0,0,0,0.35)";
  mqModal.style.display = "none";
  mqModal.style.alignItems = "center";
  mqModal.style.justifyContent = "center";
  mqModal.style.zIndex = "1000";

  const card = document.createElement("div");
  card.style.background = "#fff";
  card.style.border = "1px solid var(--line)";
  card.style.borderRadius = "12px";
  card.style.maxWidth = "720px";
  card.style.width = "min(92vw, 720px)";
  card.style.maxHeight = "80vh";
  card.style.overflow = "auto";
  card.style.padding = "16px";
  card.style.boxShadow = "var(--shadow)";

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.justifyContent = "space-between";
  head.style.alignItems = "center";
  head.style.marginBottom = "8px";
  head.innerHTML = `<strong>Medical Questionnaire</strong>
    <button class="btn" id="mqClose">Close</button>`;

  mqModalBody = document.createElement("div");
  mqModalBody.style.whiteSpace = "pre-wrap";

  card.appendChild(head);
  card.appendChild(mqModalBody);
  mqModal.appendChild(card);
  document.body.appendChild(mqModal);

  mqModal.addEventListener("click", (e) => { if (e.target === mqModal) hideMqModal(); });
  card.querySelector("#mqClose").addEventListener("click", hideMqModal);
}
function showMqModal(text) { ensureMqModal(); mqModalBody.textContent = text || ""; mqModal.style.display = "flex"; }
function hideMqModal() { if (mqModal) mqModal.style.display = "none"; }

// --- Render newest → oldest; keep compose box on top ---
export async function renderComments() {
  if (!commentsList || !state.caseId) return;

  // IMPORTANT: only clear the list container so the compose form stays on top
  commentsList.innerHTML = "";

  // Firestore query is case-scoped already; we reverse for newest-first
  const itemsAsc = await listComments(state.caseId);
  const items = itemsAsc.slice().reverse();

  ensureMqModal();

  for (const c of items) {
    const who = c.author?.displayName || c.author?.email || "—";
    const when = toDate(c.createdAt);
    const whenText = when ? when.toLocaleString() : "";

    // Try to fetch MQ; if exists, show a button to open modal
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

    commentsList.appendChild(el);
  }

  // keep compose anchored/focused after any refresh
  commentBody?.focus();
}

// --- Save / Confirm flow (assign + optional handoff) ---
async function postComment(confirmHandoff) {
  const body = (commentBody.value || "").trim();
  const mq = (commentMQ.value || "").trim();
  if (!body && !mq) return;

  // 1) Save the comment (author is stored by addComment)
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

  // 3) Auto-assign to commenter (respecting role) and optionally handoff
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
  commentForm?.scrollIntoView({ behavior: "smooth", block: "start" });
  commentBody?.focus();
}

// --- Wire buttons ---
saveCommentBtn?.addEventListener("click", (e) => { e.preventDefault(); postComment(false); });
confirmBtn?.addEventListener("click", (e) => { e.preventDefault(); postComment(true); });

// --- Auto-load when the Comments tab is opened (no edits needed elsewhere) ---
const tabsNav = document.querySelector(".tabs");
tabsNav?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  if (btn.dataset.tab === "comments") {
    try {
      await renderComments();
      commentBody?.focus();
    } catch (err) {
      console.error("comments init failed:", err);
    }
  }
});

// --- Also load if the page opens with the Comments tab already active ---
document.addEventListener("caseLoaded", async () => {
  const active = document.querySelector(".tabpanel.is-active");
  if (active?.id === "tab-comments") {
    try {
      await renderComments();
      commentBody?.focus();
    } catch (err) {
      console.error("initial comments load failed:", err);
    }
  }
});
