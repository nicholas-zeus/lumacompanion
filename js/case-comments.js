// case-comments.js
import { state } from "/js/case-shared.js";
import { listComments, addComment, upsertCommentMQ, getCase, finishCase, statusLabel } from "/js/api.js";

const commentsList   = document.getElementById("commentsList");
const commentForm    = document.getElementById("commentForm");
const commentBody    = document.getElementById("commentBody");
const commentMQ      = document.getElementById("commentMQ");
const saveCommentBtn = document.getElementById("saveCommentBtn");
const confirmBtn     = document.getElementById("confirmBtn");
const statusText     = document.getElementById("statusText");

async function renderComments() {
  commentsList.innerHTML = "";
  const items = await listComments(state.caseId);
  for (const c of items) {
    const el = document.createElement("div");
    el.className = "comment";
    el.innerHTML = `
      <div><span class="who">${c.createdBy?.displayName || c.createdBy?.email || "—"}</span>
      <span class="when"> • ${new Date((c.createdAt?.seconds||0)*1000).toLocaleString()}</span></div>
      <div class="body">${(c.body || "").replace(/\n/g, "<br>")}</div>
      ${c.mq ? `<div class="mq"><div class="muted">Medical Questionnaire</div>${c.mq.replace(/\n/g,"<br>")}</div>` : ""}
    `;
    commentsList.appendChild(el);
  }
}
async function postComment(confirmHandoff) {
  const body = commentBody.value.trim();
  const mq = commentMQ.value.trim();
  if (!body && !mq) return;
  const id = await addComment(state.caseId, body, state.user);
  if (mq) await upsertCommentMQ(state.caseId, id, mq, state.user);
  commentBody.value = "";
  await renderComments();
  if (confirmHandoff) {
    await finishCase(state.caseId, state.user);
    const updated = await getCase(state.caseId);
    state.caseDoc = updated;
    statusText.textContent = statusLabel(updated.status);
  }
}

saveCommentBtn.addEventListener("click", (e) => { e.preventDefault(); postComment(false); });
confirmBtn.addEventListener("click", (e) => { e.preventDefault(); postComment(true); });

export { renderComments };
