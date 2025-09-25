// /js/case-details.js
import { state, getHashId, bannerArea, toInputDate, toInputDateTimeLocal } from "/js/case-shared.js";
import { getCase, createCase, updateCase, finishCase, undoFinish, statusLabel } from "/js/api.js";
import { computeAge } from "/js/utils.js";
import { toDate } from "/js/utils.js";

/* --- DOM --- */
const finishedLock   = document.getElementById("finishedLock");
const detailsForm    = document.getElementById("detailsForm");

/* Unified primary button (reuse existing buttons area) */
const editDetailsBtn = document.getElementById("editDetailsBtn");
const saveDetailsBtn = document.getElementById("saveDetailsBtn");   // legacy (hidden)
const newCaseActions = document.getElementById("newCaseActions");   // legacy (hidden)

const statusText     = document.getElementById("statusText");
const finishBtn      = document.getElementById("finishBtn");
const undoBtn        = document.getElementById("undoBtn");
const downloadPdfBtn = document.getElementById("downloadPdf");

/* Loading overlay (created lazily) */
let loadingOverlay;
function ensureLoadingOverlay() {
  if (loadingOverlay) return;
  loadingOverlay = document.createElement("div");
  loadingOverlay.id = "detailsLoadingOverlay";
  loadingOverlay.style.position = "fixed";
  loadingOverlay.style.inset = "0";
  loadingOverlay.style.background = "rgba(255,255,255,0.75)";
  loadingOverlay.style.display = "none";
  loadingOverlay.style.alignItems = "center";
  loadingOverlay.style.justifyContent = "center";
  loadingOverlay.style.zIndex = "1000";
  loadingOverlay.innerHTML = `
    <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow);display:grid;gap:8px;justify-items:center">
      <div style="width:28px;height:28px;border:4px solid #ccc;border-top-color:var(--brand);border-radius:50%;animation:spin 1s linear infinite"></div>
      <div>Loading…</div>
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `;
  document.body.appendChild(loadingOverlay);
}
function showLoading() { ensureLoadingOverlay(); loadingOverlay.style.display = "flex"; }
function hideLoading() { if (loadingOverlay) loadingOverlay.style.display = "none"; }

/* Fields */
const f = (id) => document.getElementById(id);
const fName=f("fName"), fMemberID=f("fMemberID"), fNationality=f("fNationality"),
      fDOB=f("fDOB"), fAgeYears=f("fAgeYears"), fAgeMonths=f("fAgeMonths"),
      fPolicyEff=f("fPolicyEff"), fUWType=f("fUWType"), fAdmissionType=f("fAdmissionType"),
      fConsultType=f("fConsultType"), fVisitDate=f("fVisitDate"), fHospital=f("fHospital"),
      fDiagnosis=f("fDiagnosis"), fDischargeDate=f("fDischargeDate"), fChiefComplaint=f("fChiefComplaint"),
      fPresentIllness=f("fPresentIllness"), fExclusion=f("fExclusion"), fUrgent=f("fUrgent"),
      fDeadline=f("fDeadline"), fVitalSigns=f("fVitalSigns"), fPhysicalFindings=f("fPhysicalFindings"),
      fSummary=f("fSummary"), fTreatment=f("fTreatment"), fReasonAdm=f("fReasonAdm"),
      fReasonConsult=f("fReasonConsult"), fOtherRemark=f("fOtherRemark");

/* Inline Age (next to DOB) */
let ageInline;
function ensureAgeInline() {
  if (ageInline) return;
  if (!fDOB) return;
  // place tiny age chip right after the DOB input
  ageInline = document.createElement("span");
  ageInline.id = "ageInline";
  ageInline.style.marginLeft = "8px";
  ageInline.style.fontSize = "12px";
  ageInline.style.color = "var(--subtle)";
  fDOB.insertAdjacentElement("afterend", ageInline);
}
function setAgeInline(dobVal, visitVal) {
  ensureAgeInline();
  const dob = dobVal ? toDate(dobVal) : null;
  const ref = visitVal ? toDate(visitVal) : new Date();
  if (!dob) { if (ageInline) ageInline.textContent = ""; return; }
  const age = computeAge(dob, ref);
  const y = age?.years ?? "";
  const m = age?.months ?? "";
  ageInline.textContent = (y === "" && m === "") ? "" : `${y}y ${m}m`;
  // keep hidden fields updated (if present)
  if (fAgeYears)  fAgeYears.value = y;
  if (fAgeMonths) fAgeMonths.value = m;
}

/* Expand/Collapse for long fields (locked mode only) */
const LONG_FIELD_IDS = [
  "fChiefComplaint","fPresentIllness","fVitalSigns","fPhysicalFindings",
  "fSummary","fTreatment","fReasonAdm","fReasonConsult","fOtherRemark","fDiagnosis"
];
function isTextarea(el) { return el && (el.tagName || "").toLowerCase() === "textarea"; }
function buttonIcon(expanded) { return expanded ? "▴" : "▾"; }
function applyOverflowToggles(isLocked) {
  LONG_FIELD_IDS.forEach(id => {
    const el = f(id);
    if (!el) return;
    // wrapper .field
    const wrap = el.closest(".field") || el.parentElement;
    if (!wrap) return;

    // Ensure base collapsed style in CSS terms via inline class
    wrap.classList.toggle("collapsible", !!isLocked);

    // Add/remove button
    let btn = wrap.querySelector(".expand-btn");
    if (isLocked) {
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "expand-btn";
        btn.style.border = "1px solid var(--line)";
        btn.style.background = "#fff";
        btn.style.borderRadius = "8px";
        btn.style.fontSize = "12px";
        btn.style.padding = "2px 6px";
        btn.style.alignSelf = "start";
        btn.style.cursor = "pointer";
        btn.style.marginTop = "4px";
        btn.textContent = "Expand " + buttonIcon(false);
        btn.setAttribute("aria-expanded", "false");
        btn.addEventListener("click", () => {
          const expanded = wrap.classList.toggle("expanded");
          btn.textContent = (expanded ? "Collapse " : "Expand ") + buttonIcon(expanded);
          btn.setAttribute("aria-expanded", expanded ? "true" : "false");
        });
        // insert after the field control
        el.insertAdjacentElement("afterend", btn);
      }
    } else {
      // editing: remove collapsed styling and the button
      wrap.classList.remove("expanded");
      if (btn) btn.remove();
    }
  });
}

/* Reorder fields to requested sequence without changing HTML */
function reorderFields() {
  if (!detailsForm) return;
  const grid = detailsForm; // .form-grid
  const order = [
    // Row 1 grouping
    "fName","fMemberID","fNationality","fDOB",
    // Row 2
    "fPolicyEff","fUWType","fExclusion",
    // Row 3 and onwards
    "fHospital","fAdmissionType","fVisitDate","fDischargeDate","fDiagnosis","fChiefComplaint",
    "fPresentIllness","fVitalSigns","fPhysicalFindings","fSummary","fTreatment",
    "fReasonAdm",
    "fConsultType","fReasonConsult",
    "fOtherRemark",
    // urgent section last
    "fUrgent","fDeadline"
  ];
  for (const id of order) {
    const ctl = f(id);
    if (!ctl) continue;
    const field = ctl.closest(".field") || ctl.parentElement;
    if (field && grid.contains(field)) {
      grid.appendChild(field);
    }
  }
}

/* Tabs enable/disable */
function setTabsEnabled(enabled) {
  document.querySelectorAll(".tab").forEach(btn => {
    const name = btn.dataset.tab;
    if (name === "details") return;
    btn.setAttribute("aria-disabled", enabled ? "false" : "true");
    btn.style.pointerEvents = enabled ? "" : "none";
    btn.style.opacity = enabled ? "" : "0.5";
  });
}

/* Field lock */
function lockFields(isLocked) {
  detailsForm.querySelectorAll(".input").forEach(i => { i.disabled = !!isLocked; });
  applyOverflowToggles(!!isLocked);
}

/* Clear form */
function clearDetailsForm() {
  [fName,fMemberID,fNationality,fDOB,fAgeYears,fAgeMonths,fPolicyEff,fUWType,fAdmissionType,
   fConsultType,fVisitDate,fHospital,fDiagnosis,fDischargeDate,fChiefComplaint,fPresentIllness,
   fExclusion,fVitalSigns,fPhysicalFindings,fSummary,fTreatment,fReasonAdm,fReasonConsult,fOtherRemark
  ].forEach(el => { if (el) el.value = ""; });
  if (fUrgent) fUrgent.checked = false;
  if (fDeadline) fDeadline.value = "";
  setAgeInline("", "");
}

/* Gather form -> details */
function gatherDetailsFromForm() {
  return {
    Name: fName.value.trim(),
    MemberID: fMemberID.value.trim(),
    Nationality: fNationality.value.trim(),
    DOB: fDOB.value || "",
    PolicyEffectiveDate: fPolicyEff.value || "",
    UnderwritingType: fUWType.value.trim(),
    TypeOfAdmission: fAdmissionType.value.trim(),
    TypeOfConsultation: fConsultType.value.trim(),
    VisitDate: fVisitDate.value || "",
    Hospital: fHospital.value.trim(),
    Diagnosis: fDiagnosis.value.trim(),
    DischargeDate: fDischargeDate.value || "",
    ChiefComplaint: fChiefComplaint.value.trim(),
    PresentIllness: fPresentIllness.value.trim(),
    Exclusion: fExclusion.value.trim(),
    VitalSigns: fVitalSigns.value.trim(),
    PhysicalFindings: fPhysicalFindings.value.trim(),
    Summary: fSummary.value.trim(),
    Treatment: fTreatment.value.trim(),
    ReasonForAdmission: fReasonAdm.value.trim(),
    ReasonForConsultation: fReasonConsult.value.trim(),
    OtherRemark: fOtherRemark.value.trim(),
  };
}

/* Hydrate form from doc */
function hydrateFormFromDoc(doc) {
  const d = doc.details || {};
  fName.value = d.Name || ""; fMemberID.value = d.MemberID || "";
  fNationality.value = d.Nationality || "";
  fDOB.value = toInputDate(d.DOB);

  fPolicyEff.value = toInputDate(d.PolicyEffectiveDate);
  fUWType.value = d.UnderwritingType || "";
  fAdmissionType.value = d.TypeOfAdmission || "";
  fConsultType.value = d.TypeOfConsultation || "";
  fVisitDate.value = toInputDate(d.VisitDate);
  fHospital.value = d.Hospital || "";
  fDiagnosis.value = d.Diagnosis || "";
  fDischargeDate.value = toInputDate(d.DischargeDate);
  fChiefComplaint.value = d.ChiefComplaint || "";
  fPresentIllness.value = d.PresentIllness || "";
  fExclusion.value = d.Exclusion || "";
  fVitalSigns.value = d.VitalSigns || "";
  fPhysicalFindings.value = d.PhysicalFindings || "";
  fSummary.value = d.Summary || "";
  fTreatment.value = d.Treatment || "";
  fReasonAdm.value = d.ReasonForAdmission || "";
  fReasonConsult.value = d.ReasonForConsultation || "";
  fOtherRemark.value = d.OtherRemark || "";

  statusText.textContent = statusLabel(doc.status || "—");
  if (fUrgent) fUrgent.checked = !!doc.urgent;
  if (fDeadline) fDeadline.value = toInputDateTimeLocal(doc.deadlineAt);

  setAgeInline(d.DOB, d.VisitDate);
}

/* Primary button label + handler */
function setPrimaryButton(label, onClick) {
  if (saveDetailsBtn) saveDetailsBtn.hidden = true;           // hide legacy
  if (newCaseActions) newCaseActions.classList.add("hidden"); // hide legacy
  if (editDetailsBtn) {
    editDetailsBtn.hidden = false;
    editDetailsBtn.textContent = label;
    editDetailsBtn.onclick = (e) => { e.preventDefault(); onClick?.(); };
  }
}

/* Finish banner + role rules */
function lockUIFinished(isFinished) {
  finishedLock.classList.toggle("hidden", !isFinished);
  lockFields(isFinished || (!state.isNew && !state.isEditing));
  finishBtn.hidden = isFinished || !(state.role === "nurse" || state.role === "admin");
  undoBtn.hidden   = !isFinished || !(state.role === "nurse" || state.role === "admin");
}

/* Urgent/Deadline visibility + requirement */
function syncDeadlineVisibility() {
  const urgent = !!(fUrgent && fUrgent.checked);
  const wrapDeadline = fDeadline?.closest(".field") || fDeadline?.parentElement;
  if (wrapDeadline) wrapDeadline.style.display = urgent ? "" : "none";
  if (fDeadline) {
    fDeadline.required = urgent;
    if (!urgent) fDeadline.value = ""; // clear when not urgent
  }
}

/* ---------- Public: loadCase ---------- */
export async function loadCase() {
  showLoading();

  // Always ensure field order and DOB age chip exist
  reorderFields();
  ensureAgeInline();
  syncDeadlineVisibility();

  const id = getHashId();
  state.caseId = id;
  state.isNew = (id === "new");

  // Hide legacy button areas; we control a single button
  if (saveDetailsBtn) saveDetailsBtn.hidden = true;
  if (newCaseActions) newCaseActions.classList.add("hidden");

  if (state.isNew) {
    // NEW MODE
    state.caseDoc = null;
    statusText.textContent = "—";
    clearDetailsForm();
    lockFields(false);         // allow typing
    setTabsEnabled(false);     // lock other tabs
    if (downloadPdfBtn) downloadPdfBtn.hidden = true;

    setPrimaryButton("Create", async () => {
      showLoading();
      try {
        // Require deadline when urgent
        syncDeadlineVisibility();
        const details = gatherDetailsFromForm();

        const initPayload = {
          details,
          status: "awaiting doctor",
          urgent: !!(fUrgent && fUrgent.checked),
          deadlineAt: fDeadline?.value ? new Date(fDeadline.value) : null,
          assignedNurse: {
            email: state.user.email,
            displayName: state.user.displayName || state.user.email
          }
        };

        const created = await createCase(initPayload, state.user);

        location.hash = `#${created.id}`;
        state.isNew = false;

        const fresh = await getCase(created.id);
        state.caseDoc = fresh;
        hydrateFormFromDoc(fresh);

        lockFields(true);
        setTabsEnabled(true);
        if (downloadPdfBtn) downloadPdfBtn.hidden = false;

        wirePrimaryButtonForExisting();
        document.dispatchEvent(new Event("caseLoaded"));
      } finally {
        hideLoading();
      }
    });

    document.dispatchEvent(new Event("caseLoaded"));
    hideLoading();
    return;
  }

  // EXISTING MODE
  try {
    const doc = await getCase(id);
    if (!doc) {
      bannerArea.innerHTML = `<div class="banner">Case not found: <span class="mono">#${id}</span></div>`;
      document.dispatchEvent(new Event("caseLoaded"));
      return;
    }
    state.caseDoc = doc;

    hydrateFormFromDoc(doc);
    lockFields(true);
    setTabsEnabled(true);
    if (downloadPdfBtn) downloadPdfBtn.hidden = false;

    wirePrimaryButtonForExisting();
    document.dispatchEvent(new Event("caseLoaded"));
  } finally {
    hideLoading();
  }
}

/* Nurse-only editing logic for existing cases */
function wirePrimaryButtonForExisting() {
  const role = (state.role || "").toLowerCase();
  if (!editDetailsBtn) return;

  if (role !== "nurse") {
    editDetailsBtn.hidden = true;   // non-nurse: no edit
    return;
  }

  setPrimaryButton("Edit", () => {
    lockFields(false);              // unlock
    setPrimaryButton("Save", async () => {
      showLoading();
      try {
        syncDeadlineVisibility();
        const details = gatherDetailsFromForm();
        await updateCase(state.caseId, {
          details,
          urgent: !!(fUrgent && fUrgent.checked),
          deadlineAt: fDeadline?.value ? new Date(fDeadline.value) : null
        }, state.user);

        // back to locked
        lockFields(true);
        setPrimaryButton("Edit", wirePrimaryButtonForExisting);

        // refresh status text from server (in case any server rule modifies fields)
        const updated = await getCase(state.caseId);
        state.caseDoc = updated;
        statusText.textContent = statusLabel(updated.status || "—");
      } finally {
        hideLoading();
      }
    });
  });
}

/* --- Finish / Undo (unchanged) --- */
finishBtn?.addEventListener("click", async () => {
  showLoading();
  try {
    await finishCase(state.caseId, state.user);
    const updated = await getCase(state.caseId);
    state.caseDoc = updated;
    lockUIFinished(true);
    statusText.textContent = statusLabel(updated.status);
  } finally {
    hideLoading();
  }
});

undoBtn?.addEventListener("click", async () => {
  showLoading();
  try {
    await undoFinish(state.caseId, state.user);
    const updated = await getCase(state.caseId);
    state.caseDoc = updated;
    lockUIFinished(false);
    statusText.textContent = statusLabel(updated.status);
  } finally {
    hideLoading();
  }
});

/* --- Live age recompute next to DOB --- */
function updateAgeInline() {
  setAgeInline(fDOB?.value, fVisitDate?.value);
}
document.getElementById("fDOB")?.addEventListener("change", updateAgeInline);
document.getElementById("fVisitDate")?.addEventListener("change", updateAgeInline);

/* --- Urgent/Deadline UI --- */
fUrgent?.addEventListener("change", syncDeadlineVisibility);
