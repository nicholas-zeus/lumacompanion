// /js/case.js
import { initFirebase, onAuth, signOutNow, auth, db } from "/js/firebase.js";
import {
  loadRole, getCase, createCase, updateCase,
  finishCase, undoFinish,
  listComments, addComment,
  getCommentMQ, upsertCommentMQ,
  listUploads, streamFileUrl,
  getTagOptions, getPageTagsForUpload, setPageTag,
  statusLabel,
  uploadFile,
  softDeleteUpload
} from "/js/api.js";
import { computeAge, requireFields, toDate } from "/js/utils.js";

import {
  collection, doc, addDoc, serverTimestamp,
  query, where, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------------- Boot ---------------- */
initFirebase();

/* ---------- DOM ---------- */
const roleBadge     = document.getElementById("roleBadge");
const avatar        = document.getElementById("avatar");
const signOutBtn    = document.getElementById("signOutBtn");
const bannerArea    = document.getElementById("bannerArea");

const tabsNav = document.querySelector(".tabs");
const tabs = {
  details:   document.getElementById("tab-details"),
  manage:    document.getElementById("tab-manage"),      // NEW tab (isolated)
  docview:   document.getElementById("tab-docview"),
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

/* ---------- State ---------- */
const state = {
  caseId: null,
  isNew: false,
  caseDoc: null,
  isEditing: false,
  role: null,
  user: null,

  // View Documents (legacy tab) bookkeeping remains unchanged
  docviewLoaded: false,

  /* ===== Manage Documents (ISOLATED) ===== */
  manage: {
    inited: false,
    // DOM (scoped to #tab-manage only)
    root: null,
    sidebar: null,
    dropzone: null,
    fileInput: null,
    stagedList: null,
    existingList: null,
    renderArea: null,
    saveBtn: null,
    saveFab: null,
    toggleFab: null,
    overlay: null,
    toast: null,
    recoveredNote: null,

    // Data
    tagOptions: [],
    uploads: [],                 // existing uploads from Firestore (non-deleted)
    uploadsById: new Map(),
    // staged: tempId -> { file, kind: 'local', tags: Map(pageNo->tag), type: 'pdf'|'image'|'other', pages?: number }
    staged: new Map(),
    // edits for existing: uploadId -> Map(pageNo->tagOrNull)
    edits: new Map(),
    current: null,               // { kind: 'staged'|'existing', key: tempId|uploadId }
    dirty: false,

    // session recovery key
    sessionKey: null,
  },
};

/* ---------- Utils ---------- */
function getHashId() { const h = (location.hash || "").slice(1); return h || "new"; }
function setActiveTab(name) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
  Object.entries(tabs).forEach(([k, el]) => el && el.classList.toggle("is-active", k === name));
  // Lazy init Manage tab
  if (name === "manage") initManageTab().catch(console.error);
}
function setHeaderUser(user, role) {
  if (!user) return;
  roleBadge.hidden = false;
  roleBadge.textContent = (role || "").toUpperCase();
  signOutBtn.hidden = false;
  avatar.hidden = false;
  avatar.alt = user.displayName || user.email || "User";
}

function toInputDate(d) {
  const dt = toDate(d); if (!dt) return "";
  return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
function toInputDateTimeLocal(d) {
  const dt = toDate(d); if (!dt) return "";
  return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function updateAgeFields() {
  const res = computeAge(fDOB.value, fVisitDate.value);
  fAgeYears.value = res?.years ?? "";
  fAgeMonths.value = res?.months ?? "";
}
function lockUIFinished(isFinished) {
  finishedLock.classList.toggle("hidden", !isFinished);
  detailsForm.querySelectorAll(".input").forEach(i => i.disabled = isFinished || (!state.isNew && !state.isEditing));
  finishBtn.hidden = isFinished || !(state.role === "nurse" || state.role === "admin");
  undoBtn.hidden   = !isFinished || !(state.role === "nurse" || state.role === "admin");
}

/* ---------- Load Case ---------- */
async function loadCase() {
  const id = getHashId();
  state.caseId = id;
  state.isNew = (id === "new");

  if (state.isNew) {
    newCaseActions.classList.remove("hidden");
    setActiveTab("manage"); // new cases go straight to Manage Documents
    return;
  }

  const doc = await getCase(id);
  if (!doc) {
    bannerArea.innerHTML = `<div class="banner">Case not found: <span class="mono">#${id}</span></div>`;
    return;
  }
  state.caseDoc = doc;

  // Fill details UI
  const d = doc.details || {};
  fName.value = d.Name || ""; fMemberID.value = d.MemberID || ""; fNationality.value = d.Nationality || "";
  fDOB.value = toInputDate(d.DOB);
  const age = computeAge(d.DOB, d.VisitDate);
  fAgeYears.value = age?.years ?? "";
  fAgeMonths.value = age?.months ?? "";
  fPolicyEff.value = toInputDate(d.PolicyEffectiveDate);
  fUWType.value = d.UnderwritingType || ""; fAdmissionType.value = d.TypeOfAdmission || "";
  fConsultType.value = d.TypeOfConsultation || ""; fVisitDate.value = toInputDate(d.VisitDate);
  fHospital.value = d.Hospital || ""; fDiagnosis.value = d.Diagnosis || "";
  fDischargeDate.value = toInputDate(d.DischargeDate); fChiefComplaint.value = d.ChiefComplaint || "";
  fPresentIllness.value = d.PresentIllness || ""; fExclusion.value = d.Exclusion || "";
  fVitalSigns.value = d.VitalSigns || ""; fPhysicalFindings.value = d.PhysicalFindings || "";
  fSummary.value = d.Summary || ""; fTreatment.value = d.Treatment || "";
  fReasonAdm.value = d.ReasonForAdmission || ""; fReasonConsult.value = d.ReasonForConsultation || "";
  fOtherRemark.value = d.OtherRemark || "";
  statusText.textContent = statusLabel(doc.status || "—");
  fUrgent.checked = !!doc.urgent;
  fDeadline.value = toInputDateTimeLocal(doc.deadlineAt);

  lockUIFinished(doc.status === "finished");
  downloadPdfBtn.hidden = false;

  // Manage tab preload (existing uploads list)
  if (tabs.manage) {
    // do not fully init here; just prefetch uploads for quick first paint later
    try {
      const items = await listUploads(state.caseId);
      state.manage.uploads = items.filter(r => !r.deletedAt);
      state.manage.uploadsById = new Map(state.manage.uploads.map(u => [u.id, u]));
    } catch(e) { /* ignore */ }
  }
}

/* ---------- Details save/create ---------- */
function collectDetails() {
  return {
    Name: fName.value.trim(), MemberID: fMemberID.value.trim(), Nationality: fNationality.value.trim(),
    DOB: fDOB.value || null, PolicyEffectiveDate: fPolicyEff.value || null, Exclusion: fExclusion.value.trim(),
    UnderwritingType: fUWType.value || "", TypeOfAdmission: fAdmissionType.value || "", TypeOfConsultation: fConsultType.value || "",
    VisitDate: fVisitDate.value || null, Hospital: fHospital.value.trim(), Diagnosis: fDiagnosis.value.trim(),
    ChiefComplaint: fChiefComplaint.value.trim(), PresentIllness: fPresentIllness.value.trim(),
    VitalSigns: fVitalSigns.value.trim(), PhysicalFindings: fPhysicalFindings.value.trim(),
    Summary: fSummary.value.trim(), Treatment: fTreatment.value.trim(),
    ReasonForAdmission: fReasonAdm.value.trim(), ReasonForConsultation: fReasonConsult.value.trim(),
    DischargeDate: fDischargeDate.value || null, OtherRemark: fOtherRemark.value.trim(),
  };
}
async function saveDetails() {
  if (state.isNew) {
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
    location.replace(`/case.html#${created.id}`); location.reload();
    return;
  }

  const details = collectDetails();
  const req = requireFields(details, [
    "Name","MemberID","Nationality","DOB","PolicyEffectiveDate","Exclusion",
    "UnderwritingType","TypeOfAdmission","TypeOfConsultation","VisitDate","Hospital",
    "Diagnosis","ChiefComplaint","PresentIllness","ReasonForAdmission","ReasonForConsultation"
  ]);
  if (!req.ok) { alert(req.msg); return; }

  await updateCase(state.caseId, {
    details,
    urgent: fUrgent.checked,
    ...(fDeadline.value ? { deadlineAt: new Date(fDeadline.value) } : { deadlineAt: null }),
  }, state.user);

  state.isEditing = false;
  detailsForm.querySelectorAll(".input").forEach(i => i.disabled = true);
  editDetailsBtn.hidden = false; saveDetailsBtn.hidden = true;
}

/* ---------- Finish / Undo ---------- */
finishBtn?.addEventListener("click", async () => {
  await finishCase(state.caseId, state.user);
  const updated = await getCase(state.caseId);
  state.caseDoc = updated; lockUIFinished(true);
  statusText.textContent = statusLabel(updated.status);
});
undoBtn?.addEventListener("click", async () => {
  await undoFinish(state.caseId, state.user);
  const updated = await getCase(state.caseId);
  state.caseDoc = updated; lockUIFinished(false);
  statusText.textContent = statusLabel(updated.status);
});

/* ---------- Comments ---------- */
async function renderComments() {
  const commentsList = document.getElementById("commentsList");
  if (!commentsList) return;
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
  const commentBody = document.getElementById("commentBody");
  const commentMQ   = document.getElementById("commentMQ");
  if (!commentBody || !commentMQ) return;

  const body = commentBody.value.trim();
  const mq = commentMQ.value.trim();
  if (!body && !mq) return;
  const id = await addComment(state.caseId, body, state.user);
  if (mq) await upsertCommentMQ({ caseId: state.caseId, commentId: id.id || id, text: mq, currentUser: state.user });
  commentBody.value = "";
  await renderComments();
  if (confirmHandoff) {
    await finishCase(state.caseId, state.user);
    const updated = await getCase(state.caseId);
    state.caseDoc = updated; lockUIFinished(true);
    statusText.textContent = statusLabel(updated.status);
  }
}

/* =======================================================================
   MANAGE DOCUMENTS TAB (ISOLATED TO #tab-manage)
   ======================================================================= */
async function initManageTab() {
  if (!tabs.manage || state.manage.inited) return;
  const M = state.manage;
  M.inited = true;
  M.root = tabs.manage;
  M.sessionKey = `md:${state.caseId}`;

  // Scoped DOM queries inside Manage tab only
  M.sidebar     = M.root.querySelector("#mdSidebar");
  M.dropzone    = M.root.querySelector("#mdDropzone");
  M.fileInput   = M.root.querySelector("#mdFileInput");
  M.stagedList  = M.root.querySelector("#mdStagedList");
  M.existingList= M.root.querySelector("#mdExistingList");
  M.renderArea  = M.root.querySelector("#mdRenderArea");
  M.saveBtn     = M.root.querySelector("#mdSaveBtn");
  M.saveFab     = M.root.querySelector("#mdSaveFab");
  M.toggleFab   = M.root.querySelector("#mdToggleFab");
  M.overlay     = M.root.querySelector("#mdOverlay");
  M.toast       = M.root.querySelector("#mdToast");
  M.recoveredNote = M.root.querySelector("#mdRecovered");

  // Load tag options (scoped)
  M.tagOptions = await getTagOptions();

  // Existing uploads (refresh if needed)
  await refreshExistingList();

  // Session recovery (optional)
  tryRecoverSession();

  // Wire events (ALL scoped)
  wireManageEvents();

  // Initial buttons
  updateSaveVisibility();
  updateMobileCluster();
}

/* ----- Manage: helpers ----- */
function isAssignedNurse() {
  const c = state.caseDoc;
  if (!c || !c.assignedNurse || !state.user) return false;
  return (c.assignedNurse.email || "").toLowerCase() === (state.user.email || "").toLowerCase();
}

function showOverlay(message, withSpinner = false, actions = []) {
  const M = state.manage;
  if (!M.overlay) return;
  M.overlay.innerHTML = `
    <div class="md-ovl-box">
      ${withSpinner ? `<div class="md-spinner" aria-hidden="true"></div>` : ""}
      <div class="md-ovl-msg">${message || ""}</div>
      <div class="md-ovl-actions"></div>
    </div>`;
  const actionsWrap = M.overlay.querySelector(".md-ovl-actions");
  actions.forEach(({ text, className = "btn", onClick }) => {
    const b = document.createElement("button");
    b.className = className;
    b.textContent = text;
    b.addEventListener("click", onClick);
    actionsWrap.appendChild(b);
  });
  M.overlay.classList.add("is-open");
}
function hideOverlay() {
  const M = state.manage;
  if (M.overlay) M.overlay.classList.remove("is-open");
}

function showToast(text) {
  const M = state.manage;
  if (!M.toast) return;
  M.toast.textContent = text;
  M.toast.classList.add("is-on");
  setTimeout(() => M.toast.classList.remove("is-on"), 2500);
}

function updateSaveVisibility() {
  const M = state.manage;
  const needsSave = M.staged.size > 0 || M.edits.size > 0;
  if (M.saveBtn) M.saveBtn.hidden = !needsSave;
  if (M.saveFab) M.saveFab.hidden = !needsSave;
}

function updateMobileCluster() {
  const M = state.manage;
  if (!M.toggleFab) return;
  // The toggleFab is always visible on mobile; visibility is CSS-driven
  // SaveFab visibility is handled in updateSaveVisibility()
}

/* ----- Manage: session recovery ----- */
function tryRecoverSession() {
  const M = state.manage;
  try {
    const raw = sessionStorage.getItem(M.sessionKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    // Restore staged
    (parsed.staged || []).forEach(s => {
      // cannot restore Blob bytes; only metadata; user must re-select if needed
      // We only restore tags/identity if we had a tempId; file will need re-add.
      // To keep UX simple, we skip restoring staged file rows without File object.
    });
    // Restore edits
    if (parsed.edits) {
      M.edits = new Map(parsed.edits.map(([k, arr]) => [k, new Map(arr)]));
    }
    if (M.recoveredNote && (M.edits.size > 0)) {
      M.recoveredNote.hidden = false;
    }
    updateSaveVisibility();
  } catch { /* ignore */ }
}

function persistSession() {
  const M = state.manage;
  try {
    const payload = {
      // staged cannot be serialized (blobs), so store empty or filenames only
      staged: Array.from(M.staged.values()).map(s => ({ name: s.file?.name || "", type: s.type, pages: s.pages || 0 })),
      edits: Array.from(M.edits.entries()).map(([k, v]) => [k, Array.from(v.entries())]),
    };
    sessionStorage.setItem(M.sessionKey, JSON.stringify(payload));
  } catch { /* ignore */ }
}

/* ----- Manage: drag & drop + file staging ----- */
function wireManageEvents() {
  const M = state.manage;
  if (!M.root) return;

  // Entering manage tab should clear recovered banner when user interacts
  if (M.recoveredNote) {
    M.recoveredNote.querySelector("button")?.addEventListener("click", () => {
      M.recoveredNote.hidden = true;
      sessionStorage.removeItem(M.sessionKey);
    });
  }

  // Dropzone
  if (M.dropzone) {
    ["dragenter","dragover"].forEach(evt => M.dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation(); M.dropzone.classList.add("is-hover");
    }));
    ["dragleave","drop"].forEach(evt => M.dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation(); M.dropzone.classList.remove("is-hover");
    }));
    M.dropzone.addEventListener("drop", (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) stageFiles(files);
    });
    M.dropzone.addEventListener("click", () => M.fileInput?.click());
  }
  // File input
  M.fileInput?.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) stageFiles(files);
    M.fileInput.value = "";
  });

  // Sidebar toggle (mobile)
  M.toggleFab?.addEventListener("click", () => {
    M.sidebar?.classList.toggle("is-open");
  });

  // Save buttons (desktop + mobile)
  M.saveBtn?.addEventListener("click", onSaveManage);
  M.saveFab?.addEventListener("click", onSaveManage);
}

function stageFiles(files) {
  const M = state.manage;
  for (const file of files) {
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const lower = (file.name || "").toLowerCase();
    const isPdf = lower.endsWith(".pdf") || file.type === "application/pdf";
    const isImg = /^image\//.test(file.type) || /\.(png|jpg|jpeg)$/i.test(lower);
    M.staged.set(tempId, { file, kind: "local", type: isPdf ? "pdf" : (isImg ? "image" : "other"), tags: new Map(), pages: 0 });
  }
  renderStagedList();
  updateSaveVisibility();
  persistSession();
}

/* ----- Manage: render lists (staged + existing) ----- */
function renderStagedList() {
  const M = state.manage;
  if (!M.stagedList) return;
  M.stagedList.innerHTML = "";
  for (const [id, s] of M.staged.entries()) {
    const row = document.createElement("div");
    row.className = "md-item";
    row.innerHTML = `
      <button class="md-name" data-open="${id}">📄 ${s.file?.name || "staged file"}</button>
      <button class="md-del" data-del="${id}" title="Remove">✕</button>
    `;
    row.querySelector("[data-open]")?.addEventListener("click", () => openStaged(id));
    row.querySelector("[data-del]")?.addEventListener("click", () => confirmDeleteStaged(id));
    M.stagedList.appendChild(row);
  }
}

async function refreshExistingList() {
  const M = state.manage;
  if (!M.existingList) return;
  const rows = await listUploads(state.caseId);
  M.uploads = rows.filter(r => !r.deletedAt);
  M.uploadsById = new Map(M.uploads.map(u => [u.id, u]));
  renderExistingList();
}

function renderExistingList() {
  const M = state.manage;
  if (!M.existingList) return;
  M.existingList.innerHTML = "";
  for (const u of M.uploads) {
    const row = document.createElement("div");
    row.className = "md-item";
    row.innerHTML = `
      <button class="md-name" data-open="${u.id}">📎 ${u.fileName}</button>
      <button class="md-del" data-del="${u.id}" title="Delete">✕</button>
    `;
    row.querySelector("[data-open]")?.addEventListener("click", () => openExisting(u.id));
    row.querySelector("[data-del]")?.addEventListener("click", () => confirmDeleteExisting(u.id));
    M.existingList.appendChild(row);
  }
}

/* ----- Manage: render area (thumbnails + tag dropdowns) ----- */
async function openStaged(tempId) {
  const M = state.manage;
  const s = M.staged.get(tempId);
  if (!s) return;
  M.current = { kind: "staged", key: tempId };
  await renderFileIntoArea({ type: s.type, source: s.file, tagMap: s.tags, isLocal: true, onTagChange: (pg, val) => {
    s.tags.set(pg, val || "");
    M.dirty = true; updateSaveVisibility(); persistSession();
  }});
}

async function openExisting(uploadId) {
  const M = state.manage;
  const info = M.uploadsById.get(uploadId);
  if (!info) return;
  M.current = { kind: "existing", key: uploadId };

  // Existing map: start with server tags (for display), then overlay local edits (if present)
  const serverMap = await getPageTagsForUpload(state.caseId, uploadId, 2000);
  let local = M.edits.get(uploadId);
  if (!local) { local = new Map(); M.edits.set(uploadId, local); }

  // Build a view map: prefer local override when present (including null to clear)
  const viewMap = new Map(serverMap);
  for (const [pg, tag] of local.entries()) viewMap.set(pg, tag || "");

  const type = isPdfName(info.fileName, info.mimeType) ? "pdf" :
               isImageName(info.fileName, info.mimeType) ? "image" : "other";

  await renderFileIntoArea({
    type,
    source: streamFileUrl(info.driveFileId),
    tagMap: viewMap,
    isLocal: false,
    onTagChange: (pg, val) => {
      local.set(pg, val || "");
      M.dirty = true; updateSaveVisibility(); persistSession();
    }
  });
}

function isPdfName(name = "", mime = "") {
  const n = (name || "").toLowerCase();
  const t = (mime || "").toLowerCase();
  return n.endsWith(".pdf") || t === "application/pdf";
}
function isImageName(name = "", mime = "") {
  const n = (name || "").toLowerCase();
  const t = (mime || "").toLowerCase();
  return /\.(png|jpg|jpeg)$/i.test(n) || t.startsWith("image/");
}

async function ensurePdfJs() {
  if (window.pdfjsLib?.getDocument) return;
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function renderFileIntoArea({ type, source, tagMap, isLocal, onTagChange }) {
  const M = state.manage;
  if (!M.renderArea) return;
  M.renderArea.innerHTML = "";

  // Grid: desktop up to 3 per row (via CSS), mobile 1 per row
  const grid = document.createElement("div");
  grid.className = "md-grid";
  M.renderArea.appendChild(grid);

  if (type === "pdf") {
    await ensurePdfJs();
    let pdf;
    try {
      const src = isLocal ? URL.createObjectURL(source) : source;
      pdf = await window.pdfjsLib.getDocument(src).promise;
    } catch (e) {
      grid.innerHTML = `<div class="muted">Failed to load PDF.</div>`;
      return;
    }
    const DPR = Math.max(1, window.devicePixelRatio || 1);
    const SCALE = 0.35 * DPR; // small thumbnails
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: SCALE });

      const card = document.createElement("div");
      card.className = "md-thumb";

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;

      const footer = document.createElement("div");
      footer.className = "md-thumb-foot";
      footer.innerHTML = `<span class="md-pg">Pg ${p}</span>`;

      const sel = buildTagSelect(tagMap.get(p) || "", (val) => onTagChange(p, val));
      footer.appendChild(sel);

      card.appendChild(canvas);
      card.appendChild(footer);
      grid.appendChild(card);
    }
  } else if (type === "image") {
    const card = document.createElement("div");
    card.className = "md-thumb";
    const img = document.createElement("img");
    img.alt = "image";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = isLocal ? URL.createObjectURL(source) : source;
    img.style = "width:100%;height:auto;display:block;";
    const footer = document.createElement("div");
    footer.className = "md-thumb-foot";
    footer.innerHTML = `<span class="md-pg">Image</span>`;
    const sel = buildTagSelect(tagMap.get(1) || "", (val) => onTagChange(1, val));
    footer.appendChild(sel);
    card.appendChild(img);
    card.appendChild(footer);
    grid.appendChild(card);
  } else {
    grid.innerHTML = `<div class="muted">Preview not available. You can still upload and add tags later.</div>`;
  }
}

function buildTagSelect(current, onChange) {
  const M = state.manage;
  const sel = document.createElement("select");
  sel.className = "md-tag";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "— tag —";
  sel.appendChild(empty);
  M.tagOptions.forEach(t => {
    const o = document.createElement("option");
    o.value = t; o.textContent = t; sel.appendChild(o);
  });
  sel.value = current || "";
  sel.addEventListener("change", () => onChange(sel.value || ""));
  return sel;
}

/* ----- Manage: deletes with confirmation overlay (scoped) ----- */
function confirmDeleteStaged(tempId) {
  const M = state.manage;
  showOverlay(`Remove staged file?`, false, [
    { text: "Cancel", className: "btn", onClick: () => hideOverlay() },
    { text: "Remove", className: "btn btn-primary", onClick: () => {
        M.staged.delete(tempId);
        hideOverlay();
        renderStagedList();
        if (M.current?.kind === "staged" && M.current.key === tempId) {
          M.renderArea.innerHTML = "";
          M.current = null;
        }
        updateSaveVisibility(); persistSession();
      } }
  ]);
}
function confirmDeleteExisting(uploadId) {
  showOverlay(`Delete this file from case? (Soft delete)`, false, [
    { text: "Cancel", className: "btn", onClick: () => hideOverlay() },
    { text: "Delete", className: "btn btn-primary", onClick: async () => {
        try {
          await softDeleteUpload(uploadId);
          hideOverlay();
          await refreshExistingList();
          const M = state.manage;
          if (M.current?.kind === "existing" && M.current.key === uploadId) {
            M.renderArea.innerHTML = "";
            M.current = null;
          }
          showToast("Deleted.");
        } catch(e) {
          hideOverlay(); showToast("Delete failed.");
        }
      } }
  ]);
}

/* ----- Manage: Save flow ----- */
async function onSaveManage() {
  const M = state.manage;

  // Assignment enforcement
  if (!isAssignedNurse()) {
    showOverlay(
      "This case is not assigned to you.",
      false,
      [
        { text: "Close", className: "btn", onClick: () => hideOverlay() },
        { text: "Assign to me", className: "btn btn-primary", onClick: async () => {
            try {
              await updateCase(state.caseId, {
                assignedNurse: { email: state.user.email, displayName: state.user.displayName || state.user.email, at: new Date() }
              }, state.user);
              state.caseDoc = await getCase(state.caseId);
              hideOverlay();
              showToast("Assigned. You can save now.");
            } catch {
              showToast("Failed to assign.");
            }
          } }
      ]
    );
    return;
  }

  // Block UI
  showOverlay("Saving changes…", true);

  try {
    // 1) Upload staged files → Drive + Firestore uploads doc
    const createdUploads = [];
    for (const [tempId, s] of M.staged.entries()) {
      const meta = await uploadFile({ caseId: state.caseId, batchNo: 1, file: s.file });
      // Firestore uploads doc
      const ref = await addDoc(collection(db, "uploads"), {
        caseId: state.caseId,
        batchNo: 1,
        fileName: meta.fileName,
        fileType: meta.mimeType,
        size: meta.size,
        driveFileId: meta.fileId,
        fileHash: meta.md5 || null,
        uploadedBy: {
          email: (auth.currentUser?.email || ""),
          displayName: (auth.currentUser?.displayName || "")
        },
        uploadedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      createdUploads.push({ uploadId: ref.id, staged: s });
    }

    // 2) Persist tags for newly uploaded (staged)
    for (const u of createdUploads) {
      for (const [pg, tag] of u.staged.tags.entries()) {
        if (!tag) continue;
        await setPageTag({ caseId: state.caseId, uploadId: u.uploadId, pageNumber: Number(pg), tag });
      }
    }

    // 3) Persist edits for existing files
    for (const [uploadId, map] of M.edits.entries()) {
      for (const [pg, tag] of map.entries()) {
        // tag may be empty string to clear
        await setPageTag({ caseId: state.caseId, uploadId, pageNumber: Number(pg), tag: tag || null });
      }
    }

    // 4) Refresh existing list, clear staged + edits
    await refreshExistingList();
    M.staged.clear();
    M.edits.clear();
    M.current = null;
    M.renderArea.innerHTML = "";
    sessionStorage.removeItem(M.sessionKey);

    hideOverlay();
    showToast("Saved.");
    updateSaveVisibility();
  } catch (e) {
    console.error(e);
    hideOverlay();
    showOverlay("Failed to save changes. Please try again.", false, [
      { text: "Close", className: "btn btn-primary", onClick: () => hideOverlay() }
    ]);
  }
}

/* =======================================================================
   Legacy: tab switching + minimal wiring (UNCHANGED for other tabs)
   ======================================================================= */
document.getElementById("fDOB")?.addEventListener("change", updateAgeFields);
document.getElementById("fVisitDate")?.addEventListener("change", updateAgeFields);
signOutBtn.addEventListener("click", () => signOutNow());

editDetailsBtn.addEventListener("click", (e) => {
  e.preventDefault();
  state.isEditing = true;
  detailsForm.querySelectorAll(".input").forEach(i => i.disabled = false);
  editDetailsBtn.hidden = true; saveDetailsBtn.hidden = false;
});
saveDetailsBtn.addEventListener("click", async (e) => { e.preventDefault(); await saveDetails(); });

assignNurseBtn?.addEventListener("click", async () => {
  await updateCase(state.caseId, {
    assignedNurse: { email: state.user.email, displayName: state.user.displayName || state.user.email, at: new Date() }
  }, state.user);
});
assignDoctorBtn?.addEventListener("click", async () => {
  await updateCase(state.caseId, {
    assignedDoctor: { email: state.user.email, displayName: state.user.displayName || state.user.email, at: new Date() }
  }, state.user);
});

downloadPdfBtn?.addEventListener("click", async () => {
  alert("Transcript export coming soon.");
});

tabsNav?.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  setActiveTab(btn.dataset.tab);
});

document.getElementById("saveCommentBtn")?.addEventListener("click", (e) => { e.preventDefault(); postComment(false); });
document.getElementById("confirmBtn")?.addEventListener("click", (e) => { e.preventDefault(); postComment(true); });

/* ---------- Auth ---------- */
onAuth(async (user) => {
  if (!user) { location.href = "/index.html"; return; }
  state.user = user;
  state.role = await loadRole();
  setHeaderUser(user, state.role);
  await loadCase();
  if (state.isNew) updateAgeFields();

  // If page hash points to manage, ensure tab active
  const hashTab = (document.querySelector(`.tab.is-active`)?.dataset.tab) || "details";
  if (hashTab === "manage") initManageTab().catch(console.error);
});