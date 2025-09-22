import { db } from "/js/firebase.js";
import { functionsBase, COLLECTIONS, PAGE_SIZE } from "/js/config.js";
import { contains, toDate } from "/js/utils.js";

import {
  collection, query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/** Friendly labels */
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

/** Role loader via Netlify function that checks Firestore allowlist server-side */
export async function loadRole() {
  try {
    const res = await fetch(`${functionsBase}/my-role`, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.role) throw new Error("No role in response");
    return data.role; // 'nurse' | 'doctor' | 'admin'
  } catch (e) {
    console.error("loadRole failed:", e);
    alert("Your account is signed in but not allowlisted yet, or the role function is missing.\nAsk admin to add you to allowlist, and deploy `my-role` function.");
    return null;
  }
}

/** Build Firestore query based on filter & role */
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
        // admin: show doctor-queue if self-assigned as doctor
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

  // Client-side text filter (Name, MemberID, Hospital, Diagnosis)
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

/** Utility for dashboard sorting (re-export for index.js) */
export { sortCasesForDashboard } from "/js/utils.js";
