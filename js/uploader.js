// /js/uploader.js
import { db } from "/js/firebase.js";
import { uploadFile, listUploads, streamFileUrl } from "/js/api.js";
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
  // Clear previous dup banners, but keep other banners
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

async function findSameCaseUploadByMd5(md5, caseId) {
  const col = collection(db, COLLECTIONS.uploads);
  const qRef = query(col, where("fileHash", "==", md5), where("caseId", "==", caseId));
  const snap = await getDocs(qRef);
  // Prefer the *oldest* (first) upload for mapping reuse
  let best = null;
  snap.forEach(d => {
    const row = { id: d.id, ...d.data() };
    if (!best) best = row;
  });
  return best;
}

async function reusePageTagsIfAny({ caseId, fromUploadId, toUploadId }) {
  if (!fromUploadId || !toUploadId || fromUploadId === toUploadId) return;
  // copy pageTags from fromUploadId to toUploadId
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
 *  - Writes Firestore `uploads` doc after Drive upload
 *  - Shows duplicate banner for same MD5 in other cases
 *  - Reuses page tags if same MD5 exists in this case
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
      const del = document.createElement("span");
      if (r.deletedAt) {
        del.className = "meta";
        del.textContent = " • (deleted)";
      }
      item.appendChild(link);
      item.appendChild(meta);
      item.appendChild(del);
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
          uploadedBy: { email: (firebase.auth().currentUser?.email || ""), displayName: (firebase.auth().currentUser?.displayName || "") },
          uploadedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        const newUploadId = upRef.id;

        // 3) Duplicate checks (client-side)
        const dupCaseIds = await findDuplicateCaseIdsByMd5(meta.md5, caseId);
        renderDuplicateBanner(bannerArea, dupCaseIds);

        // 4) Same-case mapping reuse
        const previous = await findSameCaseUploadByMd5(meta.md5, caseId);
        if (previous && previous.id !== newUploadId) {
          const copied = await reusePageTagsIfAny({ caseId, fromUploadId: previous.id, toUploadId: newUploadId });
          if (copied > 0) {
            // Optional: you can show a small banner/toast; keeping silent per spec
          }
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
