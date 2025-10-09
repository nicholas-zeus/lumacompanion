import { state } from "/js/case-shared.js";
import { listUploads } from "/js/api.js";
import { collection, query, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "/js/firebase.js";
import { fab } from "/js/fab.js";

fab.useDocTop(() => window.scrollTo({ top: 0, behavior: "smooth" }));

const docList = document.getElementById("docList");
const docCount = document.getElementById("docCount");
const pdfStack = document.getElementById("pdfStack");
const tagHitsWrap = document.getElementById("tagHits");
const tagFilterSelect = document.getElementById("tagFilterSelect");
const tagFilterClear = document.getElementById("tagFilterClear");

let viewerLoadingEl;
let viewerLoadingCount = 0;

/* =========================================================
   Viewer loading overlay (single implementation)
   ========================================================= */
function showViewerLoading() {
  if (!viewerLoadingEl) {
    viewerLoadingEl = document.createElement("div");
    viewerLoadingEl.className = "viewer-loading";
    viewerLoadingEl.innerHTML = `<div class="spinner" aria-label="Loading…"></div>`;
    const viewerCard = pdfStack?.closest?.(".viewer-card") || pdfStack || document.body;
    if (viewerCard === document.body) {
      Object.assign((viewerLoadingEl.style), { position: "fixed", inset: "0", zIndex: "2000" });
    } else {
      viewerCard.style.position = viewerCard.style.position || "relative";
      Object.assign((viewerLoadingEl.style), { position: "absolute", inset: "0", zIndex: "10" });
    }
    viewerCard.appendChild(viewerLoadingEl);
  }
  viewerLoadingCount++;
  viewerLoadingEl.classList.add("is-on");
}
function hideViewerLoading() {
  viewerLoadingCount = Math.max(0, viewerLoadingCount - 1);
  if (viewerLoadingEl && viewerLoadingCount === 0) {
    viewerLoadingEl.classList.remove("is-on");
  }
}

/* =========================================================
   Tag filtering & list rendering
   ========================================================= */
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

async function loadDocviewData() {
  const rows = await listUploads(state.caseId);
  state.uploads = rows || [];
  docCount.textContent = state.uploads.length.toString();
  renderFileList();

  // optional: prefetch tag hits for this case (if used in your UI)
  state.allTags = new Set();
  state.tagHits = [];
  const q = query(
    collection(db, "caseTags"),
    where("caseId", "==", state.caseId),
    limit(500)
  );
  const snap = await getDocs(q);
  snap.forEach((d) => {
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

function applyDocTagFilter(tag = "") {
  state.activeTagFilter = tag || "";
  renderFileList();
}

function renderFileList() {
  if (!docList) return;
  const activeTag = (state.activeTagFilter || "").trim();
  const uploads = state.uploads || [];

  const withTag = activeTag
    ? uploads.filter(u => (state.tagHits || []).some(t => t.tag === activeTag && t.uploadId === u.id))
    : uploads;

  docList.innerHTML = withTag.map(u => {
    const isPdfFile = isPdf(u);
    const tags = (state.tagHits || []).filter(t => t.uploadId === u.id).map(t => t.tag);
    return `
      <li class="doc-row" data-id="${u.id}">
        <button class="doc-link" data-id="${u.id}" data-name="${escapeHtml(u.fileName || "")}">
          <span class="name">${escapeHtml(u.fileName || "(no name)")}</span>
          <span class="meta">
            ${isPdfFile ? "PDF" : (u.mimeType || u.fileType || "").split("/")[1] || "File"}
            · ${(u.size ? prettyBytes(u.size) : "")}
          </span>
        </button>
        ${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      </li>
    `;
  }).join("");

  docList.querySelectorAll(".doc-link").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      if (!id) return;
      openInViewer(id);
      scrollToTop();
    });
  });

  // Show tag hits (optional)
  if (tagHitsWrap) {
    const activeHits = (state.tagHits || []).filter(h => !activeTag || h.tag === activeTag);
    tagHitsWrap.innerHTML = activeHits.slice(0, 200).map(h =>
      `<button class="tag-hit" data-upload="${h.uploadId}" data-page="${h.pageNumber}">
         <span class="t">${escapeHtml(h.tag)}</span>
         <span class="p">p.${h.pageNumber}</span>
       </button>`
    ).join("");

    tagHitsWrap.querySelectorAll(".tag-hit").forEach(b => {
      b.addEventListener("click", async () => {
        const uploadId = b.getAttribute("data-upload");
        const page = parseInt(b.getAttribute("data-page") || "1", 10);
        if (!uploadId) return;
        await openInViewer(uploadId, { page });
        pdfStack?.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }
}

/* =========================================================
   Viewer rendering (PDF via pdf.js)
   ========================================================= */
async function openInViewer(uploadId, opts = {}) {
  if (!uploadId) return;
  const upload = (state.uploads || []).find(u => u.id === uploadId);
  if (!upload) return;

  if (!isPdf(upload)) {
    // non-PDF: just open in a new tab/window
    if (upload.webViewLink) window.open(upload.webViewLink, "_blank", "noopener");
    return;
  }

  showViewerLoading();
  try {
    await loadPdfJsIfNeeded();
    await renderPdfToStack(upload, opts);
  } finally {
    hideViewerLoading();
  }
}

function isPdf(u) {
  const n = (u.fileName || "").toLowerCase();
  const t = (u.mimeType || u.fileType || "").toLowerCase();
  return n.endsWith(".pdf") || t === "application/pdf";
}

async function renderPdfToStack(upload, opts = {}) {
  const { page: scrollToPage = 1 } = opts;
  if (!pdfStack) return;

  const src = choosePdfUrl(upload);
  if (!src) return;

  // clear stack
  pdfStack.innerHTML = "";

  const pdfjs = await loadPdfJsIfNeeded();
  const loadingTask = pdfjs.getDocument(src);
  const pdf = await loadingTask.promise;

  const scale = 1.2;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.dataset.page = String(p);
    canvas.className = "pdf-canvas";

    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    pdfStack.appendChild(canvas);
  }

  // Scroll to requested page if provided
  if (scrollToPage && scrollToPage > 0 && scrollToPage <= pdf.numPages) {
    const target = pdfStack.querySelector(`[data-page="${scrollToPage}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function choosePdfUrl(u) {
  // Prefer a restricted viewer link if available, else direct webContentLink, else webViewLink
  return u.webContentLink || u.webViewLink || u.previewLink || u.url || null;
}

/* =========================================================
   pdf.js loader
   ========================================================= */
const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120";

async function loadPdfJsIfNeeded() {
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

/* =========================================================
   Utilities
   ========================================================= */
function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}
function prettyBytes(bytes = 0) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B","KB","MB","GB","TB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/* =========================================================
   Public entry
   ========================================================= */
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
  } 
}

// Placeholder: if you have a separate canvas stack renderer, keep this.
// Otherwise, reuse renderPdfToStack after selecting a default PDF (if any).
async function renderCanvasStack() {
  const firstPdf = (state.uploads || []).find(isPdf);
  if (firstPdf) {
    await openInViewer(firstPdf.id);
  } else {
    pdfStack.innerHTML = `<div class="empty">No PDF files uploaded.</div>`;
  }
}
