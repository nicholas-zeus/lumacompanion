// /js/api.js
import { auth, db } from "/js/firebase.js";
import { functionsBase, COLLECTIONS, PAGE_SIZE } from "/js/config.js";
import { contains, toDate } from "/js/utils.js";

import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit,
  addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ------------------------------ Labels ------------------------------ */
export function statusLabel(s) {
  switch (s) {
    case "awaiting doctor": return "Awaiting Doctor";
    case "awaiting nurse":  return "Awaiting Nurse";
    case "reopened":        return "Reopened";
    case "finished":        return "Finished";
    default:                return s || "—";
  }
}
export function waitingLabel(s) {
  switch (s) {
    case "awaiting doctor": return "Doctor";
    case "awaiting nurse":  return "Nurse";
    case "reopened":        return "Nurse";
    default:                return "—";
  }
}

/* ------------------------- Auth helper for fetch ------------------------- */
async function authorizedFetch(path, opts = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken(true);
  const headers = Object.assign({}, opts.headers || {}, { Authorization: `Bearer ${token}` });
  return fetch(`${functionsBase}${path}`, { ...opts, headers });
}

/* ------------------------------- Roles ---------------------------------- */
export async function loadRole() {
  try {
    const res = await authorizedFetch("/my-role", { method: "GET" });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.role || null; // 'nurse' | 'doctor' | 'admin'
  } catch (e) {
    console.error("loadRole:", e);
    return null;
  }
}

/* ---------------------------- Cases (list) ------------------------------ */
export async function queryCases({ role, userEmail, filter, q }) {
  if (!role) return [];

  const col = collection(db, COLLECTIONS.cases);
  let qRef;

  const baseOrder = [orderBy("updatedAt", "desc")];
  const isNurse = role === "nurse";
  const isDoctor = role === "doctor";
  const myEmail = userEmail;

  switch (filter) {
    case "my-queue": {
      if (isNurse) {
        qRef = query(
          col,
          where("assignedNurse.email", "==", myEmail),
          where("status", "in", ["awaiting nurse", "reopened"]),
          ...baseOrder,
          limit(PAGE_SIZE)
        );
      } else if (isDoctor) {
        qRef = query(
          col,
          where("assignedDoctor.email", "==", myEmail),
          where("status", "==", "awaiting doctor"),
          ...baseOrder,
          limit(PAGE_SIZE)
        );
      } else {
        // admin: show any cases where admin is self-assigned as doctor (common pattern)
        qRef = query(
          col,
          where("assignedDoctor.email", "==", myEmail),
          where("status", "==", "awaiting doctor"),
          ...baseOrder,
          limit(PAGE_SIZE)
        );
      }
      break;
    }
    case "awaiting-doctor":
      qRef = query(col, where("status", "==", "awaiting doctor"), ...baseOrder, limit(PAGE_SIZE));
      break;
    case "awaiting-nurse":
      qRef = query(col, where("status", "==", "awaiting nurse"), ...baseOrder, limit(PAGE_SIZE));
      break;
    case "reopened":
      qRef = query(col, where("status", "==", "reopened"), ...baseOrder, limit(PAGE_SIZE));
      break;
    case "finished":
      qRef = query(col, where("status", "==", "finished"), ...baseOrder, limit(PAGE_SIZE));
      break;
    case "urgent":
      qRef = query(col, where("urgent", "==", true), orderBy("deadlineAt", "asc"), limit(PAGE_SIZE));
      break;
    case "all":
    default:
      qRef = query(col, ...baseOrder, limit(PAGE_SIZE));
      break;
  }

  const snap = await getDocs(qRef);
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Client text filter (Name, MemberID, Hospital, Diagnosis)
  const qq = (q || "").trim();
  const filtered = rows.filter(r => {
    if (!qq) return true;
    const d = r.details || {};
    return (
      contains(d.Name, qq) ||
      contains(d.MemberID, qq) ||
      contains(d.Hospital, qq) ||
      contains(d.Diagnosis, qq)
    );
  });

  return filtered;
}

/* ----------------------------- Case CRUD ------------------------------ */
export async function getCase(caseId) {
  const ref = doc(db, COLLECTIONS.cases, caseId);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Compute urgent flag (deadline within 24h of now, per rule) */
export function computeUrgent(deadlineAt) {
  if (!deadlineAt) return false;
  const d = toDate(deadlineAt);
  if (!d) return false;
  const now = Date.now();
  return d.getTime() <= (now + 24 * 60 * 60 * 1000);
}

export async function createCase(initial, currentUser) {
  // initial must already include status: "awaiting doctor" (rules enforce)
  const col = collection(db, COLLECTIONS.cases);
  const payload = {
    ...initial,
    urgent: computeUrgent(initial.deadlineAt),
    createdAt: serverTimestamp(),
    createdBy: {
      email: currentUser.email,
      displayName: currentUser.displayName || currentUser.email
    },
    updatedAt: serverTimestamp(),
    updatedBy: {
      email: currentUser.email,
      displayName: currentUser.displayName || currentUser.email
    }
  };
  const docRef = await addDoc(col, payload);
  const snap = await getDoc(docRef);
  return { id: docRef.id, ...snap.data() };
}

export async function updateCase(caseId, partial, currentUser) {
  const ref = doc(db, COLLECTIONS.cases, caseId);
  const fields = { ...partial };

  // Keep urgent invariant in sync with deadlineAt
  if ("deadlineAt" in fields) {
    fields.urgent = computeUrgent(fields.deadlineAt);
  }
  fields.updatedAt = serverTimestamp();
  fields.updatedBy = {
    email: currentUser.email,
    displayName: currentUser.displayName || currentUser.email
  };

  await updateDoc(ref, fields);
}

/** Convenience: mark finished (nurse/admin only; rules enforce) */
export function finishCase(caseId, currentUser) {
  return updateCase(caseId, { status: "finished", finishedAt: serverTimestamp() }, currentUser);
}
/** Convenience: undo finish → reopened (nurse/admin only; rules enforce) */
export function undoFinish(caseId, currentUser) {
  return updateCase(caseId, { status: "reopened", finishedAt: null }, currentUser);
}

/* ---------------------------- Comments + MQ ---------------------------- */
export async function listComments(caseId) {
  const col = collection(db, COLLECTIONS.comments);
  const qRef = query(col, where("caseId", "==", caseId), orderBy("createdAt", "asc"), limit(1000));
  const snap = await getDocs(qRef);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addComment(caseId, body, currentUser) {
  const col = collection(db, COLLECTIONS.comments);
  const payload = {
    caseId,
    body,
    author: { email: currentUser.email, displayName: currentUser.displayName || currentUser.email },
    isEdited: false,
    createdAt: serverTimestamp()
  };
  const ref = await addDoc(col, payload);
  return { id: ref.id, ...payload };
}

export async function editComment(commentId, body) {
  const ref = doc(db, COLLECTIONS.comments, commentId);
  await updateDoc(ref, { body, isEdited: true, editedAt: serverTimestamp() });
}
export function deleteComment(commentId) {
  const ref = doc(db, COLLECTIONS.comments, commentId);
  return deleteDoc(ref);
}

/** MQ stored with doc id == commentId */
export async function getCommentMQ(commentId) {
  const ref = doc(db, COLLECTIONS.commentMQ, commentId);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}
export async function upsertCommentMQ({ caseId, commentId, text, currentUser }) {
  const ref = doc(db, COLLECTIONS.commentMQ, commentId);
  const payload = {
    caseId,
    commentId,
    text,
    author: { email: currentUser.email, displayName: currentUser.displayName || currentUser.email },
    createdAt: serverTimestamp()
  };
  await setDoc(ref, payload, { merge: true });
}

/* ---------------------------- Uploads (Drive) --------------------------- */
export async function listUploads(caseId) {
  const col = collection(db, COLLECTIONS.uploads);
  const qRef = query(col, where("caseId", "==", caseId), orderBy("uploadedAt", "desc"), limit(1000));
  const snap = await getDocs(qRef);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Soft delete: set deletedAt (rules enforce identity fields unchanged) */
export async function softDeleteUpload(uploadId) {
  const ref = doc(db, COLLECTIONS.uploads, uploadId);
  await updateDoc(ref, { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

/** Upload a file via Netlify function; returns {fileId, fileName, size, mimeType, md5, uploadedAt, uploader, dupCases?, mappingReused?} */
export async function uploadFile({ file, caseId, batchNo = 1 }) {
  const form = new FormData();
  form.append("file", file);
  const res = await authorizedFetch(`/upload?caseId=${encodeURIComponent(caseId)}&batchNo=${encodeURIComponent(batchNo)}`, {
    method: "POST",
    body: form
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

/** Stream URL (for <embed> / pdf.js / download) */
export function streamFileUrl(fileId) {
  return `${functionsBase}/file/${encodeURIComponent(fileId)}`;
}

/* ------------------------------ Page Tags ------------------------------ */
/** Opinionated idempotent doc id: `${uploadId}_${pageNumber}` */
function pageTagDocId(uploadId, pageNumber) {
  return `${uploadId}_${pageNumber}`;
}

/** Get all tags for an upload (returns Map<number,pageTag>) */
export async function getPageTagsForUpload(caseId, uploadId, maxPagesHint = 200) {
  const col = collection(db, COLLECTIONS.pageTags);
  const qRef = query(col, where("caseId", "==", caseId), where("uploadId", "==", uploadId), limit(maxPagesHint));
  const snap = await getDocs(qRef);
  const out = new Map();
  for (const d of snap.docs) {
    const row = d.data();
    out.set(row.pageNumber, row.tag);
  }
  return out;
}

/** Set/overwrite a tag for a single page */
export async function setPageTag({ caseId, uploadId, pageNumber, tag }) {
  const id = pageTagDocId(uploadId, pageNumber);
  const ref = doc(db, COLLECTIONS.pageTags, id);
  await setDoc(ref, {
    caseId, uploadId, pageNumber, tag,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

/* ----------------------------- Tag Options ----------------------------- */
/** Fetch tags from settings; if missing, return defaults from your spec */
export async function getTagOptions() {
  try {
    const ref = doc(db, COLLECTIONS.settings, "tags");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const arr = snap.data()?.options || [];
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch(_) {}
  // Defaults per your decision (modifiable later via settings UI)
  return ["progress note", "vital chart", "doctor order", "lab tests", "medical questionnaire"];
}

/* -------------------------- Export helpers ----------------------------- */
export { sortCasesForDashboard } from "/js/utils.js";
