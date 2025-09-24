// /js/case.js
// Case page logic: Details, Manage Documents (new, isolated), View Documents (restored), Comments

import { initFirebase, onAuth, signOutNow, auth, db } from "/js/firebase.js";
import {
  loadRole, getCase, createCase, updateCase,
  finishCase, undoFinish,
  listComments, addComment,
  listUploads, streamFileUrl,
  getTagOptions, statusLabel,
  setPageTag, uploadFile, softDeleteUpload
} from "/js/api.js";
import { computeAge, requireFields, toDate } from "/js/utils.js";

import {
  collection, query, where, orderBy, limit, getDocs, addDoc, serverTimestamp, doc, setDoc
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
  manage:    document.getElementById("tab-manage"),
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

/* -------- Manage Documents (new tab; isolated) -------- */
const mdSidebar       = document.getElementById("mdSidebar");
const mdDropzone      = document.getElementById("mdDropzone");
const mdFileInput     = document.getElementById("mdFileInput");
const mdPickBtn       = document.getElementById("mdPickBtn");
const mdStagedList    = document.getElementById("mdStagedList");
const mdExistingList  = document.getElementById("mdExistingList");
const mdExistingCount = document.getElementById("mdExistingCount");
const mdSaveBtn       = document.getElementById("mdSaveBtn");
const mdRender        = document.getElementById("mdRender");
const mdPanelToggle   = document.getElementById("mdPanelToggle");
const mdSaveFab       = document.getElementById("mdSaveFab");
const mdSaveOverlay   = document.getElementById("mdSaveOverlay");
const mdSaveProgress  = document.getElementById("mdSaveProgress");

/* -------- View Documents (RESTORED) -------- */
const docList         = document.getElementById("docList");
const pdfStack        = document.getElementById("pdfStack");
const tagHitsWrap     = document.getElementById("tagHits");
const tagFilterSelect = document.getElementById("tagFilterSelect");
const docviewActions  = document.getElementById("docviewActions");

/* -------- Comments -------- */
const commentsList   = document.getElementById("commentsList");
const commentForm    = document.getElementById("commentForm");
const commentBody    = document.getElementById("commentBody");
const commentMQ      = document.getElementById("commentMQ");
const saveCommentBtn = document.getElementById("saveCommentBtn");
const confirmBtn     = document.getElementById("confirmBtn");

/* ---------- State ---------- */
const state = {
  caseId: null,
  isNew: false,
  caseDoc: null,
  isEditing: false,
  role: null,
  user: null,

  /* View Documents (restored) */
  docviewLoaded: false,
  uploadsIndex: [],
  uploadsById: new Map(),
  allTags: new Set(),
  tagHits: [],                // [{uploadId,pageNumber,tag}]
  pageIndex: new Map(),       // `${uploadId}:${page}` -> element
  currentFilter: "",

  /* Manage Documents (isolated) */
  md: {
    initialized: false,
    existing: [],
    staged: [],
    pendingDeletes: new Set(),
    tagState: new Map(),
    dirtySet: new Set(),
    renderedKey: null,
    dprClamp: 1.25,
  }
};

/* ---------- Util ---------- */
function getHashId() { const h = (location.hash || "").slice(1); return h || "new"; }
function setActiveTab(name) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
  Object.entries(tabs).forEach(([k, el]) => el.classList.toggle("is-active", k === name));
  if (name === "docview") ensureDocviewLoaded().catch(console.error);
  if (name === "manage") ensureManageLoaded().catch(console.error);
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
  const { years, months } = computeAge(fDOB.value, fVisitDate.value || new Date());
  fAgeYears.value = years ?? "";
  fAgeMonths.value = months ?? "";
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
    setActiveTab("details");
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
  fDOB.value = toInputDate(d.DOB); const ageNow = computeAge(d.DOB, d.VisitDate || new Date());
  fAgeYears.value = ageNow.years ?? ""; fAgeMonths.value = ageNow.months ?? "";
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

  // Preload uploads for both tabs
  await refreshUploadsForAll();
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
  commentsList.innerHTML = "";
  const items = await listComments(state.caseId);
  for (const c of items) {
    const el = document.createElement("div");
    el.className = "comment";
    const when = c.createdAt ? toDate(c.createdAt)?.toLocaleString() : "";
    el.innerHTML = `
      <div><span class="who">${c.author?.displayName || c.author?.email || "—"}</span>
      <span class="when"> • ${when || ""}</span></div>
      <div class="body">${(c.body || "").replace(/\n/g, "<br>")}</div>
    `;
    commentsList.appendChild(el);
  }
}
async function postComment(confirmHandoff) {
  const body = commentBody.value.trim();
  const mq = (document.getElementById("commentMQ")?.value || "").trim();
  if (!body && !mq) return;
  await addComment(state.caseId, body, state.user);
  commentBody.value = "";
  await renderComments();
  if (confirmHandoff) {
    await finishCase(state.caseId, state.user);
    const updated = await getCase(state.caseId);
    state.caseDoc = updated; lockUIFinished(true);
    statusText.textContent = statusLabel(updated.status);
  }
}

/* =========================================================
   VIEW DOCUMENTS TAB (RESTORED)
   ========================================================= */
async function ensureDocviewLoaded() {
  if (!state.caseId || state.isNew) return;
  if (state.docviewLoaded) return;
  await loadPdfJsIfNeeded();
  await loadDocviewData();
  wireDocviewControls();
  await renderCanvasStack();
  state.docviewLoaded = true;
}
function wireDocviewControls() {
  tagFilterSelect?.addEventListener("change", () => {
    state.currentFilter = tagFilterSelect.value || "";
    applyDocTagFilter(state.currentFilter);
  });
}
async function loadDocviewData() {
  const rows = await listUploads(state.caseId);
  state.uploadsIndex = rows;
  state.uploadsById.clear();
  rows.forEach(r => state.uploadsById.set(r.id, r));

  // Load page tags
  state.allTags.clear(); state.tagHits = [];
  const col = collection(db, "pageTags");
  const qRef = query(col, where("caseId", "==", state.caseId), limit(5000));
  const snap = await getDocs(qRef);
  snap.forEach(d => {
    const row = d.data();
    if (row?.tag) {
      state.allTags.add(row.tag);
      state.tagHits.push({ uploadId: row.uploadId, pageNumber: row.pageNumber, tag: row.tag });
    }
  });

  // Populate filter dropdown
  if (tagFilterSelect) {
    const cur = state.currentFilter || "";
    tagFilterSelect.innerHTML = `<option value="">All tags</option>` +
      Array.from(state.allTags).sort().map(t => `<option value="${t}">${t}</option>`).join("");
    if (cur && state.allTags.has(cur)) tagFilterSelect.value = cur;
  }

  renderFileList();
}
function renderFileList() {
  if (!docList) return;
  docList.innerHTML = "";
  for (const u of state.uploadsIndex) {
    const who = u.uploadedBy?.displayName || u.uploadedBy?.email || "Unknown";
    const when = (u.uploadedAt?.seconds) ? new Date(u.uploadedAt.seconds * 1000).toLocaleString() : "";
    const div = document.createElement("div");
    div.className = "doc-list-item";
    const fileUrl = streamFileUrl(u.driveFileId);

    div.innerHTML = `
      <div class="doc-file">${u.fileName}</div>
      <div class="doc-sub">${who} • ${when}</div>
      <div class="doc-sub">Batch: ${u.batchNo || "-"}</div>
      <div class="doc-actions">
        <a href="#" data-open="${u.id}">Open</a>
        &nbsp;·&nbsp;
        <a href="${fileUrl}" target="_blank" rel="noopener">Download</a>
      </div>
    `;
    div.querySelectorAll("[data-open]").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        focusFirstPageOf(u.id);
      });
    });
    docList.appendChild(div);
  }
}
function isPdf(u) {
  const n = (u.fileName || "").toLowerCase();
  const t = (u.mimeType || u.fileType || "").toLowerCase();
  return n.endsWith(".pdf") || t === "application/pdf";
}
function isImage(u) {
  const n = (u.fileName || "").toLowerCase();
  const t = (u.mimeType || u.fileType || "").toLowerCase();
  return /(\.jpg|\.jpeg|\.png)$/.test(n) || t.startsWith("image/");
}
async function renderCanvasStack() {
  if (!pdfStack || !tagHitsWrap) return;
  pdfStack.hidden = false; tagHitsWrap.hidden = true;
  pdfStack.innerHTML = "";
  state.pageIndex.clear();

  for (const u of state.uploadsIndex) {
    if (isPdf(u)) {
      await renderPdfFileAsCanvases(u);
    } else if (isImage(u)) {
      renderImageFile(u);
    } else {
      const card = document.createElement("div");
      card.className = "pdf-block";
      card.innerHTML = `<div class="muted">${u.fileName} — preview not available</div>`;
      pdfStack.appendChild(card);
    }
  }
  if (!pdfStack.children.length) {
    pdfStack.innerHTML = `<div class="muted">No files uploaded yet.</div>`;
  }
}
async function renderPdfFileAsCanvases(u) {
  const section = document.createElement("div");
  section.className = "pdf-block";
  const pagesWrap = document.createElement("div");
  section.appendChild(pagesWrap);
  pdfStack.appendChild(section);

  const url = streamFileUrl(u.driveFileId);
  let pdf;
  try {
    pdf = await window.pdfjsLib.getDocument(url).promise;
  } catch {
    pagesWrap.innerHTML = `<div class="muted">Failed to load PDF.</div>`;
    return;
  }
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const containerWidthCss = Math.min(pagesWrap.clientWidth || 900, 900);
    const baseViewport = page.getViewport({ scale: 1 });
    const cssScale = containerWidthCss / baseViewport.width;
    const DPR = Math.max(1, window.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale: cssScale * Math.min(DPR, 1.25) });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.ceil(viewport.width / Math.min(DPR, 1.25))}px`;
    canvas.style.height = `${Math.ceil(viewport.height / Math.min(DPR, 1.25))}px`;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const pageCard = document.createElement("div");
    pageCard.className = "page-card";
    pageCard.appendChild(canvas);
    pagesWrap.appendChild(pageCard);

    state.pageIndex.set(`${u.id}:${p}`, pageCard);
  }
}
function renderImageFile(u) {
  const section = document.createElement("div");
  section.className = "pdf-block";

  const img = document.createElement("img");
  img.src = streamFileUrl(u.driveFileId);
  img.alt = u.fileName;
  img.loading = "lazy";
  img.decoding = "async";

  const pageCard = document.createElement("div");
  pageCard.className = "page-card";
  pageCard.appendChild(img);

  section.appendChild(pageCard);
  pdfStack.appendChild(section);

  state.pageIndex.set(`${u.id}:1`, section);
}
function focusFirstPageOf(uploadId) {
  const el = state.pageIndex.get(`${uploadId}:1`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Tag filter: show hits grid with small preview tiles, click scrolls to page */
function applyDocTagFilter(tag) {
  if (!tag) {
    tagHitsWrap.hidden = true; pdfStack.hidden = false;
    docviewActions.textContent = "";
    return;
  }
  // Build list of hits for selected tag
  const hits = state.tagHits.filter(h => h.tag === tag);
  tagHitsWrap.innerHTML = "";
  if (!hits.length) {
    tagHitsWrap.innerHTML = `<div class="muted">No pages tagged “${tag}”.</div>`;
  } else {
    for (const h of hits) {
      const file = state.uploadsById.get(h.uploadId);
      const div = document.createElement("div");
      div.className = "tag-hit";
      const label = document.createElement("div");
      label.textContent = file?.fileName || h.uploadId;
      const meta = document.createElement("div");
      meta.className = "hit-meta";
      meta.innerHTML = `<span>Page ${h.pageNumber}</span><a href="#" data-jump="${h.uploadId}:${h.pageNumber}">Open</a>`;
      div.appendChild(label);
      div.appendChild(meta);
      tagHitsWrap.appendChild(div);
    }
  }
  // Wire jumps
  tagHitsWrap.querySelectorAll("[data-jump]").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const [uploadId, pageStr] = a.getAttribute("data-jump").split(":");
      // ensure full stack is visible then scroll
      pdfStack.hidden = false; tagHitsWrap.hidden = true;
      const el = state.pageIndex.get(`${uploadId}:${pageStr}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      // reset filter UI back to 'All'
      if (tagFilterSelect) tagFilterSelect.value = "";
      state.currentFilter = "";
      docviewActions.textContent = "";
    });
  });

  // Switch view to tag hits
  docviewActions.textContent = `Showing ${hits.length} page(s) tagged “${tag}”`;
  pdfStack.hidden = true; tagHitsWrap.hidden = false;
}

/* =========================================================
   MANAGE DOCUMENTS TAB (new; isolated)
   ========================================================= */
async function ensureManageLoaded() {
  if (!state.caseId || state.isNew) return;
  if (state.md.initialized) return;
  await loadPdfJsIfNeeded();
  await mdPrecacheExisting();
  mdWireUI();
  mdRenderExistingList();
  mdUpdateSaveButtons();
  state.md.initialized = true;
}

/* Pre-cache existing uploads + their tags into tagState */
async function mdPrecacheExisting() {
  const rows = await listUploads(state.caseId);
  state.md.existing = rows;
  if (mdExistingCount) mdExistingCount.textContent = rows.length ? `(${rows.length})` : "";
  // load tags
  const col = collection(db, "pageTags");
  const snap = await getDocs(query(col, where("caseId", "==", state.caseId), limit(5000)));
  snap.forEach(d => {
    const row = d.data();
    if (row?.uploadId && row?.pageNumber) {
      const key = `${row.uploadId}:${row.pageNumber}`;
      state.md.tagState.set(key, row.tag || "");
    }
  });
  // restore staging (session)
  try {
    const saved = JSON.parse(sessionStorage.getItem(`md:${state.caseId}`) || "{}");
    if (Array.isArray(saved.staged)) state.md.staged = []; // cannot restore File objects
    if (saved.tagState) {
      for (const [k,v] of Object.entries(saved.tagState)) state.md.tagState.set(k, v);
    }
  } catch {}
}

/* Save session state (staged filenames + tagState only) */
function mdPersistSession() {
  const tagStateObj = {};
  state.md.tagState.forEach((v,k)=> tagStateObj[k]=v);
  const payload = { staged: state.md.staged.map(s => ({ name:s.name, type:s.type, size:s.size })), tagState: tagStateObj };
  try { sessionStorage.setItem(`md:${state.caseId}`, JSON.stringify(payload)); } catch {}
}

/* Wire UI interactions */
function mdWireUI() {
  // Dropzone
  mdPickBtn?.addEventListener("click", () => mdFileInput?.click());
  mdDropzone?.addEventListener("click", (e) => {
    if (e.target !== mdPickBtn) mdFileInput?.click();
  });
  mdDropzone?.addEventListener("dragover", (e) => { e.preventDefault(); mdDropzone.classList.add("highlight"); });
  mdDropzone?.addEventListener("dragleave", () => mdDropzone.classList.remove("highlight"));
  mdDropzone?.addEventListener("drop", (e) => {
    e.preventDefault(); mdDropzone.classList.remove("highlight");
    const files = Array.from(e.dataTransfer.files || []);
    mdStageFiles(files);
  });
  mdFileInput?.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    mdStageFiles(files);
    mdFileInput.value = "";
  });

  // Sidebar lists click
  mdStagedList?.addEventListener("click", (e) => {
    const el = e.target.closest("[data-tempid]");
    const x  = e.target.closest("[data-remove-tempid]");
    if (x) {
      const id = x.getAttribute("data-remove-tempid");
      mdRemoveStaged(id);
      return;
    }
    if (el) {
      const tempId = el.getAttribute("data-tempid");
      const item = state.md.staged.find(s => s.tempId === tempId);
      if (item) mdRenderFile({ kind: "staged", keyPrefix: tempId, file: item.file, name: item.name, type: item.type });
    }
  });

  mdExistingList?.addEventListener("click", (e) => {
    const del = e.target.closest("[data-delete-id]");
    if (del) {
      const uploadId = del.getAttribute("data-delete-id");
      mdConfirmDeleteExisting(uploadId);
      return;
    }
    const open = e.target.closest("[data-open-id]");
    if (open) {
      const uploadId = open.getAttribute("data-open-id");
      const u = state.md.existing.find(r => r.id === uploadId);
      if (u) mdRenderFile({ kind: "existing", keyPrefix: u.id, name: u.fileName, url: streamFileUrl(u.driveFileId), meta: u });
    }
  });

  // Floating panel toggle (mobile drawer)
  mdPanelToggle?.addEventListener("click", () => {
    const expanded = mdPanelToggle.getAttribute("aria-expanded") === "true";
    mdPanelToggle.setAttribute("aria-expanded", String(!expanded));
    document.body.classList.toggle("md-panel-open", !expanded);
    mdSidebar?.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Save buttons
  mdSaveBtn?.addEventListener("click", mdSaveAll);
  mdSaveFab?.addEventListener("click", mdSaveAll);
}

/* Stage new files */
function mdStageFiles(files) {
  const accepted = [];
  for (const f of files) {
    if (!f) continue;
    if (f.size > 50 * 1024 * 1024) { alert(`${f.name}: exceeds 50 MB`); continue; }
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    accepted.push({ tempId, file: f, name: f.name, type: f.type || "", size: f.size });
  }
  if (!accepted.length) return;
  state.md.staged.push(...accepted);
  mdRenderStagedList();
  mdUpdateSaveButtons();
  mdPersistSession();
}

/* Remove a staged file */
function mdRemoveStaged(tempId) {
  if (!confirm("Remove this staged file?")) return;
  state.md.staged = state.md.staged.filter(s => s.tempId !== tempId);
  for (const k of Array.from(state.md.tagState.keys())) {
    if (k.startsWith(`${tempId}:`)) state.md.tagState.delete(k);
  }
  if (state.md.renderedKey === tempId) {
    mdRender.innerHTML = "";
    state.md.renderedKey = null;
  }
  mdRenderStagedList();
  mdUpdateSaveButtons();
  mdPersistSession();
}

/* Mark existing for delete (soft) */
function mdConfirmDeleteExisting(uploadId) {
  if (!confirm("Delete this document from the case?")) return;
  state.md.pendingDeletes.add(uploadId);
  const row = mdExistingList.querySelector(`[data-row-id="${uploadId}"]`);
  if (row) row.classList.add("muted");
  mdUpdateSaveButtons();
}

/* Render lists */
function mdRenderStagedList() {
  if (!mdStagedList) return;
  mdStagedList.innerHTML = "";
  for (const s of state.md.staged) {
    const div = document.createElement("div");
    div.className = "upload-row";
    div.setAttribute("data-tempid", s.tempId);
    div.innerHTML = `
      <div style="min-width:0;">
        <div class="doc-file" style="word-break:break-word;">${s.name}</div>
        <div class="doc-sub">${(s.type||"").split("/")[1]||"file"} • ${(s.size/1024/1024).toFixed(1)} MB</div>
      </div>
      <button class="btn" title="Remove" data-remove-tempid="${s.tempId}">✕</button>
    `;
    mdStagedList.appendChild(div);
  }
}
function mdRenderExistingList() {
  if (!mdExistingList) return;
  mdExistingList.innerHTML = "";
  for (const u of state.md.existing) {
    const delMarked = state.md.pendingDeletes.has(u.id);
    const row = document.createElement("div");
    row.className = "doc-list-item";
    row.setAttribute("data-row-id", u.id);
    if (delMarked) row.classList.add("muted");
    const fileUrl = streamFileUrl(u.driveFileId);
    row.innerHTML = `
      <div class="doc-file" title="${u.fileName}">${u.fileName}</div>
      <div class="doc-sub">${(u.mimeType||u.fileType||"").split("/")[1]||"file"} • ${(u.size? (u.size/1024/1024).toFixed(1)+" MB":"")}</div>
      <div class="doc-actions">
        <a href="#" data-open-id="${u.id}">Open</a>
        &nbsp;·&nbsp;
        <a href="#" data-delete-id="${u.id}" style="color:#b91c1c;">Delete</a>
      </div>
    `;
    mdExistingList.appendChild(row);
  }
}

/* Render a single file (replace previous) */
async function mdRenderFile({ kind, keyPrefix, file, name, type, url, meta }) {
  if (state.md.renderedKey === keyPrefix) {
    const anchor = mdRender.querySelector(`[data-anchor="${keyPrefix}"]`);
    if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  mdRender.innerHTML = "";
  state.md.renderedKey = keyPrefix;

  const header = document.createElement("div");
  header.className = "viewer-section";
  header.setAttribute("data-anchor", keyPrefix);
  header.innerHTML = `<h3 style="margin:0;">${name}</h3>`;
  mdRender.appendChild(header);

  const wrap = document.createElement("div");
  mdRender.appendChild(wrap);

  let isPdf = false, isImg = false;
  if (kind === "staged") {
    const low = (type || "").toLowerCase();
    isPdf = low.includes("pdf") || (name||"").toLowerCase().endsWith(".pdf");
    isImg = low.startsWith("image/") || /\.(jpg|jpeg|png)$/i.test(name||"");
  } else {
    const lowName = (name||"").toLowerCase();
    const lowMime = (meta?.mimeType || meta?.fileType || "").toLowerCase();
    isPdf = lowName.endsWith(".pdf") || lowMime === "application/pdf";
    isImg = /(\.jpg|\.jpeg|\.png)$/.test(lowName) || (lowMime.startsWith("image/"));
  }

  if (isPdf) {
    await mdRenderPdfPages({ kind, keyPrefix, file, url, container: wrap });
  } else if (isImg) {
    await mdRenderImage({ kind, keyPrefix, file, url, container: wrap, pageNo: 1 });
  } else {
    wrap.innerHTML = `<div class="muted">Preview not available for this file type.</div>`;
  }
}

/* PDF render (reduced width + DPR clamp) */
async function mdRenderPdfPages({ kind, keyPrefix, file, url, container }) {
  let src;
  if (kind === "staged") src = URL.createObjectURL(file); else src = url;
  let pdf;
  try {
    pdf = await window.pdfjsLib.getDocument(src).promise;
  } catch {
    container.innerHTML = `<div class="muted">Failed to load PDF.</div>`;
    return;
  }
  const tagOptions = await getTagOptions();

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const cssWidth = Math.min(container.clientWidth || 900, 900);
    const baseViewport = page.getViewport({ scale: 1 });
    const cssScale = cssWidth / baseViewport.width;
    const DPR = Math.max(1, window.devicePixelRatio || 1);
    const scale = cssScale * Math.min(DPR, state.md.dprClamp);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.ceil(viewport.width / Math.min(DPR, state.md.dprClamp))}px`;
    canvas.style.height = `${Math.ceil(viewport.height / Math.min(DPR, state.md.dprClamp))}px`;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const card = document.createElement("div");
    card.className = "page-card";
    card.appendChild(canvas);

    // page tag dropdown
    const footer = document.createElement("div");
    footer.className = "pdf-footer";
    const label = document.createElement("span"); label.className = "pdf-pg"; label.textContent = `Page ${p}`;
    const sel = document.createElement("select"); sel.className = "tag-select";
    sel.innerHTML = `<option value="">— tag —</option>` + tagOptions.map(t=>`<option value="${t}">${t}</option>`).join("");
    const k = `${keyPrefix}:${p}`;
    sel.value = state.md.tagState.get(k) || "";
    sel.addEventListener("change", () => {
      state.md.tagState.set(k, sel.value || "");
      state.md.dirtySet.add(k);
      mdUpdateSaveButtons();
      mdPersistSession();
    });
    footer.appendChild(label); footer.appendChild(sel);
    card.appendChild(footer);
    container.appendChild(card);
  }
}

/* Image render */
async function mdRenderImage({ kind, keyPrefix, file, url, container, pageNo }) {
  const img = document.createElement("img");
  img.loading = "lazy"; img.decoding = "async";
  img.style = "max-width:100%;width:auto;height:auto;border:1px solid var(--line);border-radius:8px;display:block;";
  img.src = kind === "staged" ? URL.createObjectURL(file) : url;

  const card = document.createElement("div");
  card.className = "page-card";
  card.appendChild(img);

  const tagOptions = await getTagOptions();
  const footer = document.createElement("div");
  footer.className = "pdf-footer";
  const label = document.createElement("span"); label.className = "pdf-pg"; label.textContent = `Page ${pageNo}`;
  const sel = document.createElement("select"); sel.className = "tag-select";
  sel.innerHTML = `<option value="">— tag —</option>` + tagOptions.map(t=>`<option value="${t}">${t}</option>`).join("");
  const k = `${keyPrefix}:${pageNo}`;
  sel.value = state.md.tagState.get(k) || "";
  sel.addEventListener("change", () => {
    state.md.tagState.set(k, sel.value || "");
    state.md.dirtySet.add(k);
    mdUpdateSaveButtons();
    mdPersistSession();
  });
  footer.appendChild(label); footer.appendChild(sel);
  card.appendChild(footer);
  container.appendChild(card);
}

/* Update Save buttons visibility */
function mdUpdateSaveButtons() {
  const hasChanges = state.md.staged.length > 0 || state.md.dirtySet.size > 0 || state.md.pendingDeletes.size > 0;
  if (mdSaveBtn) mdSaveBtn.hidden = !hasChanges;
  if (mdSaveFab) mdSaveFab.hidden = !hasChanges;
}

/* Save flow with lock/assignment check and overlay */
async function mdSaveAll() {
  const assignedEmail = state.caseDoc?.assignedNurse?.email || "";
  const isNurse = state.role === "nurse";
  const isOwner = isNurse && assignedEmail && assignedEmail === state.user.email;
  if (!isOwner) {
    await mdShowOwnershipOverlay();
    const refreshed = await getCase(state.caseId);
    state.caseDoc = refreshed;
    const ok = refreshed?.assignedNurse?.email === state.user.email;
    if (!ok) return; // user cancelled
  }

  mdSaveOverlay.hidden = false;
  mdSaveProgress.innerHTML = "";

  const log = (txt) => {
    const li = document.createElement("div");
    li.textContent = txt;
    mdSaveProgress.appendChild(li);
  };

  try {
    // 1) Upload staged files -> write uploads docs
    const tempToReal = new Map();
    for (const s of state.md.staged) {
      log(`Uploading ${s.name}…`);
      const meta = await uploadFile({ caseId: state.caseId, batchNo: 1, file: s.file });
      const upRef = await addDoc(collection(db, "uploads"), {
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
      tempToReal.set(s.tempId, { uploadId: upRef.id, driveFileId: meta.fileId });
      log(`Uploaded ${s.name}`);
    }

    // 2) Write pageTags
    const writes = [];
    // staged keys
    for (const s of state.md.staged) {
      const map = tempToReal.get(s.tempId);
      if (!map) continue;
      for (const [k, v] of state.md.tagState.entries()) {
        if (!k.startsWith(`${s.tempId}:`)) continue;
        const pageNo = parseInt(k.split(":")[1], 10) || 1;
        writes.push(setDoc(doc(db, "pageTags", `${map.uploadId}_${pageNo}`), {
          caseId: state.caseId, uploadId: map.uploadId, pageNumber: pageNo, tag: v || "", updatedAt: serverTimestamp()
        }, { merge: true }));
      }
    }
    // existing dirty keys
    for (const k of state.md.dirtySet) {
      const [prefix, pageStr] = k.split(":");
      if (prefix.startsWith("temp_")) continue;
      const pageNo = parseInt(pageStr, 10) || 1;
      const tag = state.md.tagState.get(k) || "";
      writes.push(setDoc(doc(db, "pageTags", `${prefix}_${pageNo}`), {
        caseId: state.caseId, uploadId: prefix, pageNumber: pageNo, tag, updatedAt: serverTimestamp()
      }, { merge: true }));
    }
    if (writes.length) log(`Updating ${writes.length} page tag(s)…`);
    await Promise.all(writes);

    // 3) Pending deletions
    for (const uploadId of state.md.pendingDeletes) {
      log(`Deleting ${uploadId}…`);
      await softDeleteUpload(uploadId);
    }

    // Done
    log("Finalizing…");
    state.md.staged = [];
    state.md.dirtySet.clear();
    state.md.pendingDeletes.clear();
    state.md.renderedKey = null;
    mdRender.innerHTML = "";
    sessionStorage.removeItem(`md:${state.caseId}`);

    await mdPrecacheExisting();
    mdRenderExistingList();
    mdRenderStagedList();
    mdUpdateSaveButtons();

    log("Saved successfully.");
  } catch (e) {
    log(`Error: ${e?.message || e}`);
    alert("Some items failed to save. See list for details.");
  } finally {
    setTimeout(() => { mdSaveOverlay.hidden = true; }, 400);
  }
}

/* Ownership overlay (assign to me) */
function mdShowOwnershipOverlay() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "md-overlay";
    overlay.innerHTML = `
      <div class="md-overlay-card">
        <div class="md-overlay-title">This case is not assigned to you</div>
        <div class="md-overlay-hint">Only the assigned nurse can manage documents.</div>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
          <button class="btn" data-cancel>Cancel</button>
          <button class="btn btn-primary" data-assign>Assign to me</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector("[data-cancel]")?.addEventListener("click", () => done(false));
    overlay.querySelector("[data-assign]")?.addEventListener("click", async () => {
      await updateCase(state.caseId, {
        assignedNurse: { email: state.user.email, displayName: state.user.displayName || state.user.email, at: new Date() }
      }, state.user);
      done(true);
    });
  });
}

/* ---------- pdf.js loader (CDN) ---------- */
async function loadPdfJsIfNeeded() {
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

/* ---------- Wire global events ---------- */
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

tabsNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  setActiveTab(btn.dataset.tab);
});

saveCommentBtn.addEventListener("click", (e) => { e.preventDefault(); postComment(false); });
confirmBtn.addEventListener("click", (e) => { e.preventDefault(); postComment(true); });

/* ---------- Shared helpers ---------- */
async function refreshUploadsForAll() {
  const rows = await listUploads(state.caseId);
  // view tab uses state.uploadsIndex; manage tab uses state.md.existing
  state.uploadsIndex = rows;
  if (state.docviewLoaded) {
    await loadDocviewData(); // refresh list and tags for view tab
  }
  if (state.md.initialized) {
    state.md.existing = rows;
    mdRenderExistingList();
  }
}

/* ---------- Auth ---------- */
onAuth(async (user) => {
  if (!user) { location.href = "/index.html"; return; }
  state.user = user;
  state.role = await loadRole();
  setHeaderUser(user, state.role);
  await loadCase();
  if (state.isNew) updateAgeFields();
});
