import { initFirebase, onAuth, signOutNow, auth } from "/js/firebase.js";
import {
  loadRole, getCase, createCase, updateCase,
  finishCase, undoFinish,
  listComments, addComment, editComment, deleteComment,
  getCommentMQ, upsertCommentMQ,
  listUploads, streamFileUrl,
  getTagOptions
} from "/js/api.js";
import { formatDeadline, statusLabel } from "/js/utils.js";
import { initUploader } from "/js/uploader.js";
import { renderPdfWithTags } from "/js/tagging.js";
import { buildTranscriptPDF, downloadBlob } from "/js/pdf-export.js";

initFirebase();

/* ---------- DOM ---------- */
const roleBadge     = document.getElementById("roleBadge");
const avatar        = document.getElementById("avatar");
const signOutBtn    = document.getElementById("signOutBtn");
const bannerArea    = document.getElementById("bannerArea");

const tabsNav = document.querySelector(".tabs");
const tabs = {
  details:   document.getElementById("tab-details"),
  documents: document.getElementById("tab-documents"),
  comments:  document.getElementById("tab-comments"),
};

/* Details */
const finishedLock    = document.getElementById("finishedLock");
const detailsForm     = document.getElementById("detailsForm");
const newCaseActions  = document.getElementById("newCaseActions");
const createCaseBtn   = document.getElementById("createCaseBtn");
const saveDetailsBtn  = document.getElementById("saveDetailsBtn");
const assignNurseBtn  = document.getElementById("assignNurseBtn");
const assignDoctorBtn = document.getElementById("assignDoctorBtn");
const statusText      = document.getElementById("statusText");
const finishBtn       = document.getElementById("finishBtn");
const undoBtn         = document.getElementById("undoBtn");
const downloadPdfBtn  = document.getElementById("downloadPdf");

const fName       = document.getElementById("fName");
const fMemberID   = document.getElementById("fMemberID");
const fHospital   = document.getElementById("fHospital");
const fDiagnosis  = document.getElementById("fDiagnosis");
const fConsult    = document.getElementById("fConsultType");
const fDeadline   = document.getElementById("fDeadline");
const fReasonAdm  = document.getElementById("fReasonAdm");
const fReasonCons = document.getElementById("fReasonConsult");

/* Documents */
const fileInput    = document.getElementById("fileInput");
const uploadsList  = document.getElementById("uploadsList");
const pdfContainer = document.getElementById("pdfContainer");
const tagFilterSel = document.getElementById("tagFilter");

/* Comments */
const commentsList  = document.getElementById("commentsList");
const commentForm   = document.getElementById("commentForm");
const commentBody   = document.getElementById("commentBody");
const commentMQ     = document.getElementById("commentMQ");
const addCommentBtn = document.getElementById("addCommentBtn");

/* ---------- State ---------- */
let state = {
  user: null,
  role: null,          // 'nurse' | 'doctor' | 'admin'
  caseId: null,
  caseDoc: null,
  isNew: false,
  selectedPdf: null,   // { uploadId, driveFileId }
};

/* ---------- Helpers ---------- */
function getHashId() {
  const h = (location.hash || "").slice(1);
  return h || null;
}
function setActiveTab(name) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
  Object.entries(tabs).forEach(([k, el]) => el.classList.toggle("is-active", k === name));
}
function setHeaderUser(user, role) {
  if (!user) return;
  roleBadge.hidden = false;
  roleBadge.textContent = (role || "").toUpperCase();
  signOutBtn.hidden = false;
  avatar.hidden = false;
  avatar.src = user.photoURL || "";
  avatar.alt = user.displayName || user.email || "User";
}
function lockUIFinished(isFinished) {
  finishedLock.classList.toggle("hidden", !isFinished);
  // Details form inputs disabled when finished
  detailsForm.querySelectorAll(".input").forEach(i => i.disabled = isFinished);
  // Upload disabled when finished
  fileInput.disabled = isFinished;
  // Buttons visibility
  finishBtn.hidden = isFinished || !(state.role === "nurse" || state.role === "admin");
  undoBtn.hidden   = !isFinished || !(state.role === "nurse" || state.role === "admin");
}
function onlyAssignedNurseCanEdit() {
  if (!state.caseDoc) return false;
  const assigned = state.caseDoc.assignedNurse?.email;
  return state.role === "nurse" && assigned === state.user.email;
}
function setDetailsEditable() {
  const canEdit = onlyAssignedNurseCanEdit() && state.caseDoc.status !== "finished";
  detailsForm.querySelectorAll(".input").forEach(i => i.disabled = !canEdit);
  saveDetailsBtn.disabled = !canEdit;
}

/* Tag filter visibility helper */
function applyTagFilter() {
  const val = tagFilterSel.value || "";
  if (!pdfContainer || !pdfContainer.querySelectorAll) return;
  pdfContainer.querySelectorAll(".pdf-page").forEach(pg => {
    const sel = pg.querySelector(".tag-select");
    const t = sel?.value || "";
    pg.style.display = (!val || val === t) ? "" : "none";
  });
}

/* ---------- Renderers ---------- */
function fillDetailsForm(doc) {
  statusText.textContent = statusLabel(doc.status);
  fName.value       = doc.details?.Name || "";
  fMemberID.value   = doc.details?.MemberID || "";
  fHospital.value   = doc.details?.Hospital || "";
  fDiagnosis.value  = doc.details?.Diagnosis || "";
  fConsult.value    = doc.details?.TypeOfConsultation || "";
  fReasonAdm.value  = doc.details?.ReasonForAdmission || "";
  fReasonCons.value = doc.details?.ReasonForConsultation || "";

  // deadline input expects local "YYYY-MM-DDTHH:mm"
  if (doc.deadlineAt) {
    const d = new Date(doc.deadlineAt.seconds ? doc.deadlineAt.seconds * 1000 : doc.deadlineAt);
    const iso = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    fDeadline.value = iso;
  } else {
    fDeadline.value = "";
  }

  // Assign buttons visibility (self-assign rules)
  assignNurseBtn.hidden  = !(state.role === "nurse");
  assignDoctorBtn.hidden = !((state.role === "doctor") || (state.role === "admin"));

  lockUIFinished(doc.status === "finished");
  setDetailsEditable();

  // Transcript button always available (read-only) for any signed-in role
  downloadPdfBtn.hidden = false;
}

function renderComments(items) {
  commentsList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No comments yet.";
    commentsList.appendChild(empty);
    return;
  }
  for (const c of items) {
    const card = document.createElement("article");
    card.className = "comment";
    const who  = c.author?.displayName || c.author?.email || "Unknown";
    const when = c.createdAt?.seconds ? new Date(c.createdAt.seconds*1000).toLocaleString() : "";

    const head = document.createElement("div");
    head.innerHTML = `<span class="who">${who}</span> · <span class="when">${when}</span>`;
    card.appendChild(head);

    const body = document.createElement("p");
    body.textContent = c.body || "";
    card.appendChild(body);

    // MQ block
    const mqBlock = document.createElement("div");
    mqBlock.className = "mq";
    mqBlock.textContent = "Loading MQ…";
    card.appendChild(mqBlock);

    getCommentMQ(c.id).then(mq => {
      mqBlock.textContent = mq?.text ? mq.text : "(No MQ)";
    });

    commentsList.appendChild(card);
  }
}

function renderUploadsList(rows) {
  uploadsList.innerHTML = "";
  rows.forEach(r => {
    const row = document.createElement("div");
    row.className = "upload-row";
    const link = document.createElement("a");
    link.href = streamFileUrl(r.driveFileId);
    link.target = "_blank";
    link.textContent = r.fileName;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = ` • ${r.mimeType || ""}`;

    row.appendChild(link);
    row.appendChild(meta);

    // Click to preview if PDF
    if ((r.mimeType || "").toLowerCase().includes("pdf") && !r.deletedAt) {
      row.style.cursor = "pointer";
      row.addEventListener("click", () => showPdf(r));
    }

    uploadsList.appendChild(row);
  });
}

/* ---------- Actions ---------- */
async function loadCase() {
  const id = getHashId();
  state.caseId = id;
  state.isNew = (id === "new");

  // New case flow (nurse/admin only; nurse will be assignee)
  if (state.isNew) {
    statusText.textContent = statusLabel("awaiting doctor");
    newCaseActions.classList.remove("hidden");
    lockUIFinished(false);
    setDetailsEditable(); // will be disabled until created; allow nurse to type fields though
    assignNurseBtn.hidden = !(state.role === "nurse");
    assignDoctorBtn.hidden = true;
    downloadPdfBtn.hidden = true;
    return;
  }

  const doc = await getCase(id);
  state.caseDoc = doc;
  if (!doc) {
    alert("Case not found");
    location.href = "/index.html";
    return;
  }
  fillDetailsForm(doc);

  // Load uploads list
  const uploads = await listUploads(id);
  renderUploadsList(uploads);

  // Populate tag filter options from settings
  const tags = await getTagOptions();
  tagFilterSel.innerHTML = `<option value="">All</option>` + tags.map(t => `<option>${t}</option>`).join("");
}

async function saveDetails() {
  if (state.isNew) return;
  if (!onlyAssignedNurseCanEdit()) return;

  const partial = {
    details: {
      ...(state.caseDoc.details || {}),
      Name: fName.value.trim(),
      MemberID: fMemberID.value.trim(),
      Hospital: fHospital.value.trim(),
      Diagnosis: fDiagnosis.value.trim(),
      TypeOfConsultation: fConsult.value.trim(),
      ReasonForAdmission: fReasonAdm.value.trim(),
      ReasonForConsultation: fReasonCons.value.trim(),
    }
  };

  // deadline: convert local input to Date (which Firestore stores as UTC)
  if (fDeadline.value) partial.deadlineAt = new Date(fDeadline.value);

  await updateCase(state.caseId, partial, state.user);
  // refresh status pill / updated fields
  const latest = await getCase(state.caseId);
  state.caseDoc = latest;
  fillDetailsForm(latest);
}

async function createNewCase() {
  if (!(state.role === "nurse" || state.role === "admin")) {
    alert("Only nurses/admins can create cases");
    return;
  }
  const initial = {
    status: "awaiting doctor",
    details: {
      Name: fName.value.trim(),
      MemberID: fMemberID.value.trim(),
      Hospital: fHospital.value.trim(),
      Diagnosis: fDiagnosis.value.trim(),
      TypeOfConsultation: fConsult.value.trim(),
      ReasonForAdmission: fReasonAdm.value.trim(),
      ReasonForConsultation: fReasonCons.value.trim(),
    },
    // save deadline if set
    ...(fDeadline.value ? { deadlineAt: new Date(fDeadline.value) } : {}),
    assignedNurse: (state.role === "nurse") ? { email: state.user.email, displayName: state.user.displayName || state.user.email, at: new Date() } : null,
    assignedDoctor: null
  };
  const created = await createCase(initial, state.user);
  location.replace(`/case.html#${created.id}`);
  location.reload();
}

async function assignSelf(role) {
  if (!state.caseId) return;
  if (role === "nurse" && state.role === "nurse") {
    await updateCase(state.caseId, {
      assignedNurse: { email: state.user.email, displayName: state.user.displayName || state.user.email, at: new Date() }
    }, state.user);
  } else if (role === "doctor" && (state.role === "doctor" || state.role === "admin")) {
    await updateCase(state.caseId, {
      assignedDoctor: { email: state.user.email, displayName: state.user.displayName || state.user.email, at: new Date() }
    }, state.user);
  }
  const latest = await getCase(state.caseId);
  state.caseDoc = latest;
  fillDetailsForm(latest);
}

async function markFinished() {
  await finishCase(state.caseId, state.user);
  const latest = await getCase(state.caseId);
  state.caseDoc = latest;
  fillDetailsForm(latest);
}
async function undoFinishedAction() {
  await undoFinish(state.caseId, state.user);
  const latest = await getCase(state.caseId);
  state.caseDoc = latest;
  fillDetailsForm(latest);
}

/* Comments */
async function refreshComments() {
  const items = await listComments(state.caseId);
  renderComments(items);
}

async function postComment() {
  const body = commentBody.value.trim();
  const mq   = commentMQ.value.trim();
  if (!body) return;

  await addComment(state.caseId, body, state.user);

  // status hop: doctor -> awaiting nurse, nurse -> awaiting doctor
  if (state.role === "doctor") {
    await updateCase(state.caseId, { status: "awaiting nurse" }, state.user);
  } else if (state.role === "nurse") {
    await updateCase(state.caseId, { status: "awaiting doctor" }, state.user);
  }

  // If MQ present, attach to the *last* comment (we could also capture the id from addComment)
  // Simpler: reload list and attach to newest
  const items = await listComments(state.caseId);
  const last = items[items.length - 1];
  if (last && mq) {
    await upsertCommentMQ({ caseId: state.caseId, commentId: last.id, text: mq, currentUser: state.user });
  }

  commentBody.value = "";
  commentMQ.value = "";
  await refreshComments();

  // refresh case header (status changed)
  const latest = await getCase(state.caseId);
  state.caseDoc = latest;
  fillDetailsForm(latest);
}

/* Documents */
async function showPdf(uploadRow) {
  state.selectedPdf = { uploadId: uploadRow.id, driveFileId: uploadRow.driveFileId };
  pdfContainer.innerHTML = "";
  await renderPdfWithTags({
    containerEl: pdfContainer,
    caseId: state.caseId,
    uploadId: uploadRow.id,
    driveFileId: uploadRow.driveFileId,
    onTagChange: applyTagFilter
  });
  applyTagFilter();
}

/* Transcript */
async function downloadTranscript() {
  const caseDoc   = state.caseDoc || await getCase(state.caseId);
  const comments  = await listComments(state.caseId);
  // Build MQ map
  const mqMap = new Map();
  for (const c of comments) {
    const mq = await getCommentMQ(c.id);
    if (mq) mqMap.set(c.id, mq);
  }
  const blob = await buildTranscriptPDF({ caseDoc: { id: state.caseId, ...caseDoc }, comments, mqMap });
  downloadBlob(blob, `Case-${state.caseId}.pdf`);
}

/* ---------- Events ---------- */
tabsNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  setActiveTab(btn.dataset.tab);
});

signOutBtn.addEventListener("click", () => signOutNow());
saveDetailsBtn.addEventListener("click", (e) => { e.preventDefault(); saveDetails(); });
createCaseBtn.addEventListener("click", (e) => { e.preventDefault(); createNewCase(); });
assignNurseBtn.addEventListener("click", (e) => { e.preventDefault(); assignSelf("nurse"); });
assignDoctorBtn.addEventListener("click", (e) => { e.preventDefault(); assignSelf("doctor"); });
finishBtn.addEventListener("click", (e) => { e.preventDefault(); markFinished(); });
undoBtn.addEventListener("click", (e) => { e.preventDefault(); undoFinishedAction(); });
tagFilterSel.addEventListener("change", applyTagFilter);
commentForm.addEventListener("submit", (e) => { e.preventDefault(); postComment(); });
downloadPdfBtn.addEventListener("click", downloadTranscript);

/* ---------- Uploader wiring ---------- */
function initDocsUploader() {
  initUploader({
    fileInput,
    listContainer: uploadsList,
    bannerArea,
    caseId: state.caseId,
    onUploaded: async () => {
      const rows = await listUploads(state.caseId);
      renderUploadsList(rows);
    }
  });
}

/* ---------- Auth ---------- */
onAuth(async (user) => {
  if (!user) {
    location.href = "/index.html";
    return;
  }
  state.user = user;
  const role = await loadRole();
  state.role = role;

  setHeaderUser(user, role);

  // Initialize case view
  await loadCase();

  // Initialize docs uploader for existing cases (not for "new" until created)
  if (!state.isNew) initDocsUploader();
});
