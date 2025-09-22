// /js/tagging.js
import { getPageTagsForUpload, setPageTag, getTagOptions, streamFileUrl } from "/js/api.js";

/**
 * Renders PDF pages as canvases with a tag <select> per page.
 * Loads pdf.js lazily from CDN.
 *
 * containerEl: where to render
 * caseId, uploadId, driveFileId: ids
 * onTagChange?: (pageNumber, tag) => void
 */
export async function renderPdfWithTags({ containerEl, caseId, uploadId, driveFileId, onTagChange = () => {} }) {
  if (!containerEl) throw new Error("containerEl required");

  // Load pdf.js (v4)
  if (!globalThis.pdfjsLib) {
    await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.js");
  }
  const pdfjsLib = globalThis.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.js";

  containerEl.innerHTML = "";
  containerEl.classList.add("pdf-grid");

  const url = streamFileUrl(driveFileId);
  const pdf = await pdfjsLib.getDocument(url).promise;

  const [tagOptions, existingMap] = await Promise.all([
    getTagOptions(),
    getPageTagsForUpload(caseId, uploadId, pdf.numPages + 10)
  ]);

  // Prebuild <select> template
  const mkSelect = (pageNumber) => {
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

    const existing = existingMap.get(pageNumber) || "";
    sel.value = existing;
    sel.addEventListener("change", async () => {
      const tag = sel.value || null;
      await setPageTag({ caseId, uploadId, pageNumber, tag });
      onTagChange(pageNumber, tag);
    });
    return sel;
  };

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
    const select = mkSelect(pageNumber);
    footer.appendChild(label);
    footer.appendChild(select);

    wrapper.appendChild(canvas);
    wrapper.appendChild(footer);
    containerEl.appendChild(wrapper);
  }
}
