// /js/case.js
import { initFirebase, onAuth, signOutNow, auth, db } from "/js/firebase.js";
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

// Firestore helpers (for View Documents tag index)
import {
  collection, query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

/* Documents (Upload tab) */
const fileInput      = document.getElementById("fileInput");
const uploadsList    = document.getElementById("uploadsList");
const pdfContainer   = document.getElementById("pdfContainer");
const tagFilterSel   = document.getElementById("tagFilter");
const tagFilterWrap  = document.getElementById("tagFilterWrap");
const docSaveBtn     = document.getElementById("docSaveBtn");
const docCancelBtn   = document.getElementById("docCancelBtn");
const stagedInfo     = document.getElementById("stagedInfo");
const stagedName     = document.getElementById("stagedName");

/* Documents (View tab) */
const docList        = document.getElementById("docList");
const docCount       = document.getElementById("docCount");
const pdfStack       = document.getElementById("pdfStack");
const tagHits        = document.getElementById("tagHits");
const tagFilterSelect= document.getElementById("tagFilterSelect");
const tagFilterClear = document.getElementById("tagFilterClear");

/* Comments */
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

  // Upload staging
  stagedFile: null,
  stagedIsPdf: false,

  // View Documents tab
  docviewLoaded: false,
  uploadsIndex: [],        // array of uploads rows
  uploadsById: new Map(),  // uploadId -> row
  allTags: new Set(),      // all tag strings present in case
  tagHits: [],             // [{uploadId, pageNumber, tag}]
};

/* ---------- Helpers ---------- */
function getHashId() {
  const h = (location.hash || "").slice(1);
  return h || "new";
}
function setActiveTab(name) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
  Object.entries(tabs).forEach(([k, el]) => el.classList.toggle("is-active", k === name));
  if (name === "docview") {
    ensureDocviewLoaded().catch(console.error);
  }
}
function setHeaderUser(user, role) {
  if (!user) return;
  roleBadge.hidden = false;
  roleBadge.textContent = (role || "").toUpperCase();
  signOutBtn.hidden = false;
  avatar.hidden = false;
  avatar.alt = user.displayName || user.email || "User";
}

/* edit guards */
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
  if (fileInput) fileInput.disabled = isFinished;
  finishBtn.hidden = isFinished || !(state.role === "nurse" || state.role === "admin");
  undoBtn.hidden   = !isFinished || !(state.role === "nurse" || state.role === "admin");
}

/* dates -> input value helpers */
function toInputDate(d) {
  const dt = toDate(d);
  if (!dt) return "";
  return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
function toInputDateTimeLocal(d) {
  const dt = toDate(d);
  if (!dt) return "";
  return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function updateAgeFields() {
  const years = computeAge(fDOB.value, fVisitDate.value, "years");
  const months = computeAge(fDOB.value, fVisitDate.value, "months");
  fAgeYears.value = (years ?? "");
  fAgeMonths.value = (months ?? "");
}

/* ---------- Load & Render Case ---------- */
async function loadCase() {
  const id = getHashId();
  state.caseId = id;
  state.isNew = (id === "new");

  if (state.isNew) {
    newCaseActions.classList.remove("hidden");
    tabs.documents.classList.add("is-active");
    setActiveTab("documents");
    return;
  }

  const doc = await getCase(id);
  if (!doc) {
    bannerArea.innerHTML = `<div class="banner">Case not found: <span class="mono">#${id}</span></div>`;
    return;
  }
  state.caseDoc = doc;

  // Fill details
  const d = doc.details || {};
  fName.value = d.Name || "";
  fMemberID.value = d.MemberID || "";
  fNationality.value = d.Nationality || "";
  fDOB.value = toInputDate(d.DOB);
  fAgeYears.value = computeAge(d.DOB, d.VisitDate, "years") ?? "";
  fAgeMonths.value = computeAge(d.DOB, d.VisitDate, "months") ?? "";
  fPolicyEff.value = toInputDate(d.PolicyEffectiveDate);
  fUWType.value = d.UnderwritingType || "";
  fAdmissionType.value = d.TypeOfAdmission || "";
  fConsultType.value = d.TypeOfConsultation || "";
  fVisitDate.value = toInputDate(d.VisitDate);
  fHospital.value = d.Hospital || "";
  fDiagnosis.value = d.Diagnosis || "";
  fDischargeDate.value = toInputDate(d.DischargeDate);
  fChiefComplaint.value = d.ChiefComplaint || "";
  fPresentIllness.value = d.PresentIllness || "";
  fExclusion.value = d.Exclusion || "";
  fVitalSigns.value = d.VitalSigns || "";
  fPhysicalFindings.value = d.PhysicalFindings || "";
  fSummary.value = d.Summary || "";
  fTreatment.value = d.Treatment || "";
  fReasonAdm.value = d.ReasonForAdmission || "";
  fReasonConsult.value = d.ReasonForConsultation || "";
  fOtherRemark.value = d.OtherRemark || "";
  statusText.textContent = statusLabel(doc.status || "—");
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

  // initial uploads list in Upload tab
  await refreshUploadsList();
}

/* ---------- Uploads (Upload tab existing) ---------- */
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
async function refreshUploadsList() {
  if (!state.caseId || state.isNew) return;
  const rows = await listUploads(state.caseId);
  renderUploadsList(rows);
}

/* ---------- Edit/Save Details ---------- */
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
    location.replace(`/case.html#${created.id}`);
    location.reload();
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
  setDetailsDisabled(true);
  editDetailsBtn.hidden = false;
  saveDetailsBtn.hidden = true;
}

/* ---------- Finish / Undo ---------- */
finishBtn?.addEventListener("click", async () => {
  await finishCase(state.caseId, state.user);
  const updated = await getCase(state.caseId);
  state.caseDoc = updated;
  lockUIFinished(true);
  statusText.textContent = statusLabel(updated.status);
});
undoBtn?.addEventListener("click", async () => {
  await undoFinish(state.caseId, state.user);
  const updated = await getCase(state.caseId);
  state.caseDoc = updated;
  lockUIFinished(false);
  statusText.textContent = statusLabel(updated.status);
});

/* ---------- Comments ---------- */
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
    lockUIFinished(true);
    statusText.textContent = statusLabel(updated.status);
  }
}

/* ---------- Upload flow (existing) ---------- */
function resetStaging() {
  state.stagedFile = null;
  state.stagedIsPdf = false;
  pdfContainer.className = "pdf-grid-empty";
  pdfContainer.innerHTML = "Select a PDF to preview & tag pages (will upload on Save).";
  docSaveBtn.disabled = true;
  docCancelBtn.disabled = true;
  stagedInfo.style.display = "none";
  stagedName.textContent = "";
}
async function onFileChosen(file) {
  resetStaging();
  if (!file) return;

  state.stagedFile = file;
  stagedInfo.style.display = "";
  stagedName.textContent = file.name;

  // Preview
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    state.stagedIsPdf = true;
    pdfContainer.className = "pdf-grid";
    pdfContainer.innerHTML = "";
    const { unbind } = await renderLocalPdfWithTags(pdfContainer, file, {
      caseId: state.caseId,
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
  docCancelBtn.disabled = false;
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

  // 2) Save page tags (if pdf)
  if (state.stagedIsPdf) {
    const pages = pdfContainer.querySelectorAll(".pdf-page");
    let pageNo = 0;
    for (const pg of pages) {
      pageNo++;
      const sel = pg.querySelector(".tag-select");
      const tag = sel?.value || "";
      if (tag) {
        await setPageTag({
          caseId: state.caseId,
          uploadId: meta.uploadId || meta.fileId || "", // uploadId is set by backend when you add the upload doc
          pageNumber: pageNo,
          tag
        });
      }
    }
  }

  // 3) Reset & refresh
  resetStaging();
  if (fileInput) fileInput.value = "";
  await refreshUploadsList();
  // If docview was already loaded, refresh it too so the new file appears immediately
  if (state.docviewLoaded) await loadDocviewData();
}

/* ---------- View Documents tab (new) ---------- */
async function ensureDocviewLoaded() {
  if (!state.caseId || state.isNew) return;
  if (!state.docviewLoaded) {
    await loadDocviewData();
    wireDocviewControls();
    renderDocList();
    renderPdfStack();
    state.docviewLoaded = true;
  } else {
    // Always refresh counts on revisit
    renderDocList();
  }
}
function wireDocviewControls() {
  tagFilterSelect?.addEventListener("change", () => applyDocTagFilter(tagFilterSelect.value));
  tagFilterClear?.addEventListener("click", () => {
    if (tagFilterSelect) tagFilterSelect.value = "";
    applyDocTagFilter("");
  });
}
async function loadDocviewData() {
  // 1) Fetch uploads for this case
  const rows = await listUploads(state.caseId);
  state.uploadsIndex = rows;
  state.uploadsById.clear();
  rows.forEach(r => state.uploadsById.set(r.id, r));

  // 2) Build tag index for the whole case from pageTags collection
  state.allTags.clear();
  state.tagHits = [];
  const col = collection(db, "pageTags");
  const qRef = query(col, where("caseId", "==", state.caseId), limit(2000));
  const snap = await getDocs(qRef);
  snap.forEach(d => {
    const row = d.data();
    if (row?.tag) {
      state.allTags.add(row.tag);
      state.tagHits.push({ uploadId: row.uploadId, pageNumber: row.pageNumber, tag: row.tag });
    }
  });

  // 3) Fill tag dropdown
  if (tagFilterSelect) {
    const current = tagFilterSelect.value || "";
    tagFilterSelect.innerHTML = `<option value="">All tags</option>` +
      Array.from(state.allTags).sort().map(t => `<option value="${t}">${t}</option>`).join("");
    // keep previous selection if still present
    if (current && state.allTags.has(current)) tagFilterSelect.value = current;
  }

  // 4) Update count
  if (docCount) docCount.textContent = `${rows.length} file${rows.length === 1 ? "" : "s"}`;
}
function renderDocList() {
  if (!docList) return;
  docList.innerHTML = "";
  const items = state.uploadsIndex;

  items.forEach(u => {
    const who = u.uploadedBy?.displayName || u.uploadedBy?.email || "Unknown";
    const when = (u.uploadedAt?.seconds) ? new Date(u.uploadedAt.seconds * 1000).toLocaleString() : "";
    const div = document.createElement("div");
    div.className = "doc-list-item";
    div.innerHTML = `
      <div class="doc-file">${u.fileName}</div>
      <div class="doc-sub">${who} • ${when}</div>
      <div class="doc-sub">Batch: ${u.batchNo || "-"}</div>
      <div class="doc-actions">
        <a href="${streamFileUrl(u.driveFileId)}?download=1" target="_blank" rel="noopener">Download</a>
        ${isPdf(u) ? ` · <a href="#" data-open="${u.id}">Open</a>` : ""}
      </div>
    `;
    div.querySelectorAll("[data-open]").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        focusPdf(u.id);
      });
    });
    docList.appendChild(div);
  });
}
function isPdf(u) {
  const n = (u.fileName || "").toLowerCase();
  const t = (u.mimeType || u.fileType || "").toLowerCase();
  return n.endsWith(".pdf") || t === "application/pdf";
}
function renderPdfStack() {
  if (!pdfStack) return;
  pdfStack.hidden = false;
  if (tagHits) tagHits.hidden = true;
  pdfStack.innerHTML = "";

  const pdfs = state.uploadsIndex.filter(isPdf);
  for (const u of pdfs) {
    const block = document.createElement("div");
    block.className = "pdf-block";
    block.innerHTML = `
      <div class="viewer-section">
        <h3>${u.fileName}</h3>
        <div>
          <a href="${streamFileUrl(u.driveFileId)}" target="_blank" rel="noopener">Open in new tab</a>
          &nbsp;·&nbsp;
          <a href="${streamFileUrl(u.driveFileId)}?download=1" target="_blank" rel="noopener">Download</a>
        </div>
      </div>
      <iframe class="pdf-frame" src="${streamFileUrl(u.driveFileId)}" loading="lazy"></iframe>
    `;
    pdfStack.appendChild(block);
  }
  if (!pdfs.length) {
    pdfStack.innerHTML = `<div class="muted">No PDF files in this case yet.</div>`;
  }
}
function focusPdf(uploadId) {
  if (!pdfStack) return;
  const u = state.uploadsById.get(uploadId);
  if (!u) return;
  // Find the block by filename header
  const blocks = Array.from(pdfStack.querySelectorAll(".viewer-section h3"));
  const idx = blocks.findIndex(h => h.textContent === u.fileName);
  if (idx >= 0) blocks[idx].scrollIntoView({ behavior: "smooth", block: "start" });
}
function applyDocTagFilter(tag) {
  if (!pdfStack || !tagHits) return;
  if (!tag) {
    renderPdfStack();
    return;
  }
  const hits = state.tagHits.filter(h => h.tag === tag);
  tagHits.innerHTML = "";
  if (!hits.length) {
    tagHits.hidden = false;
    pdfStack.hidden = true;
    tagHits.innerHTML = `<div class="muted">No pages tagged “${tag}”.</div>`;
    return;
  }
  for (const h of hits) {
    const u = state.uploadsById.get(h.uploadId);
    if (!u || !isPdf(u)) continue;
    const card = document.createElement("div");
    card.className = "tag-hit";
    const pageUrl = `${streamFileUrl(u.driveFileId)}#page=${h.pageNumber}`;
    card.innerHTML = `
      <iframe src="${pageUrl}" loading="lazy" style="width:100%;height:360px;border:0;border-radius:6px;"></iframe>
      <div class="hit-meta">
        <span>${u.fileName} • p.${h.pageNumber}</span>
        <span class="hit-actions">
          <a href="${streamFileUrl(u.driveFileId)}?download=1" target="_blank" rel="noopener">Download</a>
          &nbsp;·&nbsp;
          <a href="${pageUrl}" target="_blank" rel="noopener">Open</a>
        </span>
      </div>
    `;
    tagHits.appendChild(card);
  }
  tagHits.hidden = false;
  pdfStack.hidden = true;
}

/* ---------- Wire events ---------- */
document.getElementById("fDOB")?.addEventListener("change", updateAgeFields);
document.getElementById("fVisitDate")?.addEventListener("change", updateAgeFields);

signOutBtn.addEventListener("click", () => signOutNow());

editDetailsBtn.addEventListener("click", (e) => {
  e.preventDefault();
  state.isEditing = true;
  setDetailsDisabled(false);
  editDetailsBtn.hidden = true;
  saveDetailsBtn.hidden = false;
});
saveDetailsBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  await saveDetails();
});

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
  // reuse your existing export logic if desired; placeholder for now
  alert("Transcript export coming soon.");
});

tabsNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  setActiveTab(btn.dataset.tab);
});

saveCommentBtn.addEventListener("click", (e) => { e.preventDefault(); postComment(false); });
confirmBtn.addEventListener("click", (e) => { e.preventDefault(); postComment(true); });

fileInput?.addEventListener("change", async (e) => {
  const file = (e.target.files || [])[0];
  await onFileChosen(file);
});
docCancelBtn?.addEventListener("click", (e) => { e.preventDefault(); resetStaging(); if (fileInput) fileInput.value = ""; });
docSaveBtn?.addEventListener("click", async (e) => { e.preventDefault(); await saveStagedDocument(); });

/* ---------- Auth ---------- */
onAuth(async (user) => {
  if (!user) { location.href = "/index.html"; return; }
  state.user = user;
  state.role = await loadRole();
  setHeaderUser(user, state.role);
  await loadCase();
  if (state.isNew) updateAgeFields();
  // Optionally, prefetch docview data so the tab is instant when clicked:
  // await loadDocviewData();
});
