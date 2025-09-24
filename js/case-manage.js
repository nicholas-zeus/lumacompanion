// case-manage.js
// Logic for the "Manage Documents" tab

import { db } from "./firebase.js";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const NETLIFY_UPLOAD_URL = "/.netlify/functions/upload";

const state = {
  caseId: null,
  user: null,
  all: [],
};

const els = {
  tab: null,
  list: null,          // #manage-list
  fileInput: null,     // #fileInput
  uploadBtn: null,     // #uploadBtn
  uploadTags: null,    // #uploadTags (comma-separated)
  batchNo: null,       // #batchNo  (optional)
  overlay: null,       // #savingOverlay (optional)
};

// ------------------------------ Helpers ------------------------------------

function showSaving(on) {
  if (!els.overlay) return;
  els.overlay.style.display = on ? "flex" : "none";
}

function parseTags(input) {
  if (!input) return [];
  return input
    .split(",")
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function bytesToMB(n) {
  return (n ? (n / 1024 / 1024) : 0).toFixed(2);
}

function driveViewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}
function driveDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

// ------------------------------ Rendering ----------------------------------

function renderList() {
  const list = els.list;
  list.innerHTML = "";

  if (!state.all.length) {
    list.innerHTML = `<div class="empty">No documents uploaded yet.</div>`;
    return;
  }

  state.all.forEach((r) => {
    const row = document.createElement("div");
    row.className = "manage-row";
    row.dataset.id = r.id;

    const tags = (r.tags || []).join(", ");

    row.innerHTML = `
      <div class="m-col name">
        <div class="file-name">${r.fileName || "(untitled)"}</div>
        <div class="file-meta">${r.mimeType || ""} • ${bytesToMB(r.size)} MB</div>
      </div>
      <div class="m-col tags">
        <span class="tag-text">${tags}</span>
        <button class="btn-link edit-tags" type="button">Edit</button>
      </div>
      <div class="m-col actions">
        <a class="btn" target="_blank" href="${driveViewUrl(r.fileId)}">Open</a>
        <a class="btn" target="_blank" href="${driveDownloadUrl(r.fileId)}">Download</a>
        <button class="btn danger delete" type="button">Delete</button>
      </div>
    `;

    // Edit tags
    row.querySelector(".edit-tags")?.addEventListener("click", async () => {
      const cur = (r.tags || []).join(", ");
      const next = prompt("Edit tags (comma-separated):", cur);
      if (next === null) return; // cancelled
      const tags = parseTags(next);
      try {
        await updateDoc(doc(db, "uploads", r.id), {
          tags,
          updatedAt: serverTimestamp(),
          updatedBy: state.user?.id || "",
        });
      } catch (e) {
        console.error("Failed to update tags:", e);
        alert("Failed to update tags.");
      }
    });

    // Soft delete
    row.querySelector(".delete")?.addEventListener("click", async () => {
      if (!confirm("Delete this file from the list? (File stays in Drive; entry is hidden)")) return;
      try {
        await updateDoc(doc(db, "uploads", r.id), {
          deletedAt: serverTimestamp(),
          deletedBy: state.user?.id || "",
        });
      } catch (e) {
        console.error("Failed to delete:", e);
        alert("Failed to delete.");
      }
    });

    list.appendChild(row);
  });
}

// ------------------------------ Data ---------------------------------------

let unsubscribe = null;

function listenUploads(caseId) {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  const qRef = query(
    collection(db, "uploads"),
    where("caseId", "==", caseId),
    orderBy("uploadedAt", "desc")
  );

  unsubscribe = onSnapshot(qRef, (snap) => {
    const rows = [];
    snap.forEach((d) => {
      const r = d.data();
      if (r.deletedAt) return; // hide soft-deleted
      rows.push({ id: d.id, ...r });
    });
    state.all = rows;
    renderList();
  });
}

// ------------------------------ Upload -------------------------------------

async function uploadOneFile(file, caseId, batchNo, tags) {
  // 1) Upload to Netlify function (Drive)
  const fd = new FormData();
  fd.append("file", file);
  fd.append("caseId", caseId);
  if (batchNo) fd.append("batchNo", batchNo);

  const res = await fetch(NETLIFY_UPLOAD_URL, {
    method: "POST",
    body: fd,
    // Add auth header if your function requires it
    // headers: { authorization: `Bearer ${window.idToken}` }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }

  const up = await res.json(); // { fileId, fileName, size, mimeType, md5, uploadedAt }

  // 2) Create Firestore row in 'uploads'
  const payload = {
    caseId,
    fileId: up.fileId,
    fileName: up.fileName || file.name,
    size: up.size || file.size,
    mimeType: up.mimeType || file.type || "",
    md5: up.md5 || "",
    tags: tags || [],
    batchNo: batchNo || "",
    // Store Drive URLs (optional but handy for viewers)
    viewUrl: driveViewUrl(up.fileId),
    downloadUrl: driveDownloadUrl(up.fileId),
    uploadedAt: up.uploadedAt ? up.uploadedAt : serverTimestamp(),
    uploadedBy: state.user?.id || "",
    uploadedByName: state.user?.name || "",
  };

  await addDoc(collection(db, "uploads"), payload);
}

async function handleUploadClick() {
  const files = Array.from(els.fileInput?.files || []);
  if (!files.length) {
    alert("Please choose at least one file.");
    return;
  }

  showSaving(true);
  els.uploadBtn.disabled = true;

  const tags = parseTags(els.uploadTags?.value || "");
  const batchNo = (els.batchNo?.value || "").trim();

  try {
    for (const f of files) {
      await uploadOneFile(f, state.caseId, batchNo, tags);
    }
    // Clear inputs
    if (els.fileInput) els.fileInput.value = "";
    if (els.uploadTags) els.uploadTags.value = "";
    // list auto-refreshes via onSnapshot
  } catch (e) {
    console.error(e);
    alert(e.message || "Upload failed.");
  } finally {
    els.uploadBtn.disabled = false;
    showSaving(false);
  }
}

// ------------------------------ Init ---------------------------------------

export function initManage(caseId, currentUser) {
  state.caseId = caseId;
  state.user = currentUser || null;

  els.tab = document.getElementById("tab-manage");
  els.list = document.getElementById("manage-list");
  els.fileInput = document.getElementById("fileInput");
  els.uploadBtn = document.getElementById("uploadBtn");
  els.uploadTags = document.getElementById("uploadTags");
  els.batchNo = document.getElementById("batchNo");
  els.overlay = document.getElementById("savingOverlay");

  els.uploadBtn?.addEventListener("click", handleUploadClick);

  listenUploads(caseId);
}

// Initialize when tab shown (and if default active)
document.addEventListener("DOMContentLoaded", () => {
  const caseId = window.caseId;
  const currentUser = window.currentUser;
  if (!caseId) return;

  const tab = document.getElementById("tab-manage");
  tab?.addEventListener("click", () => initManage(caseId, currentUser));

  if (tab?.classList.contains("active")) {
    initManage(caseId, currentUser);
  }
});
