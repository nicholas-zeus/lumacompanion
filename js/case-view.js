// case-view.js
import { state } from "/js/case-shared.js";
import { listUploads, streamFileUrl, getDriveIds, isMultipartUpload } from "/js/api.js";
import { mapWithConcurrency } from "/js/semaphore.js";
import { collection, query, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "/js/firebase.js";
import { fab } from "/js/fab.js";

fab.useDocTop(() => window.scrollTo({ top: 0, behavior: "smooth" }));

/* -------------------------------------------------------
   DOM
------------------------------------------------------- */
const docList = document.getElementById("docList");
const docCount = document.getElementById("docCount");
const pdfStack = document.getElementById("pdfStack");
const tagHitsWrap = document.getElementById("tagHits");
const tagFilterSelect = document.getElementById("tagFilterSelect");
const tagFilterClear = document.getElementById("tagFilterClear");

/* -------------------------------------------------------
   Viewer loading overlay (single implementation)
------------------------------------------------------- */
let viewerLoadingEl;
let viewerLoadingCount = 0;

function ensureViewerLoading() {
  if (!viewerLoadingEl) {
    viewerLoadingEl = document.createElement("div");
    viewerLoadingEl.className = "viewer-loading";
    viewerLoadingEl.innerHTML = `<div class="spinner" aria-label="Loading…"></div>`;

    // Prefer attaching to a viewer container; fallback to body
    const viewerCard = pdfStack?.closest?.(".viewer-card");
    if (viewerCard) {
      viewerCard.style.position = viewerCard.style.position || "relative";
      Object.assign(viewerLoadingEl.style, { position: "absolute", inset: "0", zIndex: "10" });
      viewerCard.appendChild(viewerLoadingEl);
    } else {
      Object.assign(viewerLoadingEl.style, { position: "fixed", inset: "0", zIndex: "2000" });
      document.body.appendChild(viewerLoadingEl);
    }
  }
  return viewerLoadingEl;
}

function showViewerLoading() {
  const el = ensureViewerLoading();
  viewerLoadingCount++;
  el.classList.add("is-on");
}

function hideViewerLoading() {
  if (!viewerLoadingEl) return;
  viewerLoadingCount = Math.max(0, viewerLoadingCount - 1);
  if (viewerLoadingCount === 0) viewerLoadingEl.classList.remove("is-on");
}

/* -------------------------------------------------------
   Controls
------------------------------------------------------- */
function wireDocviewControls() {
  tagFilterSelect?.addEventListener("change", () => applyDocTagFilter(tagFilterSelect.value));
  tagFilterClear?.addEventListener("click", () => {
    if (tagFilterSelect) tagFilterSelect.value = "";
    applyDocTagFilter("");
    scrollToTop();
  });
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* -------------------------------------------------------
   Data load
------------------------------------------------------- */
async function loadDocviewData() {
  // Uploads
  const rows = await listUploads(state.caseId);
  state.uploadsIndex = rows || [];

  if (state.uploadsById && typeof state.uploadsById.clear === "function") {
    state.uploadsById.clear();
    state.uploadsIndex.forEach((r) => state.uploadsById.set(r.id, r));
  }

  if (docCount) {
    const n = state.uploadsIndex.length;
    docCount.textContent = `${n} file${n === 1 ? "" : "s"}`;
  }

  // Tags
  if (state.allTags && typeof state.allTags.clear === "function") state.allTags.clear();
  state.tagHits = [];

  const col = collection(db, "pageTags");
  const qRef = query(col, where("caseId", "==", state.caseId), limit(5000));
  const snap = await getDocs(qRef);
  snap.forEach((d) => {
    const row = d.data();
    if (row?.tag) {
      state.allTags?.add?.(row.tag);
      state.tagHits.push({ uploadId: row.uploadId, pageNumber: row.pageNumber, tag: row.tag });
    }
  });

  if (tagFilterSelect) {
    const current = tagFilterSelect.value || "";
    const options =
      `<option value="">All tags</option>` +
      Array.from(state.allTags || []).sort().map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    tagFilterSelect.innerHTML = options;
    if (current && state.allTags?.has?.(current)) tagFilterSelect.value = current;
  }

  renderFileList();
}

/* -------------------------------------------------------
   File list (left panel)
------------------------------------------------------- */
function renderFileList() {
  if (!docList) return;

  const files = state.uploadsIndex || [];
  docList.innerHTML = "";

  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No documents uploaded.";
    docList.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();

  files.forEach((f) => {
    const name = f.fileName || f.name || "(untitled)";
    const parts =
      Number(
        f.filePartsCount ??
          (Array.isArray(f.driveFileIds) ? f.driveFileIds.length : 1) ??
          1
      );
    const row = document.createElement("div");
    row.className = "doc-list-item";
    row.innerHTML = `
      <button class="doc-link" data-id="${escapeHtml(f.id)}">
        <div class="doc-file">${escapeHtml(name)}</div>
        <div class="doc-sub">
          ${escapeHtml((f.mimeType || f.fileType || "").replace(/^.*\//, "").toUpperCase() || "FILE")}
          ${f.size ? ` · ${prettyBytes(f.size)}` : ""}
          ${parts > 1 ? ` · ${parts} parts` : ""}
        </div>
      </button>
    `;
    row.querySelector(".doc-link")?.addEventListener("click", () => openDocViewer(f).catch((e) => {
      console.error("openDocViewer failed:", e);
      alert(e?.message || "Failed to open file.");
    }));
    frag.appendChild(row);
  });

  docList.appendChild(frag);
}

/* -------------------------------------------------------
   PDF.js loader
------------------------------------------------------- */
const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120";

async function loadPdfJsIfNeeded() {
  if (window.pdfjsLib?.getDocument) {
    if (!window.pdfjsLib.GlobalWorkerOptions?.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
    }
    return;
  }
  await loadScript(`${PDFJS_CDN}/pdf.min.js`);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
}

async function ensurePdfJsLocal() {
  // Kept for callers that specifically use this variant.
  await loadPdfJsIfNeeded();
  return window.pdfjsLib;
}

/* -------------------------------------------------------
   Open & render viewer (PDF multipart aware)
------------------------------------------------------- */
async function openDocViewer(uf) {
  if (!pdfStack) return;

  // Clear current view
  pdfStack.innerHTML = "";
  state.pageIndex?.clear?.();

  showViewerLoading();
  try {
    const pdfjsLib = await ensurePdfJsLocal();
    const driveIds = getDriveIds(uf);
    if (!Array.isArray(driveIds) || driveIds.length === 0) {
      console.warn("No Drive IDs to render.");
      return;
    }

    // Preload parts concurrently (stream through Netlify proxy if needed)
    const sources = driveIds.map((id) => streamFileUrl(id));
    const pdfDocs = await mapWithConcurrency(sources, 2, async (src) => pdfjsLib.getDocument(src).promise);

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

        const hdr = document.createElement("div");
        hdr.className = "doc-sub";
        hdr.textContent = `Page ${globalPageIdx}`;

        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "auto";

        const ctx = canvas.getContext("2d", { alpha: false });
        await page.render({ canvasContext: ctx, viewport }).promise;

        card.appendChild(hdr);
        card.appendChild(canvas);
        pdfStack.appendChild(card);

        state.pageIndex?.set?.(`${uf.id}:${globalPageIdx}`, card);
      }
    }
  } finally {
    hideViewerLoading();
  }
}

/* -------------------------------------------------------
   Canvas stack rendering (overview mode)
------------------------------------------------------- */
async function renderCanvasStack() {
  if (!pdfStack || !tagHitsWrap) return;
  pdfStack.hidden = false;
  tagHitsWrap.hidden = true;

  pdfStack.innerHTML = "";
  state.pageIndex?.clear?.();

  const uploads = state.uploadsIndex || [];
  if (!uploads.length) {
    pdfStack.innerHTML = `<div class="muted">No files uploaded yet.</div>`;
    return;
  }

  for (const u of uploads) {
    if (isPdf(u)) {
      await renderPdfFileAsCanvases(u);
    } else if (isImage(u)) {
      await renderImageFile(u);
    } else {
      const card = document.createElement("div");
      card.className = "pdf-block";
      card.innerHTML = `
        <div class="viewer-section"><h3>${escapeHtml(u.fileName || "(untitled)")}</h3></div>
        <div class="muted">Preview not available.</div>`;
      pdfStack.appendChild(card);
    }
  }
}

/* -------------------------------------------------------
   Per-file renderers
------------------------------------------------------- */
async function renderPdfFileAsCanvases(u) {
  const section = document.createElement("div");
  section.className = "pdf-block";
  const pagesWrap = document.createElement("div");
  section.appendChild(pagesWrap);
  pdfStack.appendChild(section);

  // Use proxy for PDF.js (bypass CORS)
  const url = `/.netlify/functions/file/${encodeURIComponent(u.driveFileId)}?proxy=1`;

  showViewerLoading();
  let pdf;
  try {
    await loadPdfJsIfNeeded();
    pdf = await window.pdfjsLib.getDocument({ url }).promise;
  } catch {
    pagesWrap.innerHTML = `<div class="muted">Failed to load PDF.</div>`;
    hideViewerLoading();
    return;
  }

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);

    const viewport0 = page.getViewport({ scale: 1 });
    const maxWidth = Math.min(pagesWrap.clientWidth || 1000, 1400);
    const cssScale = maxWidth / viewport0.width;
    const renderScale = cssScale * dpr;

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
    pageCard.appendChild(canvas);
    pagesWrap.appendChild(pageCard);

    state.pageIndex?.set?.(`${u.id}:${p}`, pageCard);
  }

  hideViewerLoading();
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

  img.src = `/.netlify/functions/file/${encodeURIComponent(u.driveFileId)}?proxy=1`;

  section.appendChild(img);
  pdfStack.appendChild(section);
  state.pageIndex?.set?.(`${u.id}:1`, section);
}

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */
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
  const el = state.pageIndex?.get?.(key1);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyDocTagFilter(tag) {
  if (!pdfStack || !tagHitsWrap) return;
  if (!tag) {
    Array.from(pdfStack.querySelectorAll(".page-card, img, .pdf-block")).forEach((el) => (el.style.display = ""));
    tagHitsWrap.hidden = true;
    pdfStack.hidden = false;
    return;
  }

  const allow = new Set(
    (state.tagHits || []).filter((h) => h.tag === tag).map((h) => `${h.uploadId}:${h.pageNumber}`)
  );

  let shown = 0;
  for (const [key, el] of (state.pageIndex || new Map()).entries()) {
    if (allow.has(key)) {
      el.style.display = "";
      shown++;
    } else {
      el.style.display = "none";
    }
  }

  if (shown === 0) {
    pdfStack.hidden = true;
    tagHitsWrap.hidden = false;
    tagHitsWrap.innerHTML = `<div class="muted">No pages tagged “${escapeHtml(tag)}”.</div>`;
  } else {
    tagHitsWrap.hidden = true;
    pdfStack.hidden = false;
    // Scroll to the first visible
    for (const [, el] of (state.pageIndex || new Map()).entries()) {
      if (el.style.display !== "none") {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
    }
  }
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function prettyBytes(bytes = 0) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/* -------------------------------------------------------
   Public entry
------------------------------------------------------- */
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
    showViewerLoading();
    await loadDocviewData();
    await renderCanvasStack();
    hideViewerLoading();
  }
}
