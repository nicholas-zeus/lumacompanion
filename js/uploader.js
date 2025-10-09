// /js/uploader.js
import { db, auth } from "/js/firebase.js";
import { uploadFile, listUploads, streamFileUrl, softDeleteUpload } from "/js/api.js";
import { COLLECTIONS } from "/js/config.js";

import {
  collection, query, where, getDocs, addDoc, serverTimestamp, doc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function formatBytes(n) {
  if (!n && n !== 0) return "—";
  const k = 1024;
  if (n < k) return `${n} B`;
  const units = ["KB","MB","GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(k)));
  return (n / Math.pow(k, i + 1)).toFixed(1) + " " + units[i];
}

/** Persistent duplicate banner with copy buttons */
export function renderDuplicateBanner(bannerArea, dupCases = []) {
  if (!bannerArea) return;
  // Remove previous duplicate banners (keep others)
  bannerArea.querySelectorAll(".banner[data-kind='dup']").forEach(n => n.remove());
  if (!dupCases.length) return;

  const div = document.createElement("div");
  div.className = "banner";
  div.dataset.kind = "dup";

  const label = document.createElement("div");
  label.innerHTML = `<strong>Duplicate file detected in other case(s):</strong>`;
  div.appendChild(label);

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexWrap = "wrap";
  list.style.gap = "8px";

  dupCases.forEach((caseId) => {
    const chip = document.createElement("span");
    chip.className = "mono";
    chip.textContent = caseId;

    const btn = document.createElement("button");
    btn.className = "copy";
    btn.textContent = "Copy";
    btn.addEventListener("click", () => navigator.clipboard.writeText(caseId));

    const wrap = document.createElement("span");
    wrap.style.display = "inline-flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "6px";
    wrap.appendChild(chip);
    wrap.appendChild(btn);
    list.appendChild(wrap);
  });

  div.appendChild(list);
  bannerArea.appendChild(div);
}

async function findDuplicateCaseIdsByMd5(md5, currentCaseId) {
  const col = collection(db, COLLECTIONS.uploads);
  const qRef = query(col, where("fileHash", "==", md5));
  const snap = await getDocs(qRef);
  const ids = new Set();
  snap.forEach(d => {
    const row = d.data();
    if (row.caseId && row.caseId !== currentCaseId && !row.deletedAt) {
      ids.add(row.caseId);
    }
  });
  return Array.from(ids);
}
// === NEW: saveStagedFile (split PDFs > 4.5MB at SAVE time) ==================
// Usage (from Manage tab):
//   await saveStagedFile({
//     file, caseId, batchNo: getBatchNo(), bannerArea,
//     onUploaded: (logicalMeta) => { /* refresh UI */ },
//     onProgress: (percent) => { /* optional: update overlay bar */ }
//   });
import { splitIfNeeded } from "/js/pdf-splitter.js";

function makePartFileName(baseName, index, ext = ".pdf") {
  const dot = baseName.lastIndexOf(".");
  if (dot > 0) {
    const stem = baseName.slice(0, dot);
    return `${stem}~${index}${ext}`;
  }
  return `${baseName}~${index}${ext}`;
}


/**
 * Creates a single Firestore "logical upload" doc even when the PDF is split into parts.
 * - Only PDF and image types are allowed (images are compressed by splitIfNeeded when > max).
 * - For PDFs > maxBytes, pages are flattened and chunked into <= maxBytes parts.
 * - Each part is uploaded sequentially to Drive via your existing uploadFile() function.
 * - Firestore 'uploads' gets one doc with fileParts map and driveFileIds[].
 *
 * Returns: the Firestore doc id and the logical meta we wrote.
 */
export async function saveStagedFile({
  file,
  caseId,
  batchNo = 1,
  bannerArea,
  onUploaded = () => {},
  onProgress = () => {},
  maxBytes = 4.5 * 1024 * 1024,
  pdfDpi = 120,
  jpegQuality = 0.72
}) {
  if (!file) throw new Error("saveStagedFile: file required");
  if (!caseId) throw new Error("saveStagedFile: caseId required");

  const isPdf = file.type === "application/pdf";
  const isImg = /^image\//i.test(file.type);
  if (!isPdf && !isImg) throw new Error("Only PDF and image files are allowed.");

  // 1) Split/compress client-side
  const splitRes = await splitIfNeeded(file, {
    maxBytes,
    dpi: pdfDpi,
    quality: jpegQuality,
    imageMaxWidth: 2600
  });
  // splitRes: { isSplit, mode, blobs, pageCounts, totalBytes, parts }

  // 2) Upload each part sequentially; report coarse progress
  const partMetas = [];
  const totalBytes = splitRes.totalBytes || splitRes.blobs.reduce((s, b) => s + (b.size || 0), 0);
  let uploadedBytes = 0;

  for (let i = 0; i < splitRes.blobs.length; i++) {
    const blob = splitRes.blobs[i];
    const partIdx = i + 1;

    let partName, partType;
    if (isPdf) {
      // Keep original name for single; numbered suffix for split
      partName = splitRes.isSplit ? makePartFileName(file.name, partIdx, ".pdf") : file.name;
      partType = "application/pdf";
    } else {
      // Images > maxBytes were recompressed to JPEG — ensure name/type match actual bytes
      const baseStem = file.name.replace(/\.[^.]+$/, "");
      const needsJpegNaming = blob.type === "image/jpeg";
      partName = needsJpegNaming ? `${baseStem}.jpg` : file.name;
      partType = needsJpegNaming ? "image/jpeg" : (file.type || "application/octet-stream");
    }

    const partFile = new File([blob], partName, { type: partType });

    const meta = await uploadFile({ file: partFile, caseId, batchNo });
    // meta: { fileId, fileName, size, mimeType, md5, uploadedAt }
    partMetas.push(meta);

    uploadedBytes += Number(meta.size || blob.size || 0);
    const pct = totalBytes ? Math.min(100, (uploadedBytes / totalBytes) * 100) : (100 * (partIdx / splitRes.blobs.length));
    try { onProgress(pct); } catch {}
  }

  // 3) Single logical Firestore doc (source of truth for UI)
  const fileParts = {};
  const driveFileIds = [];
  let sumSize = 0;
  partMetas.forEach((m, idx) => {
    const key = String(idx + 1);
    fileParts[key] = { id: m.fileId, size: Number(m.size || 0), md5: m.md5 || null, name: m.fileName };
    driveFileIds.push(m.fileId);
    sumSize += Number(m.size || 0);
  });

  const upRef = await addDoc(collection(db, COLLECTIONS.uploads), {
    caseId,
    batchNo,
    fileName: file.name,                       // logical name shown in UI
    fileType: isPdf ? "application/pdf" : (file.type || "application/octet-stream"),
    totalSize: sumSize,
    filePartsCount: partMetas.length,          // backend detail; UI should ignore
    driveFileIds,                              // UI uses these to preview/download
    fileParts,                                 // backend detail; audits/ops
    fileHash: partMetas[0]?.md5 || null,       // best-effort dedupe
    uploadedBy: {
      email: (auth.currentUser?.email || ""),
      displayName: (auth.currentUser?.displayName || "")
    },
    uploadedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  const newUploadId = upRef.id;

  // 4) Duplicate banner & tag reuse (best-effort)
  try {
    if (partMetas[0]?.md5) {
      const dupCaseIds = await findDuplicateCaseIdsByMd5(partMetas[0].md5, caseId);
      renderDuplicateBanner(bannerArea, dupCaseIds);
      const previous = await findSameCaseUploadByMd5(partMetas[0].md5, caseId);
      if (previous && previous.id !== newUploadId) {
        await reusePageTagsIfAny({ caseId, fromUploadId: previous.id, toUploadId: newUploadId });
      }
    }
  } catch (e) {
    console.warn("dup/tag reuse skipped:", e);
  }

  const logicalMeta = {
    uploadId: newUploadId,
    caseId,
    batchNo,
    fileName: file.name,
    fileType: isPdf ? "application/pdf" : (file.type || "application/octet-stream"),
    totalSize: sumSize,
    filePartsCount: partMetas.length,
    driveFileIds,
    fileParts
  };

  try { onUploaded(logicalMeta); } catch {}

  return logicalMeta;
}


async function findSameCaseUploadByMd5(md5, caseId) {
  const col = collection(db, COLLECTIONS.uploads);
  const qRef = query(col, where("fileHash", "==", md5), where("caseId", "==", caseId));
  const snap = await getDocs(qRef);
  let best = null;
  snap.forEach(d => {
    const row = { id: d.id, ...d.data() };
    if (!best) best = row;
  });
  return best;
}

async function reusePageTagsIfAny({ caseId, fromUploadId, toUploadId }) {
  if (!fromUploadId || !toUploadId || fromUploadId === toUploadId) return 0;
  const col = collection(db, COLLECTIONS.pageTags);
  const snap = await getDocs(query(col, where("caseId", "==", caseId), where("uploadId", "==", fromUploadId)));
  const writes = [];
  snap.forEach(d => {
    const row = d.data();
    const id = `${toUploadId}_${row.pageNumber}`;
    writes.push(setDoc(doc(db, COLLECTIONS.pageTags, id), {
      caseId, uploadId: toUploadId, pageNumber: row.pageNumber, tag: row.tag, updatedAt: serverTimestamp()
    }, { merge: true }));
  });
  await Promise.all(writes);
  return writes.length;
}

/**
 * Initialize uploader wiring.
 *  - Uploads to Drive (function)
 *  - Writes Firestore `uploads` doc
 *  - Shows duplicate banner for same MD5 in other cases
 *  - Reuses page tags if same MD5 exists in this case
 *  - Renders list with soft-delete
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
      meta.textContent = ` • ${r.mimeType || ""} • ${formatBytes(r.size)}`;

      item.appendChild(link);
      item.appendChild(meta);

      if (!r.deletedAt) {
        // Soft delete button (uploader-only can be enforced by rules; UI shows for everyone)
        const del = document.createElement("button");
        del.className = "btn";
        del.textContent = "Delete";
        del.addEventListener("click", async () => {
          try {
            await softDeleteUpload(r.id);
            await refreshList();
          } catch (e) {
            console.error(e);
            alert("Delete failed.");
          }
        });
        item.appendChild(del);
      } else {
        const deleted = document.createElement("span");
        deleted.className = "meta";
        deleted.textContent = " • (deleted)";
        item.appendChild(deleted);
      }

      // Click to preview if PDF
      if ((r.mimeType || "").toLowerCase().includes("pdf") && !r.deletedAt) {
        item.style.cursor = "pointer";
        item.addEventListener("click", (ev) => {
          // avoid triggering when clicking Delete button
          if (ev.target.tagName.toLowerCase() === "button") return;
          // let the page's handler attach via click on the row item if needed
          // (case.js wires PDF preview by adding a click listener when rendering)
        });
      }

      listContainer.appendChild(item);
    });
  };

  fileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      try {
        // 1) Upload to Drive
        const meta = await uploadFile({ file, caseId, batchNo: getBatchNo() });

        // 2) Create Firestore uploads doc (client-side)
        const upRef = await addDoc(collection(db, COLLECTIONS.uploads), {
          caseId,
          batchNo: getBatchNo(),
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
        const newUploadId = upRef.id;

        // 3) Duplicate checks across other cases (client-side)
        const dupCaseIds = await findDuplicateCaseIdsByMd5(meta.md5, caseId);
        renderDuplicateBanner(bannerArea, dupCaseIds);

        // 4) Same-case mapping reuse
        const previous = await findSameCaseUploadByMd5(meta.md5, caseId);
        if (previous && previous.id !== newUploadId) {
          await reusePageTagsIfAny({ caseId, fromUploadId: previous.id, toUploadId: newUploadId });
        }

        onUploaded({ ...meta, uploadId: newUploadId });
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
