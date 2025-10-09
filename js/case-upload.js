// case-upload.js
import { state } from "/js/case-shared.js";
import { uploadFile, listUploads, setPageTag, streamFileUrl, getTagOptions } from "/js/api.js";
import { renderLocalPdfWithTags } from "/js/tagging.js";

const fileInput     = document.getElementById("fileInput");
const uploadsList   = document.getElementById("uploadsList");
const pdfContainer  = document.getElementById("pdfContainer");
const tagFilterSel  = document.getElementById("tagFilter");
const tagFilterWrap = document.getElementById("tagFilterWrap");
const docSaveBtn    = document.getElementById("docSaveBtn");
const docCancelBtn  = document.getElementById("docCancelBtn");
const stagedInfo    = document.getElementById("stagedInfo");
const stagedName    = document.getElementById("stagedName");

function resetStaging() {
  state.stagedFile = null; state.stagedIsPdf = false;
  pdfContainer.className = "pdf-grid-empty";
  pdfContainer.innerHTML = "Select a PDF to preview & tag pages (will upload on Save).";
  docSaveBtn.disabled = true; docCancelBtn.disabled = true;
  stagedInfo.style.display = "none"; stagedName.textContent = "";
}
async function onFileChosen(file) {
  resetStaging();
  if (!file) return;

  state.stagedFile = file;
  stagedInfo.style.display = "";
  stagedName.textContent = file.name;

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    state.stagedIsPdf = true;
    pdfContainer.className = "pdf-grid";
    pdfContainer.innerHTML = "";
    await renderLocalPdfWithTags({ containerEl: pdfContainer, file, caseId: state.caseId, onTagChange: applyTagFilterUpload });
    const tags = await getTagOptions();
    tagFilterSel.innerHTML = `<option value="">All</option>` + tags.map(t => `<option>${t}</option>`).join("");
    tagFilterWrap.style.display = "";
    applyTagFilterUpload();
  } else {
    pdfContainer.className = "pdf-grid-empty";
    pdfContainer.innerHTML = "This file type does not support page tagging. Click Save to upload.";
  }

  docSaveBtn.disabled = false; docCancelBtn.disabled = false;
}
function applyTagFilterUpload() {
  const val = tagFilterSel.value || "";
  pdfContainer.querySelectorAll(".pdf-page").forEach(pg => {
    const sel = pg.querySelector(".tag-select");
    const t = sel?.value || "";
    pg.style.display = (!val || val === t) ? "" : "none";
  });
}
async function saveStagedDocument() {
  if (!state.stagedFile) return;

  const meta = await uploadFile({ file: state.stagedFile, caseId: state.caseId, batchNo: 1 });

  if (state.stagedIsPdf) {
    const pages = pdfContainer.querySelectorAll(".pdf-page");
    let pageNo = 0;
    for (const pg of pages) {
      pageNo++;
      const sel = pg.querySelector(".tag-select");
      const tag = sel?.value || "";
      if (tag) {
        await setPageTag({
          caseId: state.caseId,
          uploadId: meta.uploadId || meta.fileId || "",
          pageNumber: pageNo,
          tag
        });
      }
    }
  }

  resetStaging();
  if (fileInput) fileInput.value = "";
  await refreshUploadsList();
}

function renderUploadsList(rows) {
  uploadsList.innerHTML = "";
  rows.forEach(r => {
    const row = document.createElement("div");
    row.className = "upload-row";
    const link = document.createElement("a");
    link.href = streamFileUrl(r.driveFileId);
    link.target = "_blank";
    link.textContent = r.fileName;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = ` • ${r.mimeType || ""}`;
    row.appendChild(link); row.appendChild(meta);
    uploadsList.appendChild(row);
  });
}
async function refreshUploadsList() {
  if (!state.caseId || state.isNew) return;
  const rows = await listUploads(state.caseId);
  renderUploadsList(rows);
}

fileInput?.addEventListener("change", async (e) => {
  const file = (e.target.files || [])[0];
  await onFileChosen(file);
});
docCancelBtn?.addEventListener("click", (e) => { e.preventDefault(); resetStaging(); if (fileInput) fileInput.value = ""; });
docSaveBtn?.addEventListener("click", async (e) => { e.preventDefault(); await saveStagedDocument(); });

export { refreshUploadsList };
