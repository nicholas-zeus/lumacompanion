// case-documents.js
// Logic for the "View Documents" tab

import { db } from "./firebase.js";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const state = {
  caseId: null,
  allUploads: [],
  filtered: [],
  active: null, // active file object
};

const els = {
  tab: null,
  list: null,         // #docs-list
  count: null,        // #docCount
  filter: null,       // #tagFilter (select or input)
  filterClear: null,  // #tagFilterClear (button)
  viewer: null,       // #doc-viewer (scrollable)
  openBtn: null,      // #doc-open (anchor/button)
  downloadBtn: null,  // #doc-download (anchor/button)
};

// --- Helpers ---------------------------------------------------------------

function ensurePdfJsLoaded() {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib && window.pdfjsLib.getDocument) return resolve();

    const s = document.createElement("script");
    // CDN version pinned; adjust if you prefer hosting locally
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      // set worker src (same CDN build)
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }
      resolve();
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function isPdf(mime) {
  return (mime || "").toLowerCase().includes("pdf");
}
function isImage(mime) {
  const m = (mime || "").toLowerCase();
  return m.includes("image/jpeg") || m.includes("image/png");
}

function driveViewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}
function driveDownloadUrl(fileId) {
  // Works for direct download; adjust if you proxy via your function
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

// Fit-to-width scale per page (keeps page-level scrolling)
function computeScaleForWidth(pdfPage, targetWidth) {
  const viewport = pdfPage.getViewport({ scale: 1 });
  return targetWidth / viewport.width;
}

// --- Rendering -------------------------------------------------------------

function renderList() {
  const list = els.list;
  list.innerHTML = "";
  const files = state.filtered;

  if (els.count) els.count.textContent = String(files.length);

  if (!files.length) {
    list.innerHTML = `<div class="empty">No documents.</div>`;
    return;
  }

  files.forEach((f, idx) => {
    const item = document.createElement("button");
    item.className = "doc-list-item";
    item.type = "button";
    item.dataset.index = String(idx);

    const tags = Array.isArray(f.tags) ? f.tags.join(", ") : "";
    const size = f.size ? ` • ${(f.size/1024/1024).toFixed(2)} MB` : "";

    item.innerHTML = `
      <div class="doc-name">${f.fileName || "(untitled)"}</div>
      <div class="doc-meta">${f.mimeType || ""}${size}</div>
      <div class="doc-tags">${tags}</div>
    `;

    item.addEventListener("click", () => selectFile(idx));
    list.appendChild(item);
  });
}

async function renderPdf(file) {
  await ensurePdfJsLoaded();

  const url = file.downloadUrl || driveDownloadUrl(file.fileId);
  els.viewer.innerHTML = ""; // clear previous content

  const containerWidth = els.viewer.clientWidth || els.viewer.getBoundingClientRect().width || 800;

  const loadingTask = window.pdfjsLib.getDocument(url);
  const pdf = await loadingTask.promise;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const scale = computeScaleForWidth(page, containerWidth - 16); // padding safety
    const viewport = page.getViewport({ scale });

    const pageCard = document.createElement("div");
    pageCard.className = "page-card";

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext("2d", { alpha: false });

    pageCard.appendChild(canvas);
    els.viewer.appendChild(pageCard);

    await page.render({ canvasContext: ctx, viewport }).promise;
  }
}

function renderImage(file) {
  const url = file.downloadUrl || driveDownloadUrl(file.fileId);
  els.viewer.innerHTML = "";

  const imgWrap = document.createElement("div");
  imgWrap.className = "image-block";

  const img = document.createElement("img");
  img.src = url;
  img.alt = file.fileName || "image";
  img.style.width = "100%";
  img.style.height = "auto";
  img.decoding = "async";
  img.loading = "lazy";

  imgWrap.appendChild(img);
  els.viewer.appendChild(imgWrap);
}

function renderUnsupported(file) {
  els.viewer.innerHTML = `
    <div class="unsupported">
      Preview not available for <b>${file.mimeType || "Unknown"}</b>.
    </div>
  `;
}

function updateActionButtons(file) {
  if (!els.openBtn || !els.downloadBtn) return;
  const viewUrl = file.viewUrl || driveViewUrl(file.fileId);
  const dlUrl = file.downloadUrl || driveDownloadUrl(file.fileId);

  if (els.openBtn.tagName === "A") els.openBtn.href = viewUrl;
  els.openBtn.onclick = () => window.open(viewUrl, "_blank");

  if (els.downloadBtn.tagName === "A") els.downloadBtn.href = dlUrl;
  els.downloadBtn.onclick = () => window.open(dlUrl, "_blank");
}

async function selectFile(index) {
  const file = state.filtered[index];
  if (!file) return;
  state.active = file;

  updateActionButtons(file);

  if (isPdf(file.mimeType)) {
    try {
      await renderPdf(file);
    } catch (e) {
      console.error("PDF render failed, falling back to Drive viewer:", e);
      // graceful fallback
      els.viewer.innerHTML = `<iframe class="pdf-fallback" src="${driveViewUrl(file.fileId)}" frameborder="0"></iframe>`;
    }
  } else if (isImage(file.mimeType)) {
    renderImage(file);
  } else {
    renderUnsupported(file);
  }

  // highlight selection
  [...els.list.querySelectorAll(".doc-list-item")].forEach((btn, i) => {
    btn.classList.toggle("active", i === index);
  });
}

// --- Filtering -------------------------------------------------------------

function applyFilter() {
  const val = (els.filter?.value || "").trim().toLowerCase();
  const base = state.allUploads;

  if (!val) {
    state.filtered = base.slice();
  } else {
    state.filtered = base.filter((f) => {
      // match in tags or filename
      const tags = (Array.isArray(f.tags) ? f.tags : []).map((t) => String(t).toLowerCase());
      const fn = String(f.fileName || "").toLowerCase();
      return tags.some((t) => t.includes(val)) || fn.includes(val);
    });
  }
  renderList();

  // auto-open first file in the filtered set
  if (state.filtered.length) selectFile(0);
  else {
    els.viewer.innerHTML = `<div class="empty">No documents match the filter.</div>`;
  }
}

// --- Data loading ----------------------------------------------------------

let unsubscribeUploads = null;

function listenUploads(caseId) {
  if (unsubscribeUploads) {
    unsubscribeUploads();
    unsubscribeUploads = null;
  }

  const qRef = query(
    collection(db, "uploads"),
    where("caseId", "==", caseId),
    orderBy("uploadedAt", "desc")
  );

  unsubscribeUploads = onSnapshot(qRef, (snap) => {
    const rows = [];
    snap.forEach((d) => {
      const r = d.data();
      // exclude soft-deleted
      if (r.deletedAt) return;

      // normalize URL fields if backend only gives fileId
      rows.push({
        id: d.id,
        fileId: r.fileId,
        fileName: r.fileName,
        mimeType: r.mimeType,
        size: r.size,
        tags: r.tags || [],
        viewUrl: r.viewUrl || null,
        downloadUrl: r.downloadUrl || null,
        uploadedAt: r.uploadedAt,
      });
    });

    state.allUploads = rows;
    applyFilter(); // renders list + first doc (if any)
  });
}

// --- Public init -----------------------------------------------------------

export function initDocuments(caseId) {
  state.caseId = caseId;

  els.tab = document.getElementById("tab-documents");
  els.list = document.getElementById("docs-list");
  els.count = document.getElementById("docCount");
  els.filter = document.getElementById("tagFilter");
  els.filterClear = document.getElementById("tagFilterClear");
  els.viewer = document.getElementById("doc-viewer");
  els.openBtn = document.getElementById("doc-open");
  els.downloadBtn = document.getElementById("doc-download");

  // listeners
  els.filter?.addEventListener("input", applyFilter);
  els.filterClear?.addEventListener("click", () => {
    if (els.filter) els.filter.value = "";
    applyFilter();
  });

  listenUploads(caseId);
}

// --- Tab hook --------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  const caseId = window.caseId;
  if (!caseId) return;

  const tab = document.getElementById("tab-documents");
  tab?.addEventListener("click", () => initDocuments(caseId));

  // If View tab is default active (optional)
  if (tab?.classList.contains("active")) {
    initDocuments(caseId);
  }
});
