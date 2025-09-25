// case-manage.js
import { state } from "/js/case-shared.js";
import { uploadFile, listUploads, setPageTag, streamFileUrl } from "/js/api.js";

// --- DOM ---
const fileInput        = document.getElementById("fileInput");
const uploadDrop       = document.getElementById("uploadDrop");
const stagedList       = document.getElementById("stagedList");
const uploadedList     = document.getElementById("uploadedList");
const previewArea      = document.getElementById("previewArea");
const saveSection      = document.getElementById("saveSection");
const saveBtn          = document.getElementById("saveBtn");
const savingOverlay    = document.getElementById("savingOverlay");
const toggleSidebarBtn = document.getElementById("toggleSidebarBtn");
const mobileSaveBtn    = document.getElementById("mobileSaveBtn");
// Use whichever id your HTML currently has
const sidebar = document.getElementById("managePanel");
const manageCloseBtn = document.getElementById("manageCloseBtn");

// Inline-style the Manage sidebar for mobile/desktop (no CSS dependency)
function applySidebarInlineStyles(forceClose = false) {
  if (!sidebar) return;

  const mobile = isMobile();
  if (mobile) {
    // Start closed unless explicitly opened
    const opened = !forceClose && sidebar.dataset.open === "1";

    sidebar.style.position = "fixed";
    sidebar.style.left = "0";
    sidebar.style.right = "0";
    sidebar.style.bottom = "0";
    sidebar.style.background = "#fff";
    sidebar.style.borderTop = "1px solid var(--line)";
    sidebar.style.maxHeight = "60%";
    sidebar.style.overflow = "auto";
    sidebar.style.transition = "transform .25s ease, visibility 0s linear .25s";
    sidebar.style.zIndex = "999";

    sidebar.style.transform = opened ? "translateY(0)" : "translateY(100%)";
    sidebar.style.visibility = opened ? "visible" : "hidden";
    sidebar.style.pointerEvents = opened ? "auto" : "none";

    // Dim background when opened
    document.body.classList.toggle("dimmed", opened);
  } else {
    // Desktop: classic sticky visible sidebar
    sidebar.removeAttribute("data-open");
    sidebar.style.position = "sticky";
    sidebar.style.top = "12px";
    sidebar.style.alignSelf = "start";
    sidebar.style.maxHeight = "calc(100vh - 24px)";
    sidebar.style.overflow = "auto";
    sidebar.style.transform = "none";
    sidebar.style.visibility = "visible";
    sidebar.style.pointerEvents = "auto";
    sidebar.style.zIndex = ""; // reset
    document.body.classList.remove("dimmed");
  }
}
function isMobile(){ return window.matchMedia("(max-width: 860px)").matches; }

function openManageOverlay(){
  if (!sidebar) return;
  sidebar.classList.add("open");
  document.body.classList.add("dimmed");
  // show the mobile header (✕) if present
  const hdr = sidebar.querySelector(".sidebar-head");
  if (hdr) hdr.style.display = "block";
}
function closeManageOverlay(){
  if (!sidebar) return;
  sidebar.classList.remove("open");
  document.body.classList.remove("dimmed");
}

function applyManagePanelLayout(){
  if (!sidebar) return;
  if (isMobile()){
    // start hidden as overlay
    sidebar.classList.remove("open");
    document.body.classList.remove("dimmed");
    const hdr = sidebar.querySelector(".sidebar-head");
    if (hdr) hdr.style.display = "block";
  } else {
    // desktop sticky, ensure visible and header hidden
    const hdr = sidebar.querySelector(".sidebar-head");
    if (hdr) hdr.style.display = "none";
    document.body.classList.remove("dimmed");
  }
}


// Modal confirm
const confirmOverlay   = document.getElementById("confirmOverlay");
const confirmMessage   = document.getElementById("confirmMessage");
const confirmYes       = document.getElementById("confirmYes");
const confirmNo        = document.getElementById("confirmNo");

// --- State ---
let stagedFiles = [];       // [{ file, key }]
let uploadedFiles = [];     // [{ id, fileName, driveFileId, mimeType }]
let pageTags = new Map();   // key: `${fileKey}:${pageNo}` → tag
let dirty = false;
let stagedCounter = 0;      // stable keys for staged items
// --- Preview loading overlay (Manage tab only) ---
let previewOverlay;
function ensurePreviewOverlay() {
  if (previewOverlay) return;
  previewOverlay = document.createElement("div");
  previewOverlay.id = "previewOverlay";
  previewOverlay.style.position = "fixed";
  previewOverlay.style.inset = "0";
  previewOverlay.style.background = "rgba(255,255,255,0.8)";
  previewOverlay.style.display = "none";
  previewOverlay.style.alignItems = "center";
  previewOverlay.style.justifyContent = "center";
  previewOverlay.style.zIndex = "1000";

  const card = document.createElement("div");
  card.style.background = "#fff";
  card.style.border = "1px solid var(--line)";
  card.style.borderRadius = "12px";
  card.style.padding = "16px 18px";
  card.style.boxShadow = "var(--shadow)";
  card.style.display = "grid";
  card.style.gap = "10px";
  card.style.justifyItems = "center";

  const spinner = document.createElement("div");
  spinner.style.width = "32px";
  spinner.style.height = "32px";
  spinner.style.border = "4px solid #ccc";
  spinner.style.borderTopColor = "var(--brand)";
  spinner.style.borderRadius = "50%";
  spinner.style.animation = "spin 1s linear infinite";

  const text = document.createElement("div");
  text.textContent = "Loading preview…";

  // minimal keyframes (scoped)
  const style = document.createElement("style");
  style.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(style);

  card.appendChild(spinner);
  card.appendChild(text);
  previewOverlay.appendChild(card);
  document.body.appendChild(previewOverlay);
}
function showPreviewOverlay() {
  ensurePreviewOverlay();
  previewOverlay.style.display = "flex";
}
function hidePreviewOverlay() {
  if (previewOverlay) previewOverlay.style.display = "none";
}

// --- Utils ---
function isMobile() {
  return window.matchMedia("(max-width: 860px)").matches;
}
function markDirty(flag = true) {
  dirty = !!flag;
  if (isMobile()) {
    saveSection.hidden = true;          // never show sidebar Save on mobile
    mobileSaveBtn.hidden = !dirty;      // show floppy only when dirty
  } else {
    saveSection.hidden = !dirty;        // show desktop Save only when dirty
    mobileSaveBtn.hidden = true;
  }
}
function clearPreview() {
  previewArea.innerHTML = "";
  state.pageIndex?.clear?.();
}
function extFromName(name = "") {
  const n = name.toLowerCase();
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i + 1) : "";
}

// Load existing page tags for this case so previews can preselect dropdowns
async function loadExistingTags() {
  pageTags.clear();
  if (!state.caseId || state.isNew) return;

  // Lazy import Firestore only when needed
  const { db } = await import("/js/firebase.js");
  const { collection, query, where, limit, getDocs } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const col = collection(db, "pageTags");
  const qRef = query(col, where("caseId", "==", state.caseId), limit(5000));
  const snap = await getDocs(qRef);

  snap.forEach(d => {
    const r = d.data();
    const fid = r.uploadId;
    const pno = r.pageNumber;
    const tag = r.tag || "";
    if (fid && pno) pageTags.set(`${fid}:${pno}`, tag);
  });
}


function isPdfMeta(meta) {
  const mt = (meta?.mimeType || meta?.fileType || "").toLowerCase();
  const ex = extFromName(meta?.fileName);
  return mt.includes("application/pdf") || ex === "pdf";
}
function isImageMeta(meta) {
  const mt = (meta?.mimeType || meta?.fileType || "").toLowerCase();
  const ex = extFromName(meta?.fileName);
  return mt.startsWith("image/") || ["jpg","jpeg","png","gif","webp"].includes(ex);
}
function confirmUI(msg) {
  return new Promise((resolve) => {
    confirmMessage.textContent = msg;
    confirmOverlay.classList.remove("hidden");
    const close = (val) => { confirmOverlay.classList.add("hidden"); resolve(val); };
    const onYes = () => close(true);
    const onNo  = () => close(false);
    confirmYes.onclick = onYes;
    confirmNo.onclick  = onNo;
    confirmOverlay.onclick = (e) => { if (e.target === confirmOverlay) onNo(); };
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { document.removeEventListener("keydown", esc); onNo(); }
    }, { once: true });
  });
}

// --- PDF.js loader (same approach as View tab) ---
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

// --- Upload Section ---
function handleFiles(files) {
  for (const file of files) {
    stagedFiles.push({ file, key: `staged-${stagedCounter++}` });
  }
  renderStagedList();
  markDirty(true);
}
uploadDrop.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  handleFiles(Array.from(e.target.files));
  fileInput.value = "";
});
uploadDrop.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadDrop.classList.add("dragging");
});
uploadDrop.addEventListener("dragleave", () => uploadDrop.classList.remove("dragging"));
uploadDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadDrop.classList.remove("dragging");
  handleFiles(Array.from(e.dataTransfer.files));
});

// --- Lists (staged + uploaded) ---
function renderStagedList() {
  stagedList.innerHTML = "";
  stagedFiles.forEach((sf, idx) => {
    const div = document.createElement("div");
    div.className = "file-row";
    div.innerHTML = `
      <span class="file-name">${sf.file.name}</span>
      <button class="trash" title="Remove">🗑</button>`;
    div.querySelector(".file-name").addEventListener("click", () => {
      renderPreview(sf.file, sf.key);
    });
    div.querySelector(".trash").addEventListener("click", async () => {
      const ok = await confirmUI(`Remove ${sf.file.name} from staging?`);
      if (ok) {
        for (const k of [...pageTags.keys()]) {
          if (k.startsWith(`${sf.key}:`)) pageTags.delete(k);
        }
        stagedFiles.splice(idx, 1);
        renderStagedList();
        markDirty(stagedFiles.length > 0 || pageTags.size > 0);
        if (!stagedFiles.length) clearPreview();
      }
    });
    stagedList.appendChild(div);
  });
}
function renderUploadedList() {
  uploadedList.innerHTML = "";
  uploadedFiles.forEach((uf) => {
    const div = document.createElement("div");
    div.className = "file-row";
    div.innerHTML = `
      <span class="file-name">${uf.fileName}</span>
      <button class="trash" title="Delete from Drive">🗑</button>`;
    div.querySelector(".file-name").addEventListener("click", () => {
      renderPreview(uf, uf.id);
    });
    div.querySelector(".trash").addEventListener("click", async () => {
      const ok = await confirmUI(`Delete ${uf.fileName}? This cannot be undone.`);
      if (ok) {
        await hardDeleteFile(uf.id);
        for (const k of [...pageTags.keys()]) {
          if (k.startsWith(`${uf.id}:`)) pageTags.delete(k);
        }
        await refreshUploadedList();
        markDirty(true);
        clearPreview();
      }
    });
    uploadedList.appendChild(div);
  });
}

// --- Preview ---
// --- Preview ---
// --- Preview ---
async function renderPreview(fileOrMeta, fileKey) {
  showPreviewOverlay();
  try {
    clearPreview();

    if (fileOrMeta instanceof File) {
      const type = (fileOrMeta.type || "").toLowerCase();
      if (type.includes("pdf")) {
        await renderPdf(fileOrMeta, fileKey, null);
      } else if (type.startsWith("image/")) {
        renderImage(URL.createObjectURL(fileOrMeta), fileKey, null);
      } else {
        previewArea.innerHTML = `<div class="muted">Unsupported file type.</div>`;
      }
    } else {
      // uploaded meta
      const altKey = fileOrMeta.driveFileId || null; // fallback if pageTags use driveFileId
      if (isPdfMeta(fileOrMeta)) {
        const url = streamFileUrl(fileOrMeta.driveFileId);
        await renderPdf(url, fileKey, altKey);
      } else if (isImageMeta(fileOrMeta)) {
        const url = streamFileUrl(fileOrMeta.driveFileId);
        renderImage(url, fileKey, altKey);
      } else {
        previewArea.innerHTML = `<div class="muted">Unsupported file type.</div>`;
      }
    }
  } finally {
    hidePreviewOverlay();
  }
}

async function renderPdf(source, fileKey, altKey) {
  await loadPdfJsIfNeeded();
  const pdf = await window.pdfjsLib.getDocument(source).promise;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 0.5 }); // smaller than view tab
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const wrapper = document.createElement("div");
    wrapper.className = "thumb-card";
    wrapper.appendChild(canvas);

    const sel = document.createElement("select");
    sel.innerHTML = `<option value="">— tag —</option>
      <option>progress note</option>
      <option>vital chart</option>
      <option>doctor order</option>
      <option>lab tests</option>
      <option>medical questionnaire</option>`;

    // preselect: prefer `${fileKey}:${p}`; fallback `${altKey}:${p}` if provided
    const k1 = `${fileKey}:${p}`;
    const k2 = altKey ? `${altKey}:${p}` : null;
    sel.value = (pageTags.get(k1) ?? (k2 ? pageTags.get(k2) : "")) || "";

    sel.addEventListener("change", () => {
      pageTags.set(`${fileKey}:${p}`, sel.value); // always normalize to the main fileKey
      markDirty(true);
    });

    wrapper.appendChild(sel);
    previewArea.appendChild(wrapper);
    state.pageIndex?.set?.(`${fileKey}:${p}`, wrapper);
  }
}

function renderImage(url, fileKey, altKey) {
  const wrapper = document.createElement("div");
  wrapper.className = "thumb-card";
  const img = document.createElement("img");
  img.src = url;
  wrapper.appendChild(img);

  const sel = document.createElement("select");
  sel.innerHTML = `<option value="">— tag —</option>
    <option>progress note</option>
    <option>vital chart</option>
    <option>doctor order</option>
    <option>lab tests</option>
    <option>medical questionnaire</option>`;

  const k1 = `${fileKey}:1`;
  const k2 = altKey ? `${altKey}:1` : null;
  sel.value = (pageTags.get(k1) ?? (k2 ? pageTags.get(k2) : "")) || "";

  sel.addEventListener("change", () => {
    pageTags.set(`${fileKey}:1`, sel.value); // normalize to main key
    markDirty(true);
  });
  wrapper.appendChild(sel);

  previewArea.appendChild(wrapper);
  state.pageIndex?.set?.(`${fileKey}:1`, wrapper);
}


// --- Save flow ---
async function saveAll() {
  savingOverlay.classList.remove("hidden");

  // 1) Upload staged files + save their tags
  for (const sf of stagedFiles) {
    const meta = await uploadFile({ file: sf.file, caseId: state.caseId, batchNo: 1 });
    const newId = meta.fileId || meta.uploadId || meta.id;

    // move staged key tags → real uploadId tags and write
    for (const [k, v] of [...pageTags.entries()]) {
      if (k.startsWith(`${sf.key}:`)) {
        const pageNo = parseInt(k.split(":")[1], 10);
        await setPageTag({ caseId: state.caseId, uploadId: newId, pageNumber: pageNo, tag: v });
        pageTags.delete(k);
        pageTags.set(`${newId}:${pageNo}`, v);
      }
    }
  }

  // 2) Overwrite tags for all uploaded files we have edits for
  for (const [k, v] of pageTags.entries()) {
    const [fid, pageNoStr] = k.split(":");
    if (fid.startsWith("staged-")) continue;
    const pageNo = parseInt(pageNoStr, 10);
    await setPageTag({ caseId: state.caseId, uploadId: fid, pageNumber: pageNo, tag: v });
  }

  // 3) Reset + refresh
  stagedFiles = [];
  pageTags.clear();
  await refreshUploadedList();
  renderStagedList();
  clearPreview();
  markDirty(false);
  savingOverlay.classList.add("hidden");
}

saveBtn.addEventListener("click", saveAll);
mobileSaveBtn.addEventListener("click", saveAll);

// --- Uploaded list refresh ---
async function refreshUploadedList() {
  if (!state.caseId || state.isNew) return;
  uploadedFiles = await listUploads(state.caseId);
  renderUploadedList();
}

// --- Hard delete (Drive) ---
async function hardDeleteFile(fileId) {
  const res = await fetch(`/.netlify/functions/file/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed");
}

// --- Sidebar toggle (mobile) ---
// --- Sidebar toggle (mobile) ---
// Floating ^ button toggles overlay on mobile (no-op on desktop)
toggleSidebarBtn.addEventListener("click", () => {
  if (!isMobile()) return;            // desktop: ignore
  if (sidebar.classList.contains("open")) closeManageOverlay();
  else openManageOverlay();
});

// Inside overlay ✕ button
manageCloseBtn.addEventListener("click", () => closeManageOverlay());


// Re-evaluate which save control is visible on resize
// Re-evaluate layout on resize; close drawer when switching to mobile
window.addEventListener("resize", () => {
  applyManagePanelLayout();
  markDirty(dirty); // keep save controls correct
});


// --- Init: wait until caseId is known ---
// --- Init: wait until caseId is known ---
// --- Init: wait until caseId is known ---
document.addEventListener("caseLoaded", async () => {
  applyManagePanelLayout();          // set correct starting state
  // (Optional) if you implemented loadExistingTags earlier, call it here:
  // await loadExistingTags();

  await refreshUploadedList();
  renderStagedList();
  markDirty(false);                  // 💾 FAB only when dirty
});



