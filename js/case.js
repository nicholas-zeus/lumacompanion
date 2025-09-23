import { initFirebase, onAuth, signOutNow, auth } from "/js/firebase.js";
import {
  loadRole, getCase, createCase, updateCase,
  finishCase, undoFinish,
  listComments, addComment,
  getCommentMQ, upsertCommentMQ,
  listUploads, streamFileUrl,
  getTagOptions, statusLabel,
  setPageTag
} from "/js/api.js";
import { formatDeadline, computeAge, requireFields, toDate } from "/js/utils.js";
import { renderLocalPdfWithTags } from "/js/tagging.js";

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

/* Details (many fields omitted here for brevity — keep your full set) */
const finishedLock    = document.getElementById("finishedLock");
const detailsForm     = document.getElementById("detailsForm");
const newCaseActions  = document.getElementById("newCaseActions");
const saveDetailsBtn  = document.getElementById("saveDetailsBtn");
const assignNurseBtn  = document.getElementById("assignNurseBtn");
const assignDoctorBtn = document.getElementById("assignDoctorBtn");
const statusText      = document.getElementById("statusText");
const finishBtn       = document.getElementById("finishBtn");
const undoBtn         = document.getElementById("undoBtn");
const downloadPdfBtn  = document.getElementById("downloadPdf");

/* Keep your full field bindings from the previous file */
const f = (id) => document.getElementById(id);
const fName=f("fName"), fMemberID=f("fMemberID"), fNationality=f("fNationality"),
      fDOB=f("fDOB"), fAgeYears=f("fAgeYears"), fAgeMonths=f("fAgeMonths"),
      fPolicyEff=f("fPolicyEff"), fUWType=f("fUWType"), fAdmissionType=f("fAdmissionType"),
      fConsultType=f("fConsultType"), fVisitDate=f("fVisitDate"), fHospital=f("fHospital"),
      fDiagnosis=f("fDiagnosis"), fDischargeDate=f("fDischargeDate"), fChiefComplaint=f("fChiefComplaint"),
      fPresentIllness=f("fPresentIllness"), fExclusion=f("fExclusion"), fUrgent=f("fUrgent"),
      fDeadline=f("fDeadline"), fVitalSigns=f("fVitalSigns"), fPhysicalFindings=f("fPhysicalFindings"),
      fSummary=f("fSummary"), fTreatment=f("fTreatment"), fReasonAdm=f("fReasonAdm"),
      fReasonConsult=f("fReasonConsult"), fOtherRemark=f("fOtherRemark");

/* Documents */
const fileInput      = document.getElementById("fileInput");
const uploadsList    = document.getElementById("uploadsList");
const pdfContainer   = document.getElementById("pdfContainer");
const tagFilterSel   = document.getElementById("tagFilter");
const tagFilterWrap  = document.getElementById("tagFilterWrap");
const docSaveBtn     = document.getElementById("docSaveBtn");
const docCancelBtn   = document.getElementById("docCancelBtn");
const stagedInfo     = document.getElementById("stagedInfo");
const stagedName     = document.getElementById("stagedName");

/* Comments */
const commentsList   = document.getElementById("commentsList");
const commentForm    = document.getElementById("commentForm");
const commentBody    = document.getElementById("commentBody");
const commentMQ      = document.getElementById("commentMQ");
const saveCommentBtn = document.getElementById("saveCommentBtn");
const confirmBtn     = document.getElementById("confirmBtn");

/* ---------- State ---------- */
let state = {
  user: null,
  role: null,
  caseId: null,
  caseDoc: null,
  isNew: false,

  stagedFile: null,        // File object (PDF or other) waiting to Save
  stagedUrl: null,         // object URL for PDF preview
};

/* ---------- Helpers ---------- */
function getHashId() {
  const h = (location.hash || "").slice(1);
  return h || "new";
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
  detailsForm.querySelectorAll(".input").forEach(i => i.disabled = isFinished);
  fileInput.disabled = isFinished;
  finishBtn.hidden = isFinished || !(state.role === "nurse" || state.role === "admin");
  undoBtn.hidden   = !isFinished || !(state.role === "nurse" || state.role === "admin");
}
function onlyAssignedNurseCanEdit() {
  if (!state.caseDoc) return false;
  const assigned = state.caseDoc.assignedNurse?.email;
  return state.role === "nurse" && assigned === state.user.email;
}
function setDetailsEditable() {
  const canEdit = state.isNew ? (state.role === "nurse" || state.role === "admin")
                              : (onlyAssignedNurseCanEdit() && state.caseDoc.status !== "finished");
  detailsForm.querySelectorAll(".input").forEach(i => i.disabled = !canEdit);
  saveDetailsBtn.disabled = !canEdit;
}

/* Age auto-calc */
function updateAgeFields() {
  const refDate = fVisitDate.value ? new Date(fVisitDate.value) : new Date();
  const { years, months } = computeAge(fDOB.value, refDate);
  fAgeYears.value = years;
  fAgeMonths.value = months;
}

/* Collect details object (unchanged) */
function collectDetails() {
  return {
    Name: fName.value.trim(),
    MemberID: fMemberID.value.trim(),
    Nationality: fNationality.value.trim(),
    DOB: fDOB.value ? new Date(fDOB.value) : null,
    AgeYears: fAgeYears.value ? Number(fAgeYears.value) : null,
    AgeMonths: fAgeMonths.value ? Number(fAgeMonths.value) : null,
    PolicyEffectiveDate: fPolicyEff.value ? new Date(fPolicyEff.value) : null,
    Exclusion: fExclusion.value.trim(),
    UnderwritingType: fUWType.value || "",
    TypeOfAdmission: fAdmissionType.value || "",
    TypeOfConsultation: fConsultType.value.trim(),
    VisitDate: fVisitDate.value ? new Date(fVisitDate.value) : null,
    Hospital: fHospital.value.trim(),
    Diagnosis: fDiagnosis.value.trim(),
    DischargeDate: fDischargeDate.value ? new Date(fDischargeDate.value) : null,
    ChiefComplaint: fChiefComplaint.value.trim(),
    PresentIllness: fPresentIllness.value.trim(),
    VitalSigns: fVitalSigns.value.trim() || null,
    PhysicalFindings: fPhysicalFindings.value.trim() || null,
    Summary: fSummary.value.trim() || null,
    Treatment: fTreatment.value.trim() || null,
    ReasonForAdmission: fReasonAdm.value.trim(),
    ReasonForConsultation: fReasonConsult.value.trim(),
    OtherRemark: fOtherRemark.value.trim() || null
  };
}

/* ---------- Renderers ---------- */
function fillDetailsForm(doc) {
  statusText.textContent = statusLabel(doc.status);
  const d = doc.details || {};
  // … (populate all fields exactly as in your previous working file) …

  // urgent/deadline
  document.getElementById("fUrgent").checked = !!doc.urgent;
  if (doc.deadlineAt) {
    const dd = new Date(doc.deadlineAt.seconds ? doc.deadlineAt.seconds * 1000 : doc.deadlineAt);
    const iso = new Date(dd.getTime() - dd.getTimezoneOffset()*60000).toISOString().slice(0,16);
    document.getElementById("fDeadline").value = iso;
  } else {
    document.getElementById("fDeadline").value = "";
  }

  // Self-assign buttons (NEW: never show nurse button on new-case; auto-assign on create)
  assignNurseBtn.hidden  = !(state.role === "nurse") || state.isNew;
  assignDoctorBtn.hidden = !((state.role === "doctor") || (state.role === "admin"));

  lockUIFinished(doc.status === "finished");
  setDetailsEditable();
  downloadPdfBtn.hidden = false;
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
    uploadsList.appendChild(row);
  });
}

/* ---------- Case lifecycle ---------- */
async function loadCase() {
  const id = getHashId();
  state.caseId = id;
  state.isNew = (id === "new");

  if (state.isNew) {
    statusText.textContent = statusLabel("awaiting doctor");
    newCaseActions?.classList?.remove("hidden");
    lockUIFinished(false);
    setDetailsEditable();
    // NEW: never show nurse self-assign on new case (auto-assign happens in createNewCase)
    assignNurseBtn.hidden = true;
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

  const uploads = await listUploads(id);
  renderUploadsList(uploads);

  const tags = await getTagOptions();
  tagFilterSel.innerHTML = `<option value="">All</option>` + tags.map(t => `<option>${t}</option>`).join("");
}

/* ---------- Details save/create ---------- */
async function saveDetails() {
  if (state.isNew) { await createNewCase(); return; }
  if (!(onlyAssignedNurseCanEdit())) return;

  // Urgent rule: if checked, deadline required
  const urgentEl = document.getElementById("fUrgent");
  const deadlineEl = document.getElementById("fDeadline");
  if (urgentEl.checked && !deadlineEl.value) {
    alert("Deadline is required when Urgent is checked.");
    return;
  }

  const details = collectDetails();
  const req = requireFields(details, [
    "Name","MemberID","Nationality","DOB","PolicyEffectiveDate","Exclusion",
    "UnderwritingType","TypeOfAdmission","TypeOfConsultation","VisitDate","Hospital",
    "Diagnosis","ChiefComplaint","PresentIllness","ReasonForAdmission","ReasonForConsultation"
  ]);
  if (!req.ok) { alert(req.msg); return; }

  const partial = { details, urgent: urgentEl.checked || undefined };
  if (deadlineEl.value) partial.deadlineAt = new Date(deadlineEl.value);

  await updateCase(state.caseId, partial, state.user);
  const latest = await getCase(state.caseId);
  state.caseDoc = latest;
  fillDetailsForm(latest);
}

async function createNewCase() {
  if (!(state.role === "nurse" || state.role === "admin")) {
    alert("Only nurses/admins can create cases");
    return;
  }
  const urgentEl = document.getElementById("fUrgent");
  const deadlineEl = document.getElementById("fDeadline");
  if (urgentEl.checked && !deadlineEl.value) {
    alert("Deadline is required when Urgent is checked.");
    return;
  }

  const details = collectDetails();
  const req = requireFields(details, [
    "Name","MemberID","Nationality","DOB","PolicyEffectiveDate","Exclusion",
    "UnderwritingType","TypeOfAdmission","TypeOfConsultation","VisitDate","Hospital",
    "Diagnosis","ChiefComplaint","PresentIllness","ReasonForAdmission","ReasonForConsultation"
  ]);
  if (!req.ok) { alert(req.msg); return; }

  const initial = {
    status: "awaiting doctor",
    details,
    urgent: urgentEl.checked,
    ...(deadlineEl.value ? { deadlineAt: new Date(deadlineEl.value) } : {}),
    // NEW: auto-assign nurse to creator
    assignedNurse: (state.role === "nurse")
      ? { email: state.user.email, displayName: state.user.displayName || state.user.email, at: new Date() }
      : null,
    assignedDoctor: null
  };
  const created = await createCase(initial, state.user);
  location.replace(`/case.html#${created.id}`);
  location.reload();
}

/* ---------- Comments ---------- */
async function renderComments() {
  commentsList.innerHTML = "";
  const items = await listComments(state.caseId);
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
    const body = document.createElement("p"); body.textContent = c.body || "";
    const mqBlock = document.createElement("div"); mqBlock.className = "mq"; mqBlock.textContent = "Loading MQ…";

    card.appendChild(head); card.appendChild(body); card.appendChild(mqBlock);
    const mq = await getCommentMQ(c.id); mqBlock.textContent = mq?.text ? mq.text : "(No MQ)";
    commentsList.appendChild(card);
  }
}
async function postComment(handoff) {
  const body = commentBody.value.trim();
  const mq   = commentMQ.value.trim();
  if (!body) return;

  await addComment(state.caseId, body, state.user);
  if (handoff) {
    if (state.role === "doctor")      await updateCase(state.caseId, { status: "awaiting nurse" }, state.user);
    else if (state.role === "nurse")  await updateCase(state.caseId, { status: "awaiting doctor" }, state.user);
  }
  if (mq) {
    // attach to newest
    const items = await (await import("/js/api.js")).listComments(state.caseId);
    const last = items[items.length - 1];
    if (last) await upsertCommentMQ({ caseId: state.caseId, commentId: last.id, text: mq, currentUser: state.user });
  }
  commentBody.value = ""; commentMQ.value = "";
  await renderComments();
  const latest = await getCase(state.caseId); state.caseDoc = latest; fillDetailsForm(latest);
}

/* ---------- Documents: stage → tag → save ---------- */
function resetStaging() {
  if (state.stagedUrl) URL.revokeObjectURL(state.stagedUrl);
  state.stagedFile = null; state.stagedUrl = null;
  stagedInfo.style.display = "none"; stagedName.textContent = "";
  pdfContainer.className = "pdf-grid-empty";
  pdfContainer.innerHTML = "Select a PDF to preview & tag pages (will upload on Save).";
  tagFilterWrap.style.display = "none";
  docSaveBtn.disabled = true; docCancelBtn.disabled = true;
}

async function onFileChosen(file) {
  resetStaging();
  if (!file) return;

  state.stagedFile = file;
  stagedInfo.style.display = "block";
  stagedName.textContent = `${file.name} (${Math.round(file.size/1024)} KB)`;
  docCancelBtn.disabled = false;

  // If PDF: render locally for tagging (no upload yet)
  if ((file.type || "").toLowerCase().includes("pdf")) {
    pdfContainer.innerHTML = "";
    pdfContainer.classList.remove("pdf-grid-empty");
    state.stagedUrl = URL.createObjectURL(file);
    await renderLocalPdfWithTags({
      containerEl: pdfContainer,
      file,
      onTagChange: () => applyTagFilter()
    });
    const tags = await getTagOptions();
    tagFilterSel.innerHTML = `<option value="">All</option>` + tags.map(t => `<option>${t}</option>`).join("");
    tagFilterWrap.style.display = "";
    applyTagFilter();
  } else {
    pdfContainer.className = "pdf-grid-empty";
    pdfContainer.innerHTML = "This file type does not support page tagging. Click Save to upload.";
  }

  // Enable Save
  docSaveBtn.disabled = false;
}

function applyTagFilter() {
  const val = tagFilterSel.value || "";
  if (!pdfContainer || !pdfContainer.querySelectorAll) return;
  pdfContainer.querySelectorAll(".pdf-page").forEach(pg => {
    const sel = pg.querySelector(".tag-select");
    const t = sel?.value || "";
    pg.style.display = (!val || val === t) ? "" : "none";
  });
}

async function saveStagedDocument() {
  if (!state.stagedFile) return;
  // Upload to Drive
  const { uploadFile } = await import("/js/api.js");
  const meta = await uploadFile({ file: state.stagedFile, caseId: state.caseId, batchNo: 1 });

  // Create uploads doc
  const { db } = await import("/js/firebase.js");
  const { COLLECTIONS } = await import("/js/config.js");
  const { collection, addDoc, serverTimestamp, query, where, getDocs, doc: ddoc, setDoc } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const upRef = await addDoc(collection(db, COLLECTIONS.uploads), {
    caseId: state.caseId,
    batchNo: 1,
    fileName: meta.fileName,
    fileType: meta.mimeType,
    size: meta.size,
    driveFileId: meta.fileId,
    fileHash: meta.md5,
    uploadedBy: { email: (auth.currentUser?.email || ""), displayName: (auth.currentUser?.displayName || "") },
    uploadedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  const uploadId = upRef.id;

  // If PDF: persist page tags from UI selects
  if ((state.stagedFile.type || "").toLowerCase().includes("pdf")) {
    const selects = Array.from(pdfContainer.querySelectorAll(".pdf-page .tag-select"));
    const writes = [];
    selects.forEach((sel, idx) => {
      const tag = sel.value;
      if (tag) {
        writes.push(setPageTag({ caseId: state.caseId, uploadId, pageNumber: idx + 1, tag }));
      }
    });
    await Promise.all(writes);
  }

  // Duplicate banner (soft, persistent)
  const dupIds = await (async () => {
    const col = collection(db, COLLECTIONS.uploads);
    const snap = await getDocs(query(col, where("fileHash", "==", meta.md5)));
    const ids = new Set();
    snap.forEach(docSnap => {
      const row = docSnap.data();
      if (row.caseId && row.caseId !== state.caseId && !row.deletedAt) ids.add(row.caseId);
    });
    return Array.from(ids);
  })();
  if (dupIds.length) {
    const { renderDuplicateBanner } = await import("/js/uploader.js");
    renderDuplicateBanner(bannerArea, dupIds);
  }

  // Refresh list & clear staging
  const rows = await listUploads(state.caseId);
  renderUploadsList(rows);
  URL.revokeObjectURL(state.stagedUrl);
  resetStaging();
}

/* ---------- Events ---------- */
tabsNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  setActiveTab(btn.dataset.tab);
});

document.getElementById("fDOB")?.addEventListener("change", updateAgeFields);
document.getElementById("fVisitDate")?.addEventListener("change", updateAgeFields);

signOutBtn.addEventListener("click", () => signOutNow());
saveDetailsBtn.addEventListener("click", (e) => { e.preventDefault(); saveDetails(); });
finishBtn.addEventListener("click", async (e) => { e.preventDefault(); await finishCase(state.caseId, state.user); const c = await getCase(state.caseId); state.caseDoc=c; fillDetailsForm(c); });
undoBtn.addEventListener("click", async (e) => { e.preventDefault(); await undoFinish(state.caseId, state.user); const c = await getCase(state.caseId); state.caseDoc=c; fillDetailsForm(c); });

commentForm.addEventListener("submit", (e) => { e.preventDefault(); }); // handled by buttons
saveCommentBtn.addEventListener("click", (e) => { e.preventDefault(); postComment(false); });
confirmBtn.addEventListener("click", (e) => { e.preventDefault(); postComment(true); });

fileInput.addEventListener("change", async (e) => {
  const file = (e.target.files || [])[0];
  await onFileChosen(file);
});
docCancelBtn.addEventListener("click", (e) => { e.preventDefault(); resetStaging(); fileInput.value = ""; });
docSaveBtn.addEventListener("click", async (e) => { e.preventDefault(); await saveStagedDocument(); });

/* ---------- Auth ---------- */
onAuth(async (user) => {
  if (!user) { location.href = "/index.html"; return; }
  state.user = user;
  state.role = await loadRole();
  setHeaderUser(user, state.role);
  await loadCase();
  if (state.isNew) updateAgeFields();
});
