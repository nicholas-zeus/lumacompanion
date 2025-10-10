// case-manage.js
import { state } from "/js/case-shared.js";
import { uploadFile, listUploads, setPageTag, streamFileUrl } from "/js/api.js";
import { fab } from "/js/fab.js";
import { saveStagedFile } from "/js/uploader.js";
import { renderPdfWithTags /* existing */ } from "/js/tagging.js";
// We'll call renderMultipartPdfWithTags when we add it next.


// --- DOM ---
const fileInput     = document.getElementById("fileInput");
const uploadDrop    = document.getElementById("uploadDrop");
const stagedList    = document.getElementById("stagedList");
const uploadedList  = document.getElementById("uploadedList");
const previewArea   = document.getElementById("previewArea");
const saveSection   = document.getElementById("saveSection");
const saveBtn       = document.getElementById("saveBtn");
const savingOverlay = document.getElementById("savingOverlay");
// at top with other DOM nodes, if you actually have it in HTML
const bannerArea = document.getElementById("bannerArea");
// or simply remove `bannerArea,` from the saveStagedFile({ ... }) options

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
let __overlayCount = 0;

function ensurePreviewOverlay() {
  if (previewOverlay) return previewOverlay;
  previewOverlay = document.createElement("div");
  previewOverlay.id = "previewOverlay";
  Object.assign(previewOverlay.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(255,255,255,0.8)",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "2000",
  });

  const card = document.createElement("div");
  Object.assign(card.style, {
    background: "#fff",
    border: "1px solid var(--line)",
    borderRadius: "12px",
    padding: "16px 18px",
    boxShadow: "var(--shadow)",
    display: "grid",
    gap: "10px",
    justifyItems: "center",
  });

  const spinner = document.createElement("div");
  Object.assign(spinner.style, {
    width: "32px",
    height: "32px",
    border: "4px solid #ccc",
    borderTopColor: "var(--brand)",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  });

  const text = document.createElement("div");
  text.textContent = "Loading preview…";

  const style = document.createElement("style");
  style.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(style);

  card.appendChild(spinner);
  card.appendChild(text);
  previewOverlay.appendChild(card);
  document.body.appendChild(previewOverlay);
  return previewOverlay;
}

function showPreviewOverlay() {
  ensurePreviewOverlay();
  __overlayCount++;
  previewOverlay.style.display = "flex";
}
function hidePreviewOverlay() {
  __overlayCount = Math.max(0, __overlayCount - 1);
  if (!__overlayCount && previewOverlay) previewOverlay.style.display = "none";
}

async function openUploadedForTagging(uf) {
  // Clear previous preview
  previewArea.innerHTML = "";

  // Show the viewer loading overlay (you already style this)
  //ensurePreviewOverlay();
  showPreviewOverlay();
 

  try {
    const isMultipart = Number(uf.filePartsCount || 0) > 1;
    const driveFileIds = uf.driveFileIds || (uf.driveFileId ? [uf.driveFileId] : []);

    // Route to tagging renderer
    if (isMultipart && driveFileIds.length > 1) {
      // We'll add this in tagging.js next turn
      const { renderMultipartPdfWithTags } = await import("/js/tagging.js");
      await renderMultipartPdfWithTags({
        containerEl: previewArea,
        caseId: state.caseId,
        uploadId: uf.id,
        driveFileIds,
        onTagChange: (pageNumber, tag) => {
          // optional real-time tag write, or keep save-on-change behavior you already have
        },
      });
    } else {
      const firstId = driveFileIds[0];
      if (!firstId) {
        // Fallback: old schema might keep only "url" or older "id"
        console.warn("No drive file id; cannot render.");
        return;
      }
      await renderPdfWithTags({
        containerEl: previewArea,
        caseId: state.caseId,
        uploadId: uf.id,
        driveFileId: firstId,
        onTagChange: (pageNumber, tag) => {
    // keep an in-memory mirror if you like
    pageTags.set(`${uf.id}:${pageNumber}`, tag);
    markDirty(true);}
      });
    }
  } finally {
    hidePreviewOverlay();
  }
}


// --- Utils ---
function isMobile() {
  return window.matchMedia("(max-width: 860px)").matches;
}
// Replace your existing markDirty with this:
function markDirty(flag = true) {
  dirty = !!flag;

  const desktop = !isMobile();
  const _saveSection = saveSection || document.getElementById("saveSection");
  const _saveBtn = saveBtn || document.getElementById("saveBtn");

  if (desktop) {
    if (_saveSection) {
      // 👇 Clear the 'hidden' attribute so display rules can take effect
      _saveSection.hidden = false;
      _saveSection.style.display = dirty ? "" : "none";
    }
    if (_saveBtn) _saveBtn.disabled = !dirty;
  } else {
    // Mobile never shows inline bar
    if (_saveSection) {
      _saveSection.style.display = "none";
      // Keep it hidden on mobile to avoid flicker
      _saveSection.hidden = true;
    }
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
    // Normalized fields:
    const name = uf.fileName || uf.name || "(untitled)";
    const totalSize = uf.totalSize || uf.size || 0;
    const parts = Number(uf.filePartsCount || 1);

    const div = document.createElement("div");
    div.className = "file-row";
    div.innerHTML = `
      <span class="file-name" title="${name}">
        ${name}${parts > 1 ? ` <span class="muted">(${parts} parts)</span>` : ""}
      </span>
      <button class="trash" title="Remove from list">🗑</button>`;

    // Open for preview/tagging
    div.querySelector(".file-name").addEventListener("click", () => {
      openUploadedForTagging(uf).catch(err => {
        console.error("preview failed:", err);
        alert(err?.message || "Preview failed.");
      });
    });

    // Soft delete (Firestore row only — Drive cleanup handled by GAS later)
    div.querySelector(".trash").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Remove this document entry? Files on Drive will be cleaned up by your scheduled job.")) return;
      try {
        const { softDeleteUpload } = await import("/js/api.js");
        await softDeleteUpload(uf.id);
        await refreshUploadedList();
      } catch (err) {
        console.error("delete failed:", err);
        alert(err?.message || "Delete failed.");
      }
    });

    uploadedList.appendChild(div);
  });
}



// --- Preview (drop-in) ---
async function renderPreview(fileOrMeta, fileKey) {
  showPreviewOverlay();
  try {
    clearPreview();

    // STAGED file
    if (fileOrMeta instanceof File || fileOrMeta instanceof Blob) {
      const name = (fileOrMeta.name || "").toLowerCase();
      const type = (fileOrMeta.type || "").toLowerCase();

      if (type.includes("pdf") || name.endsWith(".pdf")) {
        await renderPdf(fileOrMeta, fileKey, null);  // pass File/Blob
      } else if (type.startsWith("image/")) {
        const url = URL.createObjectURL(fileOrMeta);
        renderImage(url, fileKey, null);
      } else {
        previewArea.innerHTML = `<div class="muted">Unsupported file type.</div>`;
      }
      return;
    }

    // EXISTING uploaded meta
    const altKey = fileOrMeta.driveFileId || null;
    if (isPdfMeta(fileOrMeta)) {
      const url = streamFileUrl(fileOrMeta.driveFileId);
      await renderPdf(url, fileKey, altKey);         // pass URL string
    } else if (isImageMeta(fileOrMeta)) {
      const url = streamFileUrl(fileOrMeta.driveFileId);
      renderImage(url, fileKey, altKey);
    } else {
      previewArea.innerHTML = `<div class="muted">Unsupported file type.</div>`;
    }
  } finally {
    hidePreviewOverlay();
  }
}

// --- PDF renderer with resilient staged-file support (drop-in) ---
async function renderPdf(source, fileKey, altKey) {
  await loadPdfJsIfNeeded();

  // ensure worker src is set (some builds race this)
  try {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      window.pdfjsLib.GlobalWorkerOptions.workerSrc ||
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
  } catch (_) {}

  // Build loading task:
  let loadingTask;

  // 1) Existing files: we pass a string URL
  if (typeof source === "string") {
    loadingTask = window.pdfjsLib.getDocument({ url: source });
  }

  // 2) Staged: File/Blob
  if (!loadingTask && (source instanceof File || source instanceof Blob)) {
    try {
      // First try raw bytes (fastest)
      const buf = await source.arrayBuffer();
      loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buf) });
    } catch (e) {
      console.warn("pdf.js bytes path failed, will try blob URL fallback:", e);
    }

    if (!loadingTask) {
      // Fallback: blob URL
      const blobUrl = URL.createObjectURL(source);
      loadingTask = window.pdfjsLib.getDocument({ url: blobUrl });
      // (Optional) revoke later after rendering completes
      loadingTask._revokeUrl = () => URL.revokeObjectURL(blobUrl);
    }
  }

  // 3) Raw ArrayBuffer (very rare)
  if (!loadingTask && (source instanceof ArrayBuffer)) {
    loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(source) });
  }

  if (!loadingTask) {
    throw new Error("Unsupported PDF source for renderPdf");
  }

  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    console.error("pdf.js getDocument failed:", err);
    previewArea.innerHTML = `<div class="muted">Unable to open PDF (staged). Try again or reselect the file.</div>`;
    try { loadingTask._revokeUrl?.(); } catch(_) {}
    return;
  }

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 0.5 }); // smaller than View tab
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

    // preselect using fileKey/altKey
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

  try { loadingTask._revokeUrl?.(); } catch(_) {}
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
function collectExistingTagChanges() {
  // keys look like "<key>:<page>", where key is either "staged-<n>" or an uploadId
  const changes = [];
  for (const [k, tag] of pageTags.entries()) {
    const [key, pStr] = k.split(":");
    const pageNumber = parseInt(pStr, 10);
    if (!pageNumber) continue;
    if (key.startsWith("staged-")) continue; // those will be handled when we save the staged file
    changes.push({ uploadId: key, pageNumber, tag });
  }
  return changes;
}

// --- Save flow ---
// --- Save flow (SPLIT PDF at SAVE time) ---
async function saveAll() {
  if (!state.caseId || state.isNew) {
    alert("Create/save the case first before uploading documents.");
    return;
  }

  // Work to do?
  const hasStaged = stagedFiles.length > 0;
  const tagOnlyChanges = collectExistingTagChanges();
  const hasTagOnly = tagOnlyChanges.length > 0;

  if (!hasStaged && !hasTagOnly) {
    // nothing to save
    return;
  }

  // Lock UI
  savingOverlay.classList.remove("hidden");
  saveBtn?.setAttribute("disabled", "disabled");

  try {
    // 1) Save staged uploads (your existing logic)
    for (const sf of stagedFiles) {
      const logical = await saveStagedFile({
        file: sf.file,
        caseId: state.caseId,
        batchNo: 1,
        bannerArea,
        onProgress: (pct) => { /* optional progress hook */ }
      });
      const newUploadId = logical.uploadId;

      // Move staged tag keys "staged-<n>:<page>" → "<uploadId>:<page>" and persist
      for (const [k, v] of [...pageTags.entries()]) {
        if (!k.startsWith(`${sf.key}:`)) continue;
        const pageNo = parseInt(k.split(":")[1], 10);
        await setPageTag({ caseId: state.caseId, uploadId: newUploadId, pageNumber: pageNo, tag: v });
        pageTags.delete(k);
        pageTags.set(`${newUploadId}:${pageNo}`, v);
      }
    }

    // 2) Save tag-only edits for existing uploads (this is the new bit)
    for (const { uploadId, pageNumber, tag } of tagOnlyChanges) {
      await setPageTag({ caseId: state.caseId, uploadId, pageNumber, tag });
    }

    // 3) Cleanup + refresh UI
    if (hasStaged) {
      stagedFiles = [];
      renderStagedList();
      await refreshUploadedList();
    }

    // Saved successfully → clear dirty
    markDirty(false);

    // (Optional) tiny “Saved” toast
    try {
      const toast = document.createElement("div");
      toast.textContent = "Saved";
      toast.style.cssText = "position:fixed;right:16px;bottom:16px;background:#111;color:#fff;padding:8px 12px;border-radius:8px;opacity:.95;z-index:3000";
      document.body.appendChild(toast);
      setTimeout(()=>toast.remove(), 1200);
    } catch {}
  } catch (err) {
    console.error("saveAll failed:", err);
    alert(err?.message || "Save failed.");
  } finally {
    savingOverlay.classList.add("hidden");
    saveBtn?.removeAttribute("disabled");
  }
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
