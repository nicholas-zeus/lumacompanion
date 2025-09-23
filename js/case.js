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
import { renderLocalPdfWithTags } from "/js/tagging.js"; // used on Upload tab only

import {
  collection, query, where, orderBy, limit, getDocs
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

/* Upload tab */
const fileInput      = document.getElementById("fileInput");
const uploadsList    = document.getElementById("uploadsList");
const pdfContainer   = document.getElementById("pdfContainer");
const tagFilterSel   = document.getElementById("tagFilter");
const tagFilterWrap  = document.getElementById("tagFilterWrap");
const docSaveBtn     = document.getElementById("docSaveBtn");
const docCancelBtn   = document.getElementById("docCancelBtn");
const stagedInfo     = document.getElementById("stagedInfo");
const stagedName     = document.getElementById("stagedName");

/* View tab */
const docList        = document.getElementById("docList");
const docCount       = document.getElementById("docCount");
const pdfStack       = document.getElementById("pdfStack");  // now a canvas-based stack
const tagHitsWrap    = document.getElementById("tagHits");
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

  // View Documents
  docviewLoaded: false,
  uploadsIndex: [],        // [{ id, fileName, mimeType, driveFileId, uploadedBy, uploadedAt, batchNo }]
  uploadsById: new Map(),
  allTags: new Set(),      // set of tag values for dropdown
  tagHits: [],             // [{ uploadId, pageNumber, tag }]

  // Render bookkeeping
  pageIndex: new Map(),    // map key `${uploadId}:${pageNo}` -> element
};

/* ---------- Utils ---------- */
function getHashId() { const h = (location.hash || "").slice(1); return h || "new"; }
function setActiveTab(name) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
  Object.entries(tabs).forEach(([k, el]) => el.classList.toggle("is-active", k === name));
  if (name === "docview") ensureDocviewLoaded().catch(console.error);
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
  const years = computeAge(fDOB.value, fVisitDate.value, "years");
  const months = computeAge(fDOB.value, fVisitDate.value, "months");
  fAgeYears.value = (years ?? "");
  fAgeMonths.value = (months ?? "");
}
function lockUIFinished(isFinished) {
  finishedLock.classList.toggle("hidden", !isFinished);
  detailsForm.querySelectorAll(".input").forEach(i => i.disabled = isFinished || (!state.isNew && !state.isEditing));
  if (fileInput) fileInput.disabled = isFinished;
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
    setActiveTab("documents");
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
  fDOB.value = toInputDate(d.DOB); fAgeYears.value = computeAge(d.DOB, d.VisitDate, "years") ?? "";
  fAgeMonths.value = computeAge(d.DOB, d.VisitDate, "months") ?? "";
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

  // lock / actions
  lockUIFinished(doc.status === "finished");
  downloadPdfBtn.hidden = false;

  // initial uploads list
  await refreshUploadsList();
}

/* ---------- Uploads tab (existing flow; unchanged except staging helpers) ---------- */
function resetStaging() {
  state.stagedFile = null; state.stagedIsPdf = false;
  pdfContainer.className = "pdf-grid-empty";
  pdfContainer.innerHTML = "Select a PDF to preview & tag pages (will upload on Save).";
  docSaveBtn.disabled = true; docCancelBtn.disabled = true;
  stagedInfo.style.display = "none"; stagedName.textContent = "";
}
async function onFileChosen(file) {
  resetStaging();
  if (!file) return;

  state.stagedFile = file;
  stagedInfo.style.display = "";
  stagedName.textContent = file.name;

  // Preview via canvas (Upload tab continues to use tagging.js renderer)
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    state.stagedIsPdf = true;
    pdfContainer.className = "pdf-grid";
    pdfContainer.innerHTML = "";
    await renderLocalPdfWithTags(pdfContainer, file, {
      caseId: state.caseId,
      onTagChange: () => applyTagFilterUpload()
    });
    const tags = await getTagOptions();
    tagFilterSel.innerHTML = `<option value="">All</option>` + tags.map(t => `<option>${t}</option>`).join("");
    tagFilterWrap.style.display = "";
    applyTagFilterUpload();
  } else {
    pdfContainer.className = "pdf-grid-empty";
    pdfContainer.innerHTML = "This file type does not support page tagging. Click Save to upload.";
  }

  docSaveBtn.disabled = false; docCancelBtn.disabled = false;
}
function applyTagFilterUpload() {
  const val = tagFilterSel.value || "";
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

  // 2) Save page tags (if pdf) — Upload tab only
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
          uploadId: meta.uploadId || meta.fileId || "",
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
  if (state.docviewLoaded) await loadDocviewData(); // keep View tab in sync
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
    row.appendChild(link); row.appendChild(meta);
    uploadsList.appendChild(row);
  });
}
async function refreshUploadsList() {
  if (!state.caseId || state.isNew) return;
  const rows = await listUploads(state.caseId);
  renderUploadsList(rows);
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
    state.caseDoc = updated; lockUIFinished(true);
    statusText.textContent = statusLabel(updated.status);
  }
}

/* ---------- View Documents (canvas-first + images) ---------- */
async function ensureDocviewLoaded() {
  if (!state.caseId || state.isNew) return;
  if (!state.docviewLoaded) {
    await loadPdfJsIfNeeded();
    await loadDocviewData();
    wireDocviewControls();
    buildStickySidebar();
    await renderCanvasStack(); // render all files (pdfs as canvases, images as <img>)
    state.docviewLoaded = true;
  } else {
    await loadDocviewData();     // keep tags and list fresh
    await renderCanvasStack();   // re-render to reflect changes
  }
}

function wireDocviewControls() {
  tagFilterSelect?.addEventListener("change", () => applyDocTagFilter(tagFilterSelect.value));
  tagFilterClear?.addEventListener("click", () => {
    if (tagFilterSelect) tagFilterSelect.value = "";
    applyDocTagFilter("");
    scrollToTop();
  });
}

function buildStickySidebar() {
  if (!docList) return;
  // "Go to top" control
  const topBtn = document.createElement("div");
  topBtn.style = "position:sticky; top:0; background:#fff; z-index:1; padding:6px 0 8px; border-bottom:1px solid var(--line); margin-bottom:8px;";
  topBtn.innerHTML = `<button id="goTopBtn" class="btn" style="width:100%;">↑ Go to top</button>`;
  docList.prepend(topBtn);
  document.getElementById("goTopBtn")?.addEventListener("click", scrollToTop);
}

function scrollToTop() { window.scrollTo({ top: 0, behavior: "smooth" }); }

async function loadDocviewData() {
  // 1) uploads
  const rows = await listUploads(state.caseId);
  state.uploadsIndex = rows;
  state.uploadsById.clear();
  rows.forEach(r => state.uploadsById.set(r.id, r));
  if (docCount) docCount.textContent = `${rows.length} file${rows.length===1?"":"s"}`;

  // 2) tags (pageTags)
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

  // dropdown
  if (tagFilterSelect) {
    const current = tagFilterSelect.value || "";
    tagFilterSelect.innerHTML = `<option value="">All tags</option>` +
      Array.from(state.allTags).sort().map(t => `<option value="${t}">${t}</option>`).join("");
    if (current && state.allTags.has(current)) tagFilterSelect.value = current;
  }

  // left list
  renderFileList();
}

function renderFileList() {
  if (!docList) return;
  // preserve sticky header
  docList.querySelectorAll(".doc-list-item, .doc-divider").forEach(n => n.remove());

  const items = state.uploadsIndex;
  for (const u of items) {
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

  // Render each file (PDF as canvases, images as <img> blocks)
  for (const u of state.uploadsIndex) {
    if (isPdf(u)) {
      await renderPdfFileAsCanvases(u);
    } else if (isImage(u)) {
      renderImageFile(u);
    } else {
      // Non-previewable fallback: just show a link
      const card = document.createElement("div");
      card.className = "pdf-block";
      card.innerHTML = `
        <div class="viewer-section">
          <h3>${u.fileName}</h3>
          <div>
            <a href="${streamFileUrl(u.driveFileId)}" target="_blank" rel="noopener">Open</a>
            &nbsp;·&nbsp;
            <a href="${streamFileUrl(u.driveFileId)}?download=1" target="_blank" rel="noopener">Download</a>
          </div>
        </div>
        <div class="muted">Preview not available for this file type.</div>
      `;
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
  section.innerHTML = `
    <div class="viewer-section">
      <h3>${u.fileName}</h3>
      <div>
        <a href="${streamFileUrl(u.driveFileId)}" target="_blank" rel="noopener">Open in new tab</a>
        &nbsp;·&nbsp;
        <a href="${streamFileUrl(u.driveFileId)}?download=1" target="_blank" rel="noopener">Download</a>
      </div>
    </div>
    <div class="pdf-pages"></div>
  `;
  const pagesWrap = section.querySelector(".pdf-pages");
  pdfStack.appendChild(section);

  // Load & render with pdf.js
  const url = streamFileUrl(u.driveFileId); // Netlify function URL
  let pdf;
  try {
    pdf = await window.pdfjsLib.getDocument(url).promise;
  } catch (e) {
    pagesWrap.innerHTML = `<div class="muted">Failed to load PDF.</div>`;
    return;
  }

  // Render pages sequentially (keeps memory in check)
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport0 = page.getViewport({ scale: 1 });
    const maxWidth = Math.min(pagesWrap.clientWidth || 1000, 1000); // guard
    const scale = maxWidth / viewport0.width;
    const viewport = page.getViewport({ scale: scale });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    canvas.style.display = "block";
    canvas.setAttribute("data-upload-id", u.id);
    canvas.setAttribute("data-page", String(p));
    canvas.className = "page-canvas";

    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Wrapper card per page (gives page-level scrolling/focus)
    const pageCard = document.createElement("div");
    pageCard.className = "page-card";
    pageCard.style = "margin-bottom:12px;";
    pageCard.appendChild(canvas);
    pagesWrap.appendChild(pageCard);

    // index for scroll-to from left list / tag filter
    state.pageIndex.set(`${u.id}:${p}`, pageCard);
  }
}

function renderImageFile(u) {
  const section = document.createElement("div");
  section.className = "pdf-block";
  section.innerHTML = `
    <div class="viewer-section">
      <h3>${u.fileName}</h3>
      <div>
        <a href="${streamFileUrl(u.driveFileId)}" target="_blank" rel="noopener">Open in new tab</a>
        &nbsp;·&nbsp;
        <a href="${streamFileUrl(u.driveFileId)}?download=1" target="_blank" rel="noopener">Download</a>
      </div>
    </div>
  `;
  const img = document.createElement("img");
  img.src = streamFileUrl(u.driveFileId);
  img.alt = u.fileName;
  img.style = "width:100%;height:auto;border:1px solid var(--line);border-radius:8px;";
  section.appendChild(img);
  pdfStack.appendChild(section);

  // index as page 1 so filter can optionally map if needed
  state.pageIndex.set(`${u.id}:1`, section);
}

function focusFirstPageOf(uploadId) {
  const key1 = `${uploadId}:1`;
  const el = state.pageIndex.get(key1);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Tag filter across all pages (PDF canvases + images) */
function applyDocTagFilter(tag) {
  if (!pdfStack || !tagHitsWrap) return;
  if (!tag) {
    // show everything
    Array.from(pdfStack.querySelectorAll(".page-card, img, .pdf-block")).forEach(el => el.style.display = "");
    tagHitsWrap.hidden = true; pdfStack.hidden = false;
    return;
  }

  // Build set of matching keys like "uploadId:pageNumber"
  const allow = new Set(state.tagHits.filter(h => h.tag === tag).map(h => `${h.uploadId}:${h.pageNumber}`));

  // Hide all, then show matches
  let shown = 0;
  for (const [key, el] of state.pageIndex.entries()) {
    if (allow.has(key)) {
      el.style.display = "";
      shown++;
    } else {
      el.style.display = "none";
    }
  }

  // If no pages matched, show message
  if (shown === 0) {
    pdfStack.hidden = true;
    tagHitsWrap.hidden = false;
    tagHitsWrap.innerHTML = `<div class="muted">No pages tagged “${tag}”.</div>`;
  } else {
    tagHitsWrap.hidden = true;
    pdfStack.hidden = false;
  }

  // Scroll to the first visible page
  for (const [key, el] of state.pageIndex.entries()) {
    if (el.style.display !== "none") { el.scrollIntoView({ behavior: "smooth", block: "start" }); break; }
  }
}

/* ---------- pdf.js loader (CDN) ---------- */
async function loadPdfJsIfNeeded() {
  if (window.pdfjsLib?.getDocument) return;
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js");
  // worker
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

/* ---------- Wire events ---------- */
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
});
