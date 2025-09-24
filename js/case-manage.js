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

// --- State ---
let stagedFiles = [];       // [{ file }]
let uploadedFiles = [];     // [{ id, fileName, driveFileId, mimeType }]
let pageTags = new Map();   // key: `${fileId}:${pageNo}` → tag
let dirty = false;

// --- Utils ---
function markDirty(flag = true) {
  dirty = flag;
  saveSection.hidden = !dirty || isMobile();
  mobileSaveBtn.hidden = !dirty || !isMobile();
}
function isMobile() {
  return window.matchMedia("(max-width: 860px)").matches;
}
function confirmDelete(name) {
  return confirm(`Delete ${name}? This cannot be undone.`);
}

// --- Upload Section ---
function handleFiles(files) {
  for (const file of files) {
    stagedFiles.push({ file });
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

// --- Lists ---
function renderStagedList() {
  stagedList.innerHTML = "";
  stagedFiles.forEach((sf, idx) => {
    const div = document.createElement("div");
    div.className = "file-row";
    div.innerHTML = `<span class="file-name">${sf.file.name}</span>
                     <button class="trash">🗑</button>`;
    div.querySelector(".file-name").addEventListener("click", () => renderPreview(sf.file, `staged-${idx}`));
    div.querySelector(".trash").addEventListener("click", () => {
      if (confirmDelete(sf.file.name)) {
        stagedFiles.splice(idx, 1);
        renderStagedList();
        markDirty(true);
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
    div.innerHTML = `<span class="file-name">${uf.fileName}</span>
                     <button class="trash">🗑</button>`;
    div.querySelector(".file-name").addEventListener("click", () => renderPreview(uf, uf.id));
    div.querySelector(".trash").addEventListener("click", async () => {
      if (confirmDelete(uf.fileName)) {
        await hardDeleteFile(uf.id);
        await refreshUploadedList();
        markDirty(true);
      }
    });
    uploadedList.appendChild(div);
  });
}

// --- Preview ---
async function renderPreview(fileOrMeta, fileKey) {
  previewArea.innerHTML = "";
  state.pageIndex.clear();

  if (fileOrMeta instanceof File) {
    if (fileOrMeta.type.includes("pdf")) {
      await renderPdf(fileOrMeta, fileKey);
    } else if (fileOrMeta.type.startsWith("image/")) {
      renderImage(URL.createObjectURL(fileOrMeta), fileKey);
    } else {
      previewArea.innerHTML = `<div class="muted">Unsupported file type.</div>`;
    }
  } else {
    // uploaded meta
    const url = streamFileUrl(fileOrMeta.driveFileId);
    if ((fileOrMeta.mimeType || "").includes("pdf")) {
      await renderPdf(url, fileKey);
    } else if ((fileOrMeta.mimeType || "").startsWith("image/")) {
      renderImage(url, fileKey);
    } else {
      previewArea.innerHTML = `<div class="muted">Unsupported file type.</div>`;
    }
  }
}
async function renderPdf(source, fileKey) {
  const { pdfjsLib } = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument(source).promise;

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
    sel.value = pageTags.get(`${fileKey}:${p}`) || "";
    sel.addEventListener("change", () => {
      pageTags.set(`${fileKey}:${p}`, sel.value);
      markDirty(true);
    });

    wrapper.appendChild(sel);
    previewArea.appendChild(wrapper);
    state.pageIndex.set(`${fileKey}:${p}`, wrapper);
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
  state.pageIndex.set(`${fileKey}:1`, wrapper);
}

// --- Save ---
async function saveAll() {
  savingOverlay.classList.remove("hidden");

  // 1) Upload staged files
  for (const sf of stagedFiles) {
    const meta = await uploadFile({ file: sf.file, caseId: state.caseId, batchNo: 1 });
    // Save tags for this file
    const fileKey = meta.fileId;
    for (const [k, v] of pageTags.entries()) {
      if (k.startsWith(`staged-`)) continue;
      if (k.startsWith(`${fileKey}:`)) {
        const pageNo = parseInt(k.split(":")[1], 10);
        await setPageTag({ caseId: state.caseId, uploadId: fileKey, pageNumber: pageNo, tag: v });
      }
    }
  }

  // 2) Save tags for uploaded files
  for (const [k, v] of pageTags.entries()) {
    const [fid, pageNo] = k.split(":");
    if (fid.startsWith("staged-")) continue;
    await setPageTag({ caseId: state.caseId, uploadId: fid, pageNumber: parseInt(pageNo, 10), tag: v });
  }

  // 3) Reset
  stagedFiles = [];
  pageTags.clear();
  await refreshUploadedList();
  renderStagedList();
  previewArea.innerHTML = "";
  markDirty(false);
  savingOverlay.classList.add("hidden");
}

saveBtn.addEventListener("click", saveAll);
mobileSaveBtn.addEventListener("click", saveAll);

// --- Uploaded list refresh ---
async function refreshUploadedList() {
  uploadedFiles = await listUploads(state.caseId);
  renderUploadedList();
}

// --- Hard delete ---
async function hardDeleteFile(fileId) {
  const res = await fetch(`/.netlify/functions/file/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed");
}

// --- Sidebar toggle (mobile) ---
toggleSidebarBtn.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  document.body.classList.toggle("dimmed", sidebar.classList.contains("open"));
});

window.addEventListener("resize", () => markDirty(dirty));

// --- Init ---
refreshUploadedList();
renderStagedList();
