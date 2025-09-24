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
const sidebar          = document.getElementById("manageSidebar");

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
async function renderPreview(fileOrMeta, fileKey) {
  clearPreview();

  if (fileOrMeta instanceof File) {
    const type = (fileOrMeta.type || "").toLowerCase();
    if (type.includes("pdf")) {
      await renderPdf(fileOrMeta, fileKey);
    } else if (type.startsWith("image/")) {
      renderImage(URL.createObjectURL(fileOrMeta), fileKey);
    } else {
      previewArea.innerHTML = `<div class="muted">Unsupported file type.</div>`;
    }
  } else {
    // uploaded meta
    if (isPdfMeta(fileOrMeta)) {
      const url = streamFileUrl(fileOrMeta.driveFileId);
      await renderPdf(url, fileKey);
    } else if (isImageMeta(fileOrMeta)) {
      const url = streamFileUrl(fileOrMeta.driveFileId);
      renderImage(url, fileKey);
    } else {
      previewArea.innerHTML = `<div class="muted">Unsupported file type.</div>`;
    }
  }
}
async function renderPdf(source, fileKey) {
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
    sel.value = pageTags.get(`${fileKey}:${p}`) || "";
    sel.addEventListener("change", () => {
      pageTags.set(`${fileKey}:${p}`, sel.value);
      markDirty(true);
    });

    wrapper.appendChild(sel);
    previewArea.appendChild(wrapper);
    state.pageIndex?.set?.(`${fileKey}:${p}`, wrapper);
  }
}
function renderImage(url, fileKey) {
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
  sel.value = pageTags.get(`${fileKey}:1`) || "";
  sel.addEventListener("change", () => {
    pageTags.set(`${fileKey}:1`, sel.value);
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
toggleSidebarBtn.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  document.body.classList.toggle("dimmed", sidebar.classList.contains("open"));
});

// Re-evaluate which save control is visible on resize
window.addEventListener("resize", () => markDirty(dirty));

// --- Init: wait until caseId is known ---
document.addEventListener("caseLoaded", () => {
  refreshUploadedList();
  renderStagedList();
  markDirty(false); // both save controls start hidden
});
