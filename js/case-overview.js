// case-overview.js
// Logic for the "Overview" tab

import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- Utility: compute age from DOB + ref date
function computeAge(dob, refDate) {
  if (!(dob instanceof Date)) dob = new Date(dob);
  if (!(refDate instanceof Date)) refDate = new Date(refDate);

  let years = refDate.getFullYear() - dob.getFullYear();
  let months = refDate.getMonth() - dob.getMonth();
  let days = refDate.getDate() - dob.getDate();

  if (days < 0) {
    months -= 1;
    days += new Date(refDate.getFullYear(), refDate.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months };
}

// --- Load case data into Overview tab
export async function loadCaseOverview(caseId) {
  try {
    const ref = doc(db, "cases", caseId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      console.warn("Case not found:", caseId);
      return;
    }
    const data = snap.data();

    // Fill demographics
    document.getElementById("ovr-patientName").textContent = data.patientName || "";
    document.getElementById("ovr-patientId").textContent = data.patientId || "";
    document.getElementById("ovr-gender").textContent = data.gender || "";
    document.getElementById("ovr-dob").textContent = data.dob || "";
    document.getElementById("ovr-visitDate").textContent = data.visitDate || "";
    document.getElementById("ovr-hospital").textContent = data.hospitalName || "";

    // Compute and show age
    if (data.dob && data.visitDate) {
      const age = computeAge(data.dob, data.visitDate);
      document.getElementById("ovr-age").textContent =
        `${age.years}y ${age.months}m`;
    } else {
      document.getElementById("ovr-age").textContent = "";
    }

    // Fill diagnosis / summary if present
    document.getElementById("ovr-diagnosis").textContent = data.diagnosis || "";
    document.getElementById("ovr-summary").textContent = data.summary || "";

  } catch (err) {
    console.error("Failed to load case overview:", err);
  }
}

// --- Hook when Overview tab is shown
document.addEventListener("DOMContentLoaded", () => {
  const caseId = window.caseId; // assume set globally in case.html
  if (!caseId) return;

  // Load immediately if Overview tab is default, or when tab clicked
  const overviewTab = document.getElementById("tab-overview");
  if (overviewTab?.classList.contains("active")) {
    loadCaseOverview(caseId);
  }
  overviewTab?.addEventListener("click", () => {
    loadCaseOverview(caseId);
  });
});
