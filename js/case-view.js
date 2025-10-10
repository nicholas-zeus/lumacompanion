import { state } from "/js/case-shared.js";
import { listUploads } from "/js/api.js";
import { collection, query, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "/js/firebase.js";
import { fab } from "/js/fab.js";

import { streamFileUrl, getDriveIds, isMultipartUpload } from "/js/api.js";
import { mapWithConcurrency } from "/js/semaphore.js";

fab.useDocTop(() => window.scrollTo({ top: 0, behavior: "smooth" }));

const docList = document.getElementById("docList");
const docCount = document.getElementById("docCount");
const pdfStack = document.getElementById("pdfStack");
const tagHitsWrap = document.getElementById("tagHits");
const tagFilterSelect = document.getElementById("tagFilterSelect");
const tagFilterClear = document.getElementById("tagFilterClear");

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
      border: "none",
      borderRadius: "0",
      zIndex: "2000"
    });
    document.body.appendChild(viewerLoadingEl);
  }
  return viewerLoadingEl;
}
function firstDriveId(u) {
  const ids = getDriveIds(u);
  return ids && ids.length ? ids[0] : (u.driveFileId || "");
}
function showViewerLoading() {
  const el = ensureViewerLoading();
  viewerLoadingCount++;
  el.classList.add("is-on");
}

/*function hideViewerLoading() {
  if (!viewerLoadingEl) return;
  viewerLoadingCount = Math.max(0, viewerLoadingCount - 1);
  if (viewerLoadingCount === 0) {
    viewerLoadingEl.classList.remove("is-on");
  }
}*/

function wireDocviewControls() {
  tagFilterSelect?.addEventListener("change", () => applyDocTagFilter(tagFilterSelect.value));
  tagFilterClear?.addEventListener("click", () => {
    if (tagFilterSelect) tagFilterSelect.value = "";
    applyDocTagFilter("");
    scrollToTop();
  });
}
async function renderFileList() {
  docList.innerHTML = "";
  const files = state.uploadsIndex || []; // rely on your current data source
  docCount.textContent = `${files.length}`;

  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No documents uploaded.";
    docList.appendChild(empty);
    return;
  }

  files.forEach((f) => {
    const name = f.fileName || f.name || "(untitled)";
    const parts = Number(f.filePartsCount || (Array.isArray(f.driveFileIds) ? f.driveFileIds.length : 1) || 1);
    const row = document.createElement("div");
    row.className = "doc-list-item";
    row.innerHTML = `
      <div class="doc-file">${name}</div>
      <div class="doc-sub">${parts > 1 ? `${parts} parts` : ""}</div>
    `;
row.addEventListener("click", (e) => {
  e.preventDefault();
  // if the bulk render already created the first-page anchor, just scroll
  const key = `${f.id}:1`;
  const el = state.pageIndex.get(key);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    // fallback: if for some reason it isn't rendered (e.g., after a filter),
    // render just this file and then scroll.
    openDocViewer(f).then(() => {
      const after = state.pageIndex.get(key);
      if (after) after.scrollIntoView({ behavior: "smooth", block: "start" });
    }).catch(err => {
      console.error("openDocViewer failed:", err);
      alert(err?.message || "Failed to open file.");
    });
  }
});

    docList.appendChild(row);
  });
}
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadDocviewData() {
  const rows = await listUploads(state.caseId);
  state.uploadsIndex = rows;
  state.uploadsById.clear();
  rows.forEach(r => state.uploadsById.set(r.id, r));
  if (docCount) docCount.textContent = `${rows.length} file${rows.length === 1 ? "" : "s"}`;

  state.allTags.clear();
  state.tagHits = [];
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

  if (tagFilterSelect) {
    const current = tagFilterSelect.value || "";
    tagFilterSelect.innerHTML = `<option value="">All tags</option>` +
      Array.from(state.allTags).sort().map(t => `<option value="${t}">${t}</option>`).join("");
    if (current && state.allTags.has(current)) tagFilterSelect.value = current;
  }

  renderFileList();
}

// Render left-panel file list as ONE row per logical doc (handles multipart)



// Local pdf.js loader (same CDN/version as tagging.js)
const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120";
async function ensurePdfJsLocal() {
  if (globalThis.pdfjsLib) {
    if (!globalThis.pdfjsLib.GlobalWorkerOptions?.workerSrc) {
      globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
    }
    return globalThis.pdfjsLib;
  }
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = `${PDFJS_CDN}/pdf.min.js`;
    s.async = true;
    s.onload = res;
    s.onerror = () => rej(new Error("Failed to load pdf.js"));
    document.head.appendChild(s);
  });
  const lib = globalThis.pdfjsLib;
  if (!lib) throw new Error("pdf.js not available");
  lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
  return lib;
}

// Very small loading overlay helpers that line up with your CSS
/*function showViewerLoading() {
  if (!viewerLoadingEl) {
    viewerLoadingEl = document.createElement("div");
    viewerLoadingEl.className = "viewer-loading";
    viewerLoadingEl.innerHTML = `<div class="spinner"></div>`;
    // attach overlay to the right viewer card container
    const viewerCard = pdfStack.closest(".viewer-card") || pdfStack;
    viewerCard.style.position = viewerCard.style.position || "relative";
    viewerCard.appendChild(viewerLoadingEl);
  }
  viewerLoadingCount++;
  viewerLoadingEl.classList.add("is-on");
}*/
function hideViewerLoading() {
  viewerLoadingCount = Math.max(0, viewerLoadingCount - 1);
  if (viewerLoadingEl && viewerLoadingCount === 0) {
    viewerLoadingEl.classList.remove("is-on");
  }
}

// Open a (possibly multipart) document and render all pages in serial into #pdfStack
async function openDocViewer(uf) {
  // Clean current view
  pdfStack.innerHTML = "";

  showViewerLoading();
  try {
    const pdfjsLib = await ensurePdfJsLocal();

    const driveIds = getDriveIds(uf);
    const multipart = isMultipartUpload(uf);
    if (!driveIds.length) {
      console.warn("No drive IDs to render.");
      return;
    }

    // pre-load with limited concurrency, then render in order
    const sources = driveIds.map((id) => streamFileUrl(id));
    const pdfDocs = await mapWithConcurrency(sources, 2, async (src) => {
      return pdfjsLib.getDocument(src).promise;
    });

    let globalPageIdx = 0;
    const DPR = Math.max(1, window.devicePixelRatio || 1);
    const SCALE = 1.6 * DPR;

    for (let partIdx = 0; partIdx < pdfDocs.length; partIdx++) {
      const pdf = pdfDocs[partIdx];
      for (let p = 1; p <= pdf.numPages; p++) {
        globalPageIdx++;

        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: SCALE });

        const card = document.createElement("div");
        card.className = "page-card";

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "auto";

        await page.render({ canvasContext: ctx, viewport }).promise;

        const hdr = document.createElement("div");
        hdr.className = "doc-sub";
        hdr.textContent = `Page ${globalPageIdx}`;

        card.appendChild(hdr);
        card.appendChild(canvas);
        pdfStack.appendChild(card);

        // 🔑 index by GLOBAL page number so Firestore tags match
        state.pageIndex.set(`${uf.id}:${globalPageIdx}`, card);
      }
    }
  } finally {
    hideViewerLoading();
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

function focusFirstPageOf(uploadId) {
  const key1 = `${uploadId}:1`;
  const el = state.pageIndex.get(key1);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyDocTagFilter(tag) {
  if (!pdfStack || !tagHitsWrap) return;
  if (!tag) {
    Array.from(pdfStack.querySelectorAll(".page-card, img, .pdf-block")).forEach(el => el.style.display = "");
    tagHitsWrap.hidden = true; pdfStack.hidden = false;
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
  }
  for (const [key, el] of state.pageIndex.entries()) {
    if (el.style.display !== "none") {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    }
  }
}

export async function ensureDocviewLoaded() {
  if (!state.caseId || state.isNew) return;

  if (!state.docviewLoaded) {
    showViewerLoading();
    await loadPdfJsIfNeeded();
    await loadDocviewData();
    wireDocviewControls();
    await renderCanvasStack();
    hideViewerLoading();
    state.docviewLoaded = true;
  } else {
    await loadDocviewData();
    await renderCanvasStack();
  }
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
      await renderImageFile(u);
    } else {
      const card = document.createElement("div");
      card.className = "pdf-block";
      card.innerHTML = `<div class="viewer-section"><h3>${u.fileName}</h3></div><div class="muted">Preview not available.</div>`;
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

  const ids = getDriveIds(u);
  if (!ids.length) {
    pagesWrap.innerHTML = `<div class="muted">No Drive file ID.</div>`;
    return;
  }

  await loadPdfJsIfNeeded();

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  let globalPage = 0;

  showViewerLoading();
  try {
    for (const fileId of ids) {
      const url = `${streamFileUrl(fileId)}?proxy=1`;

      let pdf;
      try {
        pdf = await window.pdfjsLib.getDocument({ url }).promise;
      } catch {
        const err = document.createElement("div");
        err.className = "muted";
        err.textContent = "Failed to load one part of this PDF.";
        pagesWrap.appendChild(err);
        continue;
      }

      for (let p = 1; p <= pdf.numPages; p++) {
        globalPage++;

        const page = await pdf.getPage(p);

        // compute CSS and render scales
        const baseViewport = page.getViewport({ scale: 1 });
        const maxWidth = Math.min(pagesWrap.clientWidth || 1000, 1400);
        const cssScale = maxWidth / baseViewport.width;
        const renderScale = cssScale * dpr;
        const cssViewport = page.getViewport({ scale: cssScale });
        const renderViewport = page.getViewport({ scale: renderScale });

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { alpha: false });
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "auto";

        await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

        const pageCard = document.createElement("div");
        pageCard.className = "page-card";

        // optional header with the GLOBAL page number
        const hdr = document.createElement("div");
        hdr.className = "doc-sub";
        hdr.textContent = `Page ${globalPage}`;
        pageCard.appendChild(hdr);

        pageCard.appendChild(canvas);
        pagesWrap.appendChild(pageCard);

        // 🔑 index by GLOBAL page number so the tag filter matches Firestore
        state.pageIndex.set(`${u.id}:${globalPage}`, pageCard);
      }
    }
  } finally {
    hideViewerLoading();
  }
}


async function renderImageFile(u) {
  const section = document.createElement("div");
  section.className = "pdf-block";
  const fileId = firstDriveId(u);
  if (!fileId) {
    section.innerHTML = `<div class="muted">No Drive file ID.</div>`;
    pdfStack.appendChild(section);
    return;
  }
  const url = `${streamFileUrl(fileId)}?proxy=1`;
  const img = document.createElement("img");
  img.decoding = "async";
  img.loading = "lazy";
  img.style.maxWidth = "100%";
  img.style.height = "auto";

  showViewerLoading();
  img.onload = () => hideViewerLoading();
  img.onerror = () => hideViewerLoading();

  img.src = url;
  section.appendChild(img);
  pdfStack.appendChild(section);
  state.pageIndex.set(`${u.id}:1`, section);
}

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
