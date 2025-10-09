// /js/tagging.js
import { getPageTagsForUpload, setPageTag, getTagOptions, streamFileUrl } from "/js/api.js";

const CDN_BASE = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120";

async function ensurePdfJs() {
  if (globalThis.pdfjsLib) {
    if (!globalThis.pdfjsLib.GlobalWorkerOptions?.workerSrc) {
      globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = `${CDN_BASE}/pdf.worker.min.js`;
    }
    return globalThis.pdfjsLib;
  }
  await loadScript(`${CDN_BASE}/pdf.min.js`);
  const lib = globalThis.pdfjsLib;
  if (!lib) throw new Error("Failed to load pdf.js");
  lib.GlobalWorkerOptions.workerSrc = `${CDN_BASE}/pdf.worker.min.js`;
  return lib;
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/** Existing Drive file: clicking a file in the list opens this */
export async function renderPdfWithTags({ containerEl, caseId, uploadId, driveFileId, onTagChange = () => {} }) {
  const url = streamFileUrl(driveFileId);
  return renderPdfCommon({ containerEl, source: url, caseId, uploadId, onTagChange });
}

/** Local File before upload (staged) */
export async function renderLocalPdfWithTags({ containerEl, file, onTagChange = () => {} }) {
  const url = URL.createObjectURL(file);
  try {
    return await renderPdfCommon({ containerEl, source: url, onTagChange });
  } finally {
    // caller may revoke later
  }
}

async function renderPdfCommon({ containerEl, source, caseId, uploadId, onTagChange }) {
  if (!containerEl) throw new Error("containerEl required");
  const pdfjsLib = await ensurePdfJs();

  containerEl.innerHTML = "";
  containerEl.classList.add("pdf-grid"); // 1 column via CSS

  const pdf = await pdfjsLib.getDocument(source).promise;
  const tagOptions = await getTagOptions();

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
    sel.addEventListener("change", async () => {
      onTagChange(pageNumber, sel.value || null);
      // Auto-save for existing uploads
      if (caseId && uploadId) {
        await setPageTag({ caseId, uploadId, pageNumber, tag: sel.value || null });
      }
    });
    return sel;
  };

  const existingMap = (caseId && uploadId)
    ? await getPageTagsForUpload(caseId, uploadId, pdf.numPages + 10)
    : new Map();

  // high-res scale
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  const SCALE = 1.6 * DPR;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: SCALE });

    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    // Display size (CSS) — single column full width
    canvas.style.width = "100%";
    canvas.style.height = "auto";

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
// === NEW: Render a logical multi-part PDF as one continuous document with per-page tags ===
export async function renderMultipartPdfWithTags({
  containerEl,
  caseId,
  uploadId,
  driveFileIds = [],
  onTagChange = () => {}
}) {
  if (!containerEl) throw new Error("containerEl required");
  if (!Array.isArray(driveFileIds) || driveFileIds.length === 0) {
    throw new Error("driveFileIds[] required");
  }

  const pdfjsLib = await ensurePdfJs();

  // Reset container
  containerEl.innerHTML = "";
  containerEl.classList.add("pdf-grid"); // same layout as single-file

  // Pull tag options once
  const tagOptions = await getTagOptions();

  // mkSelect copy from single-file renderer, but uses global page numbers + existingMap
  const mkSelect = (globalPageNumber, existing = "") => {
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
    sel.addEventListener("change", async () => {
      onTagChange(globalPageNumber, sel.value || null);
      if (caseId && uploadId) {
        await setPageTag({ caseId, uploadId, pageNumber: globalPageNumber, tag: sel.value || null });
      }
    });
    return sel;
  };

  // We don't know total pages yet; fetch a generous cap of existing tags.
  // (Existing single-file flow uses pdf.numPages+10. Here we can safely over-fetch.)
  const existingMap = (caseId && uploadId)
    ? await getPageTagsForUpload(caseId, uploadId, 5000) // Map<number, string>
    : new Map();

  // Render parameters (match single-file style)
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  const SCALE = 1.6 * DPR;

  let globalPage = 0;

  // For each Drive part, load → render every page → append
  for (let partIdx = 0; partIdx < driveFileIds.length; partIdx++) {
    const driveFileId = driveFileIds[partIdx];
    const source = streamFileUrl(driveFileId); // existing helper
    const pdf = await pdfjsLib.getDocument(source).promise;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      globalPage += 1;

      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: SCALE });

      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page";

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      // Responsive display size (CSS)
      canvas.style.width = "100%";
      canvas.style.height = "auto";

      const renderTask = page.render({ canvasContext: ctx, viewport });
      await renderTask.promise;

      // footer with global page index + tag select
      const footer = document.createElement("div");
      footer.className = "pdf-footer";
      const label = document.createElement("span");
      label.className = "pdf-pg";
      label.textContent = `Page ${globalPage}`;

      const existingTag = existingMap.get(globalPage) || "";
      const select = mkSelect(globalPage, existingTag);

      footer.appendChild(label);
      footer.appendChild(select);

      wrapper.appendChild(canvas);
      wrapper.appendChild(footer);
      containerEl.appendChild(wrapper);
    }
  }
}
