// case-comments.js
import { state } from "/js/case-shared.js";
import {
  listComments,
  addComment,
  upsertCommentMQ,
  getCase,
  updateCase,
  statusLabel
} from "/js/api.js";
import { toDate } from "/js/utils.js";

const commentsList   = document.getElementById("commentsList");
const commentForm    = document.getElementById("commentForm");
const commentBody    = document.getElementById("commentBody");
const commentMQ      = document.getElementById("commentMQ");
const saveCommentBtn = document.getElementById("saveCommentBtn");
const confirmBtn     = document.getElementById("confirmBtn");
const statusText     = document.getElementById("statusText");
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

async function renderComments() {
  commentsList.innerHTML = "";

  // pull and sort newest → oldest
  const itemsAsc = await listComments(state.caseId);
  const items = itemsAsc.slice().reverse(); // UI wants newest first

  // lazy-build a simple MQ modal once
  ensureMqModal();

  for (const c of items) {
    const who = c.author?.displayName || c.author?.email || "—";
    const when = toDate(c.createdAt);
    const whenText = when ? when.toLocaleString() : "";

    // try to fetch MQ for this comment; show a button if present
    let mqText = "";
    try {
      const mq = await (await import("/js/api.js")).getCommentMQ(c.id);
      mqText = mq?.text || "";
    } catch { /* ignore */ }

    const el = document.createElement("div");
    el.className = "comment";
    el.innerHTML = `
      <div><span class="who">${who}</span>
      <span class="when"> • ${whenText}</span></div>
      <div class="body">${(c.body || "").replace(/\n/g, "<br>")}</div>
      ${mqText
        ? `<div class="mq"><button class="btn" data-mq="${c.id}">View MQ</button></div>`
        : ""
      }
    `;

    // wire MQ button (opens modal)
    const btn = el.querySelector("[data-mq]");
    if (btn) {
      btn.addEventListener("click", async () => {
        showMqModal(mqText);
      });
    }

    commentsList.appendChild(el);
  }
}

async function postComment(confirmHandoff) {
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

  // 3) Auto-assign to commenter (respecting role)
  //    nurse → assignedNurse; doctor → assignedDoctor
  //    confirm → also handoff status to the other role
  const role = (state.role || "").toLowerCase();
  const assignPatch = {};
  if (role === "nurse") {
    assignPatch.assignedNurse = {
      email: state.user.email,
      displayName: state.user.displayName || state.user.email
    };
    if (confirmHandoff) assignPatch.status = "awaiting doctor";
  } else if (role === "doctor") {
    assignPatch.assignedDoctor = {
      email: state.user.email,
      displayName: state.user.displayName || state.user.email
    };
    if (confirmHandoff) assignPatch.status = "awaiting nurse";
  }
  if (Object.keys(assignPatch).length) {
    await updateCase(state.caseId, assignPatch, state.user);
  }

  // 4) Clear inputs, refresh UI/status
  commentBody.value = "";
  // keep MQ textarea? Clear it after save per your spec:
  commentMQ.value = "";

  await renderComments();

  // refresh case doc + status label
  const updated = await getCase(state.caseId);
  state.caseDoc = updated;
  statusText.textContent = statusLabel(updated?.status || "—");
}

saveCommentBtn.addEventListener("click", (e) => { e.preventDefault(); postComment(false); });
confirmBtn.addEventListener("click", (e) => { e.preventDefault(); postComment(true); });

export { renderComments };
