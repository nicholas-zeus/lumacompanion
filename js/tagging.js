// /js/tagging.js
import { getPageTagsForUpload, setPageTag, getTagOptions, streamFileUrl } from "/js/api.js";

/**
 * For existing Drive file: same as before (used when clicking an uploaded PDF).
 */
export async function renderPdfWithTags({ containerEl, caseId, uploadId, driveFileId, onTagChange = () => {} }) {
  const url = streamFileUrl(driveFileId);
  return renderPdfCommon({ containerEl, source: url, caseId, uploadId, onTagChange });
}

/**
 * NEW: For a local File (before upload). Returns nothing; you can read the
 * selected tags later by querying .pdf-page .tag-select values.
 */
export async function renderLocalPdfWithTags({ containerEl, file, onTagChange = () => {} }) {
  const url = URL.createObjectURL(file);
  try {
    return await renderPdfCommon({ containerEl, source: url, onTagChange });
  } finally {
    // revoke when you navigate away or after save if you want
    // URL.revokeObjectURL(url) — done by caller after Save/Discard.
  }
}

async function renderPdfCommon({ containerEl, source, caseId, uploadId, onTagChange }) {
  if (!containerEl) throw new Error("containerEl required");

  // Load pdf.js (v4)
  if (!globalThis.pdfjsLib) {
    await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js");
    //https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js
  }
  const pdfjsLib = globalThis.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";

  containerEl.innerHTML = "";
  containerEl.classList.add("pdf-grid");

  const pdf = await pdfjsLib.getDocument(source).promise;

  const tagOptions = await getTagOptions();
  // Prebuild <select> template
  const mkSelect = (pageNumber, existing = "") => {
    const sel = document.createElement("select");
    sel.className = "tag-select";
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = "— tag —";
    sel.appendChild(emptyOpt);

    tagOptions.forEach(t => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      sel.appendChild(o);
    });

    sel.value = existing || "";
    sel.addEventListener("change", () => onTagChange(pageNumber, sel.value || null));
    return sel;
  };

  // If this is an already-uploaded file, hydrate existing tags
  const existingMap = (caseId && uploadId)
    ? await getPageTagsForUpload(caseId, uploadId, pdf.numPages + 10)
    : new Map();

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 0.9 });

    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;

    const footer = document.createElement("div");
    footer.className = "pdf-footer";
    const label = document.createElement("span");
    label.className = "pdf-pg";
    label.textContent = `Page ${pageNumber}`;

    const select = mkSelect(pageNumber, existingMap.get(pageNumber) || "");
    footer.appendChild(label);
    footer.appendChild(select);

    wrapper.appendChild(canvas);
    wrapper.appendChild(footer);
    containerEl.appendChild(wrapper);
  }
}
