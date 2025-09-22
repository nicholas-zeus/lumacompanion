// /js/uploader.js
import { uploadFile, listUploads, streamFileUrl, softDeleteUpload } from "/js/api.js";

function formatBytes(n) {
  if (!n && n !== 0) return "—";
  const k = 1024;
  if (n < k) return `${n} B`;
  const units = ["KB","MB","GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(k)));
  return (n / Math.pow(k, i + 1)).toFixed(1) + " " + units[i];
}

/** Render a persistent duplicate banner with copy buttons for caseIds */
export function renderDuplicateBanner(bannerArea, dupCases = []) {
  if (!bannerArea || !dupCases.length) return;
  const div = document.createElement("div");
  div.className = "banner";
  const label = document.createElement("div");
  label.innerHTML = `<strong>Duplicate file detected in other case(s):</strong>`;
  div.appendChild(label);

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexWrap = "wrap";
  list.style.gap = "8px";

  dupCases.forEach(({ caseId }) => {
    const chip = document.createElement("div");
    chip.innerHTML = `<span class="mono">${caseId}</span> `;
    const btn = document.createElement("button");
    btn.className = "copy";
    btn.textContent = "Copy";
    btn.addEventListener("click", () => navigator.clipboard.writeText(caseId));
    const wrap = document.createElement("span");
    wrap.appendChild(chip);
    wrap.appendChild(btn);
    list.appendChild(wrap);
  });

  div.appendChild(list);
  bannerArea.appendChild(div);
}

/**
 * Initialize uploader wiring.
 * Expects:
 *  - fileInput: <input type="file" multiple>
 *  - listContainer: element to render uploaded files (simple list)
 *  - bannerArea: where duplicate warnings persist
 *  - caseId: current case id
 *  - getBatchNo: () => number (optional; defaults to 1)
 *  - onUploaded: (meta) => void (optional)
 */
export function initUploader({ fileInput, listContainer, bannerArea, caseId, getBatchNo = () => 1, onUploaded = () => {} }) {
  if (!fileInput) throw new Error("fileInput required");
  const refreshList = async () => {
    const rows = await listUploads(caseId);
    renderList(rows);
  };

  const renderList = (rows) => {
    if (!listContainer) return;
    listContainer.innerHTML = "";
    rows.forEach(r => {
      const item = document.createElement("div");
      item.className = "upload-row";
      const link = document.createElement("a");
      link.href = streamFileUrl(r.driveFileId);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = r.fileName;
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = ` • ${r.mimeType} • ${formatBytes(r.size)}`;
      const del = document.createElement("button");
      del.className = "btn";
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        await softDeleteUpload(r.id);
        await refreshList();
      });

      item.appendChild(link);
      item.appendChild(meta);
      if (!r.deletedAt) item.appendChild(del);
      listContainer.appendChild(item);
    });
  };

  fileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      try {
        const meta = await uploadFile({ file, caseId, batchNo: getBatchNo() });
        if (Array.isArray(meta.dupCases) && meta.dupCases.length) {
          renderDuplicateBanner(bannerArea, meta.dupCases);
        }
        onUploaded(meta);
      } catch (err) {
        console.error("upload failed:", err);
        alert(`Upload failed for ${file.name}`);
      }
    }
    await refreshList();
    fileInput.value = "";
  });

  // initial list
  refreshList();
}
