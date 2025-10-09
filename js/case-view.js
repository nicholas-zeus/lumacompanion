// /js/case-view.js
import { state } from "/js/case-shared.js";
import { listUploads, streamFileUrl } from "/js/api.js";
import {
  collection, query, where, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "/js/firebase.js";
import { fab } from "/js/fab.js";

fab.useDocTop(() => window.scrollTo({ top: 0, behavior: "smooth" }));

// ----- DOM -----
const docList        = document.getElementById("docList");
const docCount       = document.getElementById("docCount");
const pdfStack       = document.getElementById("pdfStack");
const tagHitsWrap    = document.getElementById("tagHits");
const tagFilterSelect= document.getElementById("tagFilterSelect");
const tagFilterClear = document.getElementById("tagFilterClear");

// ===== Viewer loading overlay (fixed, reference-counted) =====
let viewerLoadingEl;
let viewerLoadingCount = 0;

function ensureViewerLoading() {
  if (!viewerLoadingEl) {
    viewerLoadingEl = document.createElement("div");
    viewerLoadingEl.className = "viewer-loading";
    viewerLoadingEl.innerHTML = `<div class="spinner" aria-label="Loading…"></div>`;
    Object.assign(viewerLoadingEl.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.25)",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "2000"
    });
    document.body.appendChild(viewerLoadingEl);
  }
  return viewerLoadingEl;
}

function showViewerLoading() {
  const el = ensureViewerLoading();
  viewerLoadingCount++;
  if (viewerLoadingCount === 1) el.style.display = "flex";
}

function hideViewerLoading() {
  if (!viewerLoadingEl) return;
  viewerLoadingCount = Math.max(0, viewerLoadingCount - 1);
  if (viewerLoadingCount === 0) viewerLoadingEl.style.display = "none";
}

// ===== Controls =====
function wireDocviewControls() {
  tagFilterSelect?.addEventListener("change", () => applyDocTagFilter(tagFilterSelect.value));
  tagFilterClear?.addEventListener("click", () => {
    if (tagFilterSelect) tagFilterSelect.value = "";
    applyDocTagFilter("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// ===== Data load =====
async function loadDocviewData() {
  const rows = await listUploads(state.caseId);
  state.uploadsIndex = rows;
  state.uploadsById.clear();
  rows.forEach(r => state.uploadsById.set(r.id, r));
  if (docCount) docCount.textContent = `${rows.length} file${rows.length === 1 ? "" : "s"}`;

  // Collect tags for filter + hit map
  state.allTags = state.allTags || new Set();
  state.tagHits = [];
  state.allTags.clear();

  const col  = collection(db, "pageTags");
  const qRef = query(col, where("caseId", "==", state.caseId), limit(5000));
  const snap = await getDocs(qRef);
  snap.forEach(d => {
    const row = d.data();
    if (row?.tag) {
      state.allTags.add(row.tag);
      state.tagHits.push({ uploadId: row.uploadId, pageNumber: row.pageNumber, tag: row.tag });
    }
  });

  if (tagFilterSelect) {
    const current = tagFilterSelect.value || "";
    tagFilterSelect.innerHTML =
      `<option value="">All tags</option>` +
      Array.from(state.allTags).sort().map(t => `<option value="${t}">${t}</option>`).join("");
    if (current && state.allTags.has(current)) tagFilterSelect.value = current;
  }

  renderFileList();
}

// ===== Left list: one row per logical upload =====
function renderFileList() {
  if (!docList) return;
  docList.innerHTML = "";

  const files = Array.isArray(state.uploadsIndex) ? state.uploadsIndex : [];
  if (docCount) docCount.textContent = `${files.length} file${files.length === 1 ? "" : "s"}`;

  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No documents uploaded.";
    docList.appendChild(empty);
    return;
  }

  files.forEach((u) => {
    const name = u.fileName || u.name || "(untitled)";
    const row = document.createElement("div");
    row.className = "doc-list-item";
    row.innerHTML = `
      <div class="doc-file" title="${name}">${name}</div>
      <div class="doc-sub"></div>`; // intentionally hide multipart detail
    row.addEventListener("click", () => focusFirstPageOf(u.id));
    docList.appendChild(row);
  });
}

// ===== Helpers =====
function isPdf(u) {
  const n = (u.fileName || "").toLowerCase();
  const t = (u.mimeType || u.fileType || "").toLowerCase();
  return n.endsWith(".pdf") || t === "application/pdf";
}
function isImage(u) {
  const n = (u.fileName || "").toLowerCase();
  const t = (u.mimeType || u.fileType || "").toLowerCase();
  return /(\.jpg|\.jpeg|\.png|\.gif|\.webp)$/.test(n) || t.startsWith("image/");
}
function getDriveIds(u) {
  if (Array.isArray(u.driveFileIds) && u.driveFileIds.length) return u.driveFileIds;
  if (u.driveFileId) return [u.driveFileId];
  return [];
}
function focusFirstPageOf(uploadId) {
  const el = state.pageIndex?.get?.(`${uploadId}:1`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ===== pdf.js loader (single implementation) =====
async function loadPdfJsIfNeeded() {
  if (window.pdfjsLib?.getDocument) return;
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// ===== Public entry (called once per tab activation) =====
export async function ensureDocviewLoaded() {
  if (!state.caseId || state.isNew) return;

  if (!state.docviewLoaded) {
    showViewerLoading();
    try {
      await loadPdfJsIfNeeded();
      await loadDocviewData();
      wireDocviewControls();
      await renderCanvasStack();
      state.docviewLoaded = true;
    } finally {
      hideViewerLoading();
    }
  } else {
    await loadDocviewData();
    await renderCanvasStack();
  }
}

// ===== Render stack =====
async function renderCanvasStack() {
  if (!pdfStack || !tagHitsWrap) return;
  pdfStack.hidden = false;
  tagHitsWrap.hidden = true;
  pdfStack.innerHTML = "";
  state.pageIndex = state.pageIndex || new Map();
  state.pageIndex.clear();

  for (const u of state.uploadsIndex) {
    if (isPdf(u)) {
      await renderPdfFileAsCanvases(u);
    } else if (isImage(u)) {
      await renderImageFile(u);
    } else {
      const card = document.createElement("div");
      card.className = "pdf-block";
      card.innerHTML = `<div class="viewer-section"><h3>${u.fileName || "(file)"}</h3></div><div class="muted">Preview not available.</div>`;
      pdfStack.appendChild(card);
    }
  }

  if (!pdfStack.children.length) {
    pdfStack.innerHTML = `<div class="muted">No files uploaded yet.</div>`;
  }
}

// Merge all Drive parts and render as one continuous doc
async function renderPdfFileAsCanvases(u) {
  const section = document.createElement("div");
  section.className = "pdf-block";
  const pagesWrap = document.createElement("div");
  section.appendChild(pagesWrap);
  pdfStack.appendChild(section);

  const ids = getDriveIds(u);
  if (!ids.length) {
    pagesWrap.innerHTML = `<div class="muted">No file parts to display.</div>`;
    return;
  }

  showViewerLoading();
  let pageNo = 0;
  try {
    for (const fileId of ids) {
      const url = streamFileUrl(fileId, { proxy: true });
      let pdf;
      try {
        pdf = await window.pdfjsLib.getDocument({ url }).promise;
      } catch {
        const stub = document.createElement("div");
        stub.className = "muted";
        stub.style.margin = "8px 0";
        stub.textContent = "Failed to load one part of this PDF.";
        pagesWrap.appendChild(stub);
        continue;
      }

      const dpr = Math.max(1, window.devicePixelRatio || 1);
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const vBase = page.getViewport({ scale: 1 });
        const vScaled = page.getViewport({ scale: dpr });

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = Math.floor(vScaled.width);
        canvas.height = Math.floor(vScaled.height);
        canvas.style.width = "100%";
        canvas.style.height = "auto";

        await page.render({ canvasContext: ctx, viewport: vScaled }).promise;

        pageNo += 1;
        const card = document.createElement("div");
        card.className = "page-card";
        // optional header
        const hdr = document.createElement("div");
        hdr.className = "doc-sub";
        hdr.textContent = `Page ${pageNo}`;
        card.appendChild(hdr);

        card.appendChild(canvas);
        pagesWrap.appendChild(card);

        state.pageIndex.set(`${u.id}:${pageNo}`, card);
      }
    }
  } finally {
    hideViewerLoading();
  }
}

async function renderImageFile(u) {
  const section = document.createElement("div");
  section.className = "pdf-block";

  const img = document.createElement("img");
  img.decoding = "async";
  img.loading = "lazy";
  img.style.maxWidth = "100%";
  img.style.height = "auto";

  showViewerLoading();
  img.onload = () => hideViewerLoading();
  img.onerror = () => hideViewerLoading();

  // use proxy for consistent auth/headers
  const ids = getDriveIds(u);
  const firstId = ids[0];
  if (!firstId) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No image data.";
    section.appendChild(empty);
  } else {
    img.src = streamFileUrl(firstId, { proxy: true });
    section.appendChild(img);
  }

  pdfStack.appendChild(section);
  state.pageIndex.set(`${u.id}:1`, section);
}

// ===== Tag filter =====
function applyDocTagFilter(tag) {
  if (!pdfStack || !tagHitsWrap) return;
  if (!tag) {
    Array.from(pdfStack.querySelectorAll(".page-card, img, .pdf-block")).forEach(el => el.style.display = "");
    tagHitsWrap.hidden = true;
    pdfStack.hidden = false;
    return;
  }

  const allow = new Set(state.tagHits.filter(h => h.tag === tag).map(h => `${h.uploadId}:${h.pageNumber}`));
  let shown = 0;
  for (const [key, el] of state.pageIndex.entries()) {
    if (allow.has(key)) { el.style.display = ""; shown++; }
    else el.style.display = "none";
  }

  if (shown === 0) {
    pdfStack.hidden = true;
    tagHitsWrap.hidden = false;
    tagHitsWrap.innerHTML = `<div class="muted">No pages tagged “${tag}”.</div>`;
  } else {
    tagHitsWrap.hidden = true;
    pdfStack.hidden = false;
    // Scroll to the first visible
    for (const [, el] of state.pageIndex.entries()) {
      if (el.style.display !== "none") { el.scrollIntoView({ behavior: "smooth", block: "start" }); break; }
    }
  }
}
