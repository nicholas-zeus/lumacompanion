import { initFirebase, onAuth, signOutNow, auth } from "/js/firebase.js";
import {
  loadRole, getCase, createCase, updateCase,
  finishCase, undoFinish,
  listComments, addComment,
  getCommentMQ, upsertCommentMQ,
  listUploads, streamFileUrl,
  getTagOptions
} from "/js/api.js";
import { formatDeadline, statusLabel, computeAge, requireFields, toDate } from "/js/utils.js";
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

/* Detail fields */
const f = (id) => document.getElementById(id);
const fName            = f("fName");
const fMemberID        = f("fMemberID");
const fNationality     = f("fNationality");
const fDOB             = f("fDOB");
const fAgeYears        = f("fAgeYears");
const fAgeMonths       = f("fAgeMonths");
const fPolicyEff       = f("fPolicyEff");
const fUWType          = f("fUWType");
const fAdmissionType   = f("fAdmissionType");
const fConsultType     = f("fConsultType");
const fVisitDate       = f("fVisitDate");
const fHospital        = f("fHospital");
const fDiagnosis       = f("fDiagnosis");
const fDischargeDate   = f("fDischargeDate");
const fChiefComplaint  = f("fChiefComplaint");
const fPresentIllness  = f("fPresentIllness");
const fExclusion       = f("fExclusion");
const fUrgent          = f("fUrgent");
const fDeadline        = f("fDeadline");
const fVitalSigns      = f("fVitalSigns");
const fPhysicalFindings= f("fPhysicalFindings");
const fSummary         = f("fSummary");
const fTreatment       = f("fTreatment");
const fReasonAdm       = f("fReasonAdm");
const fReasonConsult   = f("fReasonConsult");
const fOtherRemark     = f("fOtherRemark");

/* Documents */
const fileInput    = document.getElementById("fileInput");
const uploadsList  = document.getElementById("uploadsList");
const pdfContainer = document.getElementById("pdfContainer");
const tagFilterSel = document.getElementById("tagFilter");

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
  const canEdit = state.isNew ? (state.role === "nurse" || state.role === "admin") : (onlyAssignedNurseCanEdit() && state.caseDoc.status !== "finished");
  detailsForm.querySelectorAll(".input").forEach(i => i.disabled = !canEdit);
  saveDetailsBtn.disabled = !canEdit;
}

/* Age auto-calc based on DOB + VisitDate (fallback: today) */
function updateAgeFields() {
  const refDate = fVisitDate.value ? new Date(fVisitDate.value) : new Date();
  const { years, months } = computeAge(fDOB.value, refDate);
  fAgeYears.value = years;
  fAgeMonths.value = months;
}

/* Urgent validation */
function validateUrgentDeadline() {
  if (fUrgent.checked && !fDeadline.value) {
    alert("Deadline is required when Urgent is checked.");
    return false;
  }
  return true;
}

/* Build the details payload from form */
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
  fDOB.value             = d.DOB ? new Date(d.DOB.seconds ? d.DOB.seconds * 1000 : d.DOB).toISOString().slice(0,10) : "";
  fAgeYears.value        = d.AgeYears ?? "";
  fAgeMonths.value       = d.AgeMonths ?? "";
  fPolicyEff.value       = d.PolicyEffectiveDate ? new Date(d.PolicyEffectiveDate.seconds ? d.PolicyEffectiveDate.seconds * 1000 : d.PolicyEffectiveDate).toISOString().slice(0,10) : "";
  fExclusion.value       = d.Exclusion || "";
  fUWType.value          = d.UnderwritingType || "";
  fAdmissionType.value   = d.TypeOfAdmission || "";
  fConsultType.value     = d.TypeOfConsultation || "";
  fVisitDate.value       = d.VisitDate ? new Date(d.VisitDate.seconds ? d.VisitDate.seconds * 1000 : d.VisitDate).toISOString().slice(0,10) : "";
  fHospital.value        = d.Hospital || "";
  fDiagnosis.value       = d.Diagnosis || "";
  fDischargeDate.value   = d.DischargeDate ? new Date(d.DischargeDate.seconds ? d.DischargeDate.seconds * 1000 : d.DischargeDate).toISOString().slice(0,10) : "";
  fChiefComplaint.value  = d.ChiefComplaint || "";
  fPresentIllness.value  = d.PresentIllness || "";
  fVitalSigns.value      = d.VitalSigns || "";
  fPhysicalFindings.value= d.PhysicalFindings || "";
  fSummary.value         = d.Summary || "";
  fTreatment.value       = d.Treatment || "";
  fReasonAdm.value       = d.ReasonForAdmission || "";
  fReasonConsult.value   = d.ReasonForConsultation || "";
  fOtherRemark.value     = d.OtherRemark || "";

  // urgent + deadline
  fUrgent.checked = !!doc.urgent;
  if (doc.deadlineAt) {
    const dd = new Date(doc.deadlineAt.seconds ? doc.deadlineAt.seconds * 1000 : doc.deadlineAt);
    const iso = new Date(dd.getTime() - dd.getTimezoneOffset()*60000).toISOString().slice(0,16);
    fDeadline.value = iso;
  } else {
    fDeadline.value = "";
  }

  assignNurseBtn.hidden  = !(state.role === "nurse");
  assignDoctorBtn.hidden = !((state.role === "doctor") || (state.role === "admin"));

  lockUIFinished(doc.status === "finished");
  setDetailsEditable();
  downloadPdfBtn.hidden = false;
}

/* Comments render (unchanged, MQ inline) */
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
    card.appendChild(head);

    const body = document.createElement("p");
    body.textContent = c.body || "";
    card.appendChild(body);

    const mqBlock = document.createElement("div");
    mqBlock.className = "mq";
    mqBlock.textContent = "Loading MQ…";
    card.appendChild(mqBlock);

    const mq = await getCommentMQ(c.id);
    mqBlock.textContent = mq?.text ? mq.text : "(No MQ)";

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

  if (state.isNew) {
    statusText.textContent = statusLabel("awaiting doctor");
    newCaseActions.classList.remove("hidden");
    lockUIFinished(false);
    setDetailsEditable();
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

  const uploads = await listUploads(id);
  renderUploadsList(uploads);

  const tags = await getTagOptions();
  tagFilterSel.innerHTML = `<option value="">All</option>` + tags.map(t => `<option>${t}</option>`).join("");
}

async function saveDetails() {
  // NEW: on "new" screen, Save = Create
  if (state.isNew) {
    await createNewCase();
    return;
  }
  if (!onlyAssignedNurseCanEdit()) return;

  if (!validateUrgentDeadline()) return;

  const details = collectDetails();
  const req = requireFields(details, [
    "Name","MemberID","Nationality","DOB","PolicyEffectiveDate","Exclusion",
    "UnderwritingType","TypeOfAdmission","TypeOfConsultation","VisitDate","Hospital",
    "Diagnosis","ChiefComplaint","PresentIllness","ReasonForAdmission","ReasonForConsultation"
  ]);
  if (!req.ok) { alert(req.msg); return; }

  const partial = {
    details,
    urgent: fUrgent.checked || undefined
  };
  if (fDeadline.value) partial.deadlineAt = new Date(fDeadline.value);

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
  if (!validateUrgentDeadline()) return;

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
  await renderComments();
}

/** Post comment; if handoff=true, flip status doctor<->nurse */
async function postComment(handoff) {
  const body = commentBody.value.trim();
  const mq   = commentMQ.value.trim();
  if (!body) return;

  await addComment(state.caseId, body, state.user);

  if (handoff) {
    if (state.role === "doctor") {
      await updateCase(state.caseId, { status: "awaiting nurse" }, state.user);
    } else if (state.role === "nurse") {
      await updateCase(state.caseId, { status: "awaiting doctor" }, state.user);
    }
  }

  // Attach MQ to newest comment if provided
  const items = await listComments(state.caseId);
  const last = items[items.length - 1];
  if (last && mq) {
    await upsertCommentMQ({ caseId: state.caseId, commentId: last.id, text: mq, currentUser: state.user });
  }

  commentBody.value = "";
  commentMQ.value = "";
  await refreshComments();

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

/* Tag filter */
function applyTagFilter() {
  const val = tagFilterSel.value || "";
  if (!pdfContainer || !pdfContainer.querySelectorAll) return;
  pdfContainer.querySelectorAll(".pdf-page").forEach(pg => {
    const sel = pg.querySelector(".tag-select");
    const t = sel?.value || "";
    pg.style.display = (!val || val === t) ? "" : "none";
  });
}

/* Transcript */
async function downloadTranscript() {
  const caseDoc   = state.caseDoc || await getCase(state.caseId);
  const items  = await listComments(state.caseId);
  const mqMap = new Map();
  for (const c of items) {
    const mq = await getCommentMQ(c.id);
    if (mq) mqMap.set(c.id, mq);
  }
  const blob = await buildTranscriptPDF({ caseDoc: { id: state.caseId, ...caseDoc }, comments: items, mqMap });
  downloadBlob(blob, `Case-${state.caseId}.pdf`);
}

/* ---------- Events ---------- */
tabsNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  setActiveTab(btn.dataset.tab);
});
[fDOB, fVisitDate].forEach(el => el.addEventListener("change", updateAgeFields));

signOutBtn.addEventListener("click", () => signOutNow());
saveDetailsBtn.addEventListener("click", (e) => { e.preventDefault(); saveDetails(); });
createCaseBtn.addEventListener("click", (e) => { e.preventDefault(); createNewCase(); });
assignNurseBtn.addEventListener("click", (e) => { e.preventDefault(); assignSelf("nurse"); });
assignDoctorBtn.addEventListener("click", (e) => { e.preventDefault(); assignSelf("doctor"); });
finishBtn.addEventListener("click", (e) => { e.preventDefault(); markFinished(); });
undoBtn.addEventListener("click", (e) => { e.preventDefault(); undoFinishedAction(); });
tagFilterSel.addEventListener("change", applyTagFilter);

saveCommentBtn.addEventListener("click", (e) => { e.preventDefault(); postComment(false); });
confirmBtn.addEventListener("click", (e) => { e.preventDefault(); postComment(true); });

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
  await loadCase();
  if (!state.isNew) initDocsUploader();

  // initial age calc on new
  if (state.isNew) updateAgeFields();
});
