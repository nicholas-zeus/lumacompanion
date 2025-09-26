// case-view.js
import { state } from "/js/case-shared.js";
import { listUploads, streamFileUrl } from "/js/api.js";
import { collection, query, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "/js/firebase.js";
import { fab } from "/js/fab.js";
// during docview init:
fab.useDocTop(() => window.scrollTo({ top: 0, behavior: "smooth" }));
const docList        = document.getElementById("docList");
const docCount       = document.getElementById("docCount");
const pdfStack       = document.getElementById("pdfStack");
const tagHitsWrap    = document.getElementById("tagHits");
const tagFilterSelect= document.getElementById("tagFilterSelect");
const tagFilterClear = document.getElementById("tagFilterClear");
/*function buildStickySidebar() {
  if (!document.getElementById("goTopBtn")) {
    const btn = document.createElement("button");
    btn.id = "goTopBtn";
    btn.className = "go-top-btn";
    btn.setAttribute("aria-label", "Go to top");
    btn.textContent = "↑";
    btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    document.body.appendChild(btn);
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
function scrollToTop() { window.scrollTo({ top: 0, behavior: "smooth" }); }

async function loadDocviewData() {
  const rows = await listUploads(state.caseId);
  state.uploadsIndex = rows;
  state.uploadsById.clear();
  rows.forEach(r => state.uploadsById.set(r.id, r));
  if (docCount) docCount.textContent = `${rows.length} file${rows.length===1?"":"s"}`;

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

  if (tagFilterSelect) {
    const current = tagFilterSelect.value || "";
    tagFilterSelect.innerHTML = `<option value="">All tags</option>` +
      Array.from(state.allTags).sort().map(t => `<option value="${t}">${t}</option>`).join("");
    if (current && state.allTags.has(current)) tagFilterSelect.value = current;
  }

  renderFileList();
}
function renderFileList() {
  if (!docList) return;
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
        ${(isPdf(u) || isImage(u)) ? ` · <a href="#" data-open="${u.id}">Open</a>` : ""}
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
    if (el.style.display !== "none") { el.scrollIntoView({ behavior: "smooth", block: "start" }); break; }
  }
}

export async function ensureDocviewLoaded() {
  if (!state.caseId || state.isNew) return;

  if (!state.docviewLoaded) {
    await loadPdfJsIfNeeded();
    await loadDocviewData();
    wireDocviewControls();
    // DO NOT call buildStickySidebar(); we use FAB ↑ instead
    await renderCanvasStack();
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
      renderImageFile(u);
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

  const url = streamFileUrl(u.driveFileId);
  let pdf;
  try { pdf = await window.pdfjsLib.getDocument(url).promise; }
  catch { pagesWrap.innerHTML = `<div class="muted">Failed to load PDF.</div>`; return; }

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport0 = page.getViewport({ scale: 1 });
    const maxWidth = Math.min(pagesWrap.clientWidth || 1000, 1400);
    const scale = maxWidth / viewport0.width;
    const viewport = page.getViewport({ scale: scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
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
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}
