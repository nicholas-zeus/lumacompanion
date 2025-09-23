import { initFirebase, onAuth, signOutNow, auth } from "/js/firebase.js";
import {
  loadRole, getCase, createCase, updateCase,
  finishCase, undoFinish,
  listComments, addComment,
  getCommentMQ, upsertCommentMQ,
  listUploads, streamFileUrl,
  getTagOptions, statusLabel,
  setPageTag, uploadFile
} from "/js/api.js";
import { computeAge, requireFields, toDate } from "/js/utils.js";
import { renderPdfWithTags, renderLocalPdfWithTags } from "/js/tagging.js";

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

/* Details controls */
const finishedLock    = document.getElementById("finishedLock");
const detailsForm     = document.getElementById("detailsForm");
const newCaseActions  = document.getElementById("newCaseActions");
const editDetailsBtn  = document.getElementById("editDetailsBtn");
const saveDetailsBtn  = document.getElementById("saveDetailsBtn");
const assignNurseBtn  = document.getElementById("assignNurseBtn");
const assignDoctorBtn = document.getElementById("assignDoctorBtn");
const statusText      = document.getElementById("statusText");
const finishBtn       = document.getElementById("finishBtn");
const undoBtn         = document.getElementById("undoBtn");
const downloadPdfBtn  = document.getElementById("downloadPdf");

/* Detail fields */
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
  isEditing: false,

  stagedFile: null,
  stagedUrl: null,
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
function onlyAssignedNurseCanEdit() {
  if (!state.caseDoc) return false;
  const assigned = state.caseDoc.assignedNurse?.email;
  return state.role === "nurse" && assigned === state.user.email;
}
function setDetailsDisabled(disabled) {
  detailsForm.querySelectorAll(".input").forEach(i => i.disabled = disabled);
}
function lockUIFinished(isFinished) {
  finishedLock.classList.toggle("hidden", !isFinished);
  setDetailsDisabled(isFinished || (!state.isNew && !state.isEditing));
  fileInput.disabled = isFinished;
  finishBtn.hidden = isFinished || !(state.role === "nurse" || state.role === "admin");
  undoBtn.hidden   = !isFinished || !(state.role === "nurse" || state.role === "admin");
}

/* dates -> input value helpers */
function toInputDate(d) {
  const dt = toDate(d);
  if (!dt) return "";
  // to YYYY-MM-DD
  return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
function toInputDateTimeLocal(d) {
  const dt = toDate(d);
  if (!dt) return "";
  return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

/* Age auto-calc */
function updateAgeFields() {
  const refDate = fVisitDate.value ? new Date(fVisitDate.value) : new Date();
  const { years, months } = computeAge(fDOB.value, refDate);
  fAgeYears.value = years;
  fAgeMonths.value = months;
}

/* Build details payload */
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

  fName.value            = d.Name || "";
  fMemberID.value        = d.MemberID || "";
  fNationality.value     = d.Nationality || "";
  fDOB.value             = toInputDate(d.DOB);
  fAgeYears.value        = d.AgeYears ?? "";
  fAgeMonths.value       = d.AgeMonths ?? "";
  fPolicyEff.value       = toInputDate(d.PolicyEffectiveDate);
  fExclusion.value       = d.Exclusion || "";
  fUWType.value          = d.UnderwritingType || "";
  fAdmissionType.value   = d.TypeOfAdmission || "";
  fConsultType.value     = d.TypeOfConsultation || "";
  fVisitDate.value       = toInputDate(d.VisitDate);
  fHospital.value        = d.Hospital || "";
  fDiagnosis.value       = d.Diagnosis || "";
  fDischargeDate.value   = toInputDate(d.DischargeDate);
  fChiefComplaint.value  = d.ChiefComplaint || "";
  fPresentIllness.value  = d.PresentIllness || "";
  fVitalSigns.value      = d.VitalSigns || "";
  fPhysicalFindings.value= d.PhysicalFindings || "";
  fSummary.value         = d.Summary || "";
  fTreatment.value       = d.Treatment || "";
  fReasonAdm.value       = d.ReasonForAdmission || "";
  fReasonConsult.value   = d.ReasonForConsultation || "";
  fOtherRemark.value     = d.OtherRemark || "";

  fUrgent.checked = !!doc.urgent;
  fDeadline.value = toInputDateTimeLocal(doc.deadlineAt);

  // default: EXISTING cases → locked, show Edit; NEW cases → unlocked, show Create
  if (!state.isNew) {
    state.isEditing = false;
    setDetailsDisabled(true);
    editDetailsBtn.hidden = false;
    saveDetailsBtn.hidden = true;
  }

  assignNurseBtn.hidden  = !(state.role === "nurse") || state.isNew; // hidden on new (auto-assign)
  assignDoctorBtn.hidden = !((state.role === "doctor") || (state.role === "admin"));

  lockUIFinished(doc.status === "finished");
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

    if ((r.mimeType || "").toLowerCase().includes("pdf") && !r.deletedAt) {
      row.style.cursor = "pointer";
      row.addEventListener("click", async () => {
        await renderPdfWithTags({
          containerEl: pdfContainer,
          caseId: state.caseId,
          uploadId: r.id,
          driveFileId: r.driveFileId,
          onTagChange: applyTagFilter
        });
        tagFilterWrap.style.display = "";
        const tags = await getTagOptions();
        tagFilterSel.innerHTML = `<option value="">All</option>` + tags.map(t => `<option>${t}</option>`).join("");
        applyTagFilter();
        docSaveBtn.disabled = true; // no staged file; tags auto-save on change
      });
    }

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
    newCaseActions.classList.remove("hidden");
    editDetailsBtn.hidden = true; // new case is already editable
    saveDetailsBtn.hidden = true; // we use Create button instead
    setDetailsDisabled(false);
    lockUIFinished(false);
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

  // prepare tag filter list
  const tags = await getTagOptions();
  tagFilterSel.innerHTML = `<option value="">All</option>` + tags.map(t => `<option>${t}</option>`).join("");
}

/* ---------- Details save/create ---------- */
async function saveDetails() {
  if (state.isNew) return; // new uses createNewCase()

  // urgent rule
  if (fUrgent.checked && !fDeadline.value) {
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

  const partial = { details, urgent: fUrgent.checked || undefined };
  if (fDeadline.value) partial.deadlineAt = new Date(fDeadline.value);

  await updateCase(state.caseId, partial, state.user);
  const latest = await getCase(state.caseId);
  state.caseDoc = latest;
  fillDetailsForm(latest);

  // lock again
  state.isEditing = false;
  setDetailsDisabled(true);
  editDetailsBtn.hidden = false;
  saveDetailsBtn.hidden = true;
}

async function createNewCase() {
  if (!(state.role === "nurse" || state.role === "admin")) {
    alert("Only nurses/admins can create cases");
    return;
  }
  if (fUrgent.checked && !fDeadline.value) {
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
    urgent: fUrgent.checked,
    ...(fDeadline.value ? { deadlineAt: new Date(fDeadline.value) } : {}),
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
    // attach MQ to newest
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

  // 1) Upload to Drive
  const meta = await uploadFile({ file: state.stagedFile, caseId: state.caseId, batchNo: 1 });

  // 2) Create Firestore uploads doc
  const { db } = await import("/js/firebase.js");
  const { COLLECTIONS } = await import("/js/config.js");
  const { collection, addDoc, serverTimestamp, query, where, getDocs } =
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

  // 3) If PDF: persist page tags from UI selects
  if ((state.stagedFile.type || "").toLowerCase().includes("pdf")) {
    const selects = Array.from(pdfContainer.querySelectorAll(".pdf-page .tag-select"));
    const writes = [];
    for (let i = 0; i < selects.length; i++) {
      const tag = selects[i].value;
      if (tag) {
        writes.push(setPageTag({ caseId: state.caseId, uploadId, pageNumber: i + 1, tag }));
      }
    }
    await Promise.all(writes);
  }

  // 4) Refresh list & clear staging
  const rows = await listUploads(state.caseId);
  renderUploadsList(rows);
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

editDetailsBtn.addEventListener("click", (e) => {
  e.preventDefault();
  if (state.isNew || (state.caseDoc?.status === "finished")) return;
  if (!onlyAssignedNurseCanEdit()) { alert("Only the assigned nurse can edit."); return; }
  state.isEditing = true;
  setDetailsDisabled(false);
  editDetailsBtn.hidden = true;
  saveDetailsBtn.hidden = false;
});

saveDetailsBtn.addEventListener("click", (e) => { e.preventDefault(); saveDetails(); });

document.getElementById("createCaseBtn")?.addEventListener("click", (e) => { e.preventDefault(); createNewCase(); });

finishBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  await finishCase(state.caseId, state.user);
  const c = await getCase(state.caseId);
  state.caseDoc=c; fillDetailsForm(c);
});
undoBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  await undoFinish(state.caseId, state.user);
  const c = await getCase(state.caseId);
  state.caseDoc=c; fillDetailsForm(c);
});

commentForm.addEventListener("submit", (e) => { e.preventDefault(); });
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
