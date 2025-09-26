// case-manage.js
import { state } from "/js/case-shared.js";
import { uploadFile, listUploads, setPageTag, streamFileUrl } from "/js/api.js";
import { fab } from "/js/fab.js";

// --- DOM ---
const fileInput     = document.getElementById("fileInput");
const uploadDrop    = document.getElementById("uploadDrop");
const stagedList    = document.getElementById("stagedList");
const uploadedList  = document.getElementById("uploadedList");
const previewArea   = document.getElementById("previewArea");
const saveSection   = document.getElementById("saveSection");
const saveBtn       = document.getElementById("saveBtn");
const savingOverlay = document.getElementById("savingOverlay");

// Use whichever id your HTML currently has for the Manage panel
const sidebar       = document.getElementById("managePanel");
const manageCloseBtn = document.getElementById("manageCloseBtn");

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

  const style = document.createElement("style");
  style.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(style);

  card.appendChild(spinner);
  card.appendChild(text);
  previewOverlay.appendChild(card);
  document.body.appendChild(previewOverlay);
}
function showPreviewOverlay() { ensurePreviewOverlay(); previewOverlay.style.display = "flex"; }
function hidePreviewOverlay() { if (previewOverlay) previewOverlay.style.display = "none"; }

// --- Utils ---
function isMobile() {
  return window.matchMedia("(max-width: 860px)").matches;
}
function markDirty(flag = true) {
  dirty = !!flag;

  // Desktop inline bar
  const desktop = !isMobile();
  const _saveSection = saveSection || document.getElementById("saveSection");
  const _saveBtn = saveBtn || document.getElementById("saveBtn");

  if (desktop) {
    if (_saveSection) _saveSection.style.display = dirty ? "" : "none";
    if (_saveBtn) _saveBtn.disabled = !dirty;
  } else {
    if (_saveSection) _saveSection.style.display = "none"; // never show inline on mobile
  }

  // Tell the shared FAB about dirty state (controls mobile Save FAB visibility)
  fab.setManageDirty(dirty);
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
  try {
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
  } catch (e) {
    console.warn("loadExistingTags skipped:", e);
  }
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
  // Modal confirm
  const confirmOverlay   = document.getElementById("confirmOverlay");
  const confirmMessage   = document.getElementById("confirmMessage");
  const confirmYes       = document.getElementById("confirmYes");
  const confirmNo        = document.getElementById("confirmNo");

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
      if (isMobile()) closeManageOverlay();   // close overlay on selection
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
  if (!uploadedFiles.length) {
    const div = document.createElement("div");
    div.className = "muted";
    div.style.padding = "6px";
    div.textContent = "No documents uploaded yet.";
    uploadedList.appendChild(div);
    return;
  }
  uploadedFiles.forEach((uf) => {
    const div = document.createElement("div");
    div.className = "file-row";
    div.innerHTML = `
      <span class="file-name">${uf.fileName || uf.name || "(untitled)"}</span>
      <button class="trash" title="Delete from Drive">🗑</button>`;
    div.querySelector(".file-name").addEventListener("click", () => {
      if (isMobile()) closeManageOverlay();
      const key = uf.id || uf.uploadId || uf.driveFileId;
      renderPreview(
        {
          ...uf,
          mimeType: uf.mimeType || uf.type || "",
          fileName: uf.fileName || uf.name || "",
        },
        key
      );
    });
    div.querySelector(".trash").addEventListener("click", async () => {
      const name = uf.fileName || uf.name || "(untitled)";
      const ok = await confirmUI(`Delete ${name}? This cannot be undone.`);
      if (ok) {
        await hardDeleteFile(uf); // pass the full object
        const fid = (uf.id || uf.uploadId || uf.driveFileId);
        for (const k of [...pageTags.keys()]) {
          if (k.startsWith(`${fid}:`)) pageTags.delete(k);
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
      const altKey = fileOrMeta.driveFileId || null; // fallback if pageTags used driveFileId
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
    const viewport = page.getViewport({ scale: 0.5 });
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

    const k1 = `${fileKey}:${p}`;
    const k2 = altKey ? `${altKey}:${p}` : null;
    sel.value = (pageTags.get(k1) ?? (k2 ? pageTags.get(k2) : "")) || "";

    sel.addEventListener("change", () => {
      pageTags.set(`${fileKey}:${p}`, sel.value);
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
    pageTags.set(`${fileKey}:1`, sel.value);
    markDirty(true);
  });
  wrapper.appendChild(sel);

  previewArea.appendChild(wrapper);
  state.pageIndex?.set?.(`${fileKey}:1`, wrapper);
}

// Create Firestore uploads doc and return its id
async function writeUploadMetadata({ meta, caseId, batchNo = 1 }) {
  const { db, auth } = await import("/js/firebase.js");
  const { collection, addDoc, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const upRef = await addDoc(collection(db, "uploads"), {
    caseId,
    batchNo,
    fileName: meta.fileName,
    fileType: meta.mimeType,
    size: meta.size,
    driveFileId: meta.fileId,
    fileHash: meta.md5,
    uploadedBy: {
      email: (auth.currentUser?.email || ""),
      displayName: (auth.currentUser?.displayName || "")
    },
    uploadedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return upRef.id; // Firestore document id (uploadId for tagging)
}

// --- Save flow ---
async function saveAll() {
  savingOverlay.classList.remove("hidden");

  // 1) Upload staged files + create Firestore metadata + save their tags
  for (const sf of stagedFiles) {
    const meta = await uploadFile({ file: sf.file, caseId: state.caseId, batchNo: 1 });
    const newUploadId = await writeUploadMetadata({ meta, caseId: state.caseId, batchNo: 1 });

    // move staged tag keys to the new upload id
    for (const [k, v] of [...pageTags.entries()]) {
      if (!k.startsWith(`${sf.key}:`)) continue;
      const pageNo = parseInt(k.split(":")[1], 10);
      await setPageTag({ caseId: state.caseId, uploadId: newUploadId, pageNumber: pageNo, tag: v });
      pageTags.delete(k);
      pageTags.set(`${newUploadId}:${pageNo}`, v);
    }
  }

  // 2) Overwrite tags for previously uploaded files we edited
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

// Desktop save button
saveBtn?.addEventListener("click", saveAll);

// --- Uploaded list refresh ---
async function refreshUploadedList() {
  if (!state.caseId || state.isNew) {
    uploadedFiles = [];
    renderUploadedList();
    return;
  }
  try {
    const data = await listUploads(state.caseId);
    uploadedFiles = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.files)
          ? data.files
          : [];
  } catch (e) {
    console.error("listUploads failed:", e);
    uploadedFiles = [];
  }
  renderUploadedList();
}

// --- Hard delete (Drive + Firestore metadata) ---
async function hardDeleteFile(uf) {
  // 1) Delete binary from Google Drive (Netlify function)
  const driveId = uf.driveFileId;
  if (!driveId) throw new Error("Missing driveFileId for deletion");
  const res = await fetch(`/.netlify/functions/file/${encodeURIComponent(driveId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed");

  // 2) Delete Firestore metadata row (uploads/{id}) — best-effort
  try {
    const uploadId = uf.id || uf.uploadId;
    if (uploadId) {
      const { db } = await import("/js/firebase.js");
      const { doc, deleteDoc } =
        await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      await deleteDoc(doc(db, "uploads", uploadId));
    }
  } catch (e) {
    console.warn("Metadata delete non-fatal:", e);
  }
}

// --- Overlay helpers (mobile) ---
function openManageOverlay(){
  if (!sidebar) return;
  sidebar.classList.add("open");
  document.body.classList.add("dimmed");
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
    sidebar.classList.remove("open");
    document.body.classList.remove("dimmed");
    const hdr = sidebar.querySelector(".sidebar-head");
    if (hdr) hdr.style.display = "block";
  } else {
    const hdr = sidebar.querySelector(".sidebar-head");
    if (hdr) hdr.style.display = "none";
    document.body.classList.remove("dimmed");
  }
}

// Inside overlay ✕ button
manageCloseBtn?.addEventListener("click", () => closeManageOverlay());

// Re-evaluate layout & save controls on resize
window.addEventListener("resize", () => {
  applyManagePanelLayout();
  markDirty(dirty);
  fab.setManageDirty(dirty);
});

// --- Init: wait until caseId is known ---

document.addEventListener("caseLoaded", async () => {
  // Ensure FABs exist; do NOT change the active FAB tab here.
  fab.init?.();

  applyManagePanelLayout();

  // Preload existing page tags so dropdowns preselect
  try { await loadExistingTags(); } catch (e) { console.warn("loadExistingTags failed:", e); }

  // Sync lists
  await refreshUploadedList();
  renderStagedList();

  // Reset dirty state (Manage save FAB should appear only when there are changes)
  markDirty(false);

  // Wire Manage FAB actions (no tab switch)
  fab.setManageToggle(() => {
    if (!isMobile()) return; // desktop: no-op
    if (sidebar.classList.contains("open")) closeManageOverlay();
    else openManageOverlay();
  });
  fab.setManageSave(() => saveAll());

  // Reflect current dirty state in Manage FAB (safe even if another tab is active)
  fab.setManageDirty(!!dirty);
});
// Close overlay if user taps outside the panel (mobile only)
document.addEventListener("click", (e) => {
  if (!isMobile()) return;
  if (!sidebar) return;
  if (!sidebar.classList.contains("open")) return;

  // ignore clicks inside the panel or on FABs
  const clickedInsidePanel = sidebar.contains(e.target);
  const clickedOnFAB = !!e.target.closest?.("#fab-manage-toggle, #fab-manage-save");
  if (!clickedInsidePanel && !clickedOnFAB) closeManageOverlay();
}, true);
