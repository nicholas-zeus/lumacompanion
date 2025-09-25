// /js/case-details.js
import { state, getHashId, bannerArea, toInputDate, toInputDateTimeLocal } from "/js/case-shared.js";
import { getCase, createCase, updateCase, finishCase, undoFinish, statusLabel } from "/js/api.js";
import { computeAge } from "/js/utils.js";
import { toDate } from "/js/utils.js";

/* --- DOM --- */
const finishedLock   = document.getElementById("finishedLock");
const detailsForm    = document.getElementById("detailsForm");

/* Single, unified primary button: reuse existing edit button area */
const editDetailsBtn = document.getElementById("editDetailsBtn");
const saveDetailsBtn = document.getElementById("saveDetailsBtn");   // legacy (we'll hide)
const newCaseActions = document.getElementById("newCaseActions");   // legacy (we'll hide)

const statusText     = document.getElementById("statusText");
const finishBtn      = document.getElementById("finishBtn");
const undoBtn        = document.getElementById("undoBtn");
const downloadPdfBtn = document.getElementById("downloadPdf");

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

/* ---------- Helpers ---------- */

function setTabsEnabled(enabled) {
  document.querySelectorAll(".tab").forEach(btn => {
    const name = btn.dataset.tab;
    if (name === "details") return;          // Details always enabled
    btn.setAttribute("aria-disabled", enabled ? "false" : "true");
    btn.style.pointerEvents = enabled ? "" : "none";
    btn.style.opacity = enabled ? "" : "0.5";
  });
}

function lockFields(isLocked) {
  detailsForm.querySelectorAll(".input").forEach(i => { i.disabled = !!isLocked; });
}

function clearDetailsForm() {
  [fName,fMemberID,fNationality,fDOB,fAgeYears,fAgeMonths,fPolicyEff,fUWType,fAdmissionType,
   fConsultType,fVisitDate,fHospital,fDiagnosis,fDischargeDate,fChiefComplaint,fPresentIllness,
   fExclusion,fVitalSigns,fPhysicalFindings,fSummary,fTreatment,fReasonAdm,fReasonConsult,fOtherRemark
  ].forEach(el => { if (el) el.value = ""; });
  if (fUrgent) fUrgent.checked = false;
  if (fDeadline) fDeadline.value = "";
}

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

function hydrateFormFromDoc(doc) {
  const d = doc.details || {};
  fName.value = d.Name || ""; fMemberID.value = d.MemberID || "";
  fNationality.value = d.Nationality || "";
  fDOB.value = toInputDate(d.DOB);

  const age = computeAge(toDate(d.DOB), toDate(d.VisitDate));  // returns {years, months}
  fAgeYears.value  = age?.years ?? "";
  fAgeMonths.value = age?.months ?? "";

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
  fUrgent.checked = !!doc.urgent;
  fDeadline.value = toInputDateTimeLocal(doc.deadlineAt);
}

function setPrimaryButton(label, onClick) {
  if (saveDetailsBtn) saveDetailsBtn.hidden = true;                // hide legacy
  if (newCaseActions) newCaseActions.classList.add("hidden");      // hide legacy
  if (editDetailsBtn) {
    editDetailsBtn.hidden = false;
    editDetailsBtn.textContent = label;
    editDetailsBtn.onclick = (e) => { e.preventDefault(); onClick?.(); };
  }
}

/* Finish lock banner + role-based finish/undo visibility */
function lockUIFinished(isFinished) {
  finishedLock.classList.toggle("hidden", !isFinished);
  lockFields(isFinished || (!state.isNew && !state.isEditing));
  finishBtn.hidden = isFinished || !(state.role === "nurse" || state.role === "admin");
  undoBtn.hidden   = !isFinished || !(state.role === "nurse" || state.role === "admin");
}

/* ---------- Public: loadCase ---------- */
export async function loadCase() {
  const id = getHashId();
  state.caseId = id;
  state.isNew = (id === "new");

  // Hide legacy buttons/areas always; we control one primary button
  if (saveDetailsBtn) saveDetailsBtn.hidden = true;
  if (newCaseActions) newCaseActions.classList.add("hidden");

  if (state.isNew) {
    // NEW MODE
    state.caseDoc = null;
    statusText.textContent = "—";
    clearDetailsForm();
    lockFields(false);         // allow typing
    setTabsEnabled(false);     // lock other tabs until created
    if (downloadPdfBtn) downloadPdfBtn.hidden = true;

    setPrimaryButton("Create", async () => {
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

      // Create in Firestore (adds created/updated & computes urgent)
      const created = await createCase(initPayload, state.user);

      // Switch URL to CaseID and enter existing-mode UX
      location.hash = `#${created.id}`;
      state.isNew = false;

      // Fetch fresh and hydrate form
      const fresh = await getCase(created.id);
      state.caseDoc = fresh;
      hydrateFormFromDoc(fresh);

      // Lock fields, enable tabs, show download
      lockFields(true);
      setTabsEnabled(true);
      if (downloadPdfBtn) downloadPdfBtn.hidden = false;

      // Primary button becomes Edit (if nurse)
      wirePrimaryButtonForExisting();

      // Notify other modules
      document.dispatchEvent(new Event("caseLoaded"));
    });

    // Fire once so other modules can react (they’ll see tabs disabled visually)
    document.dispatchEvent(new Event("caseLoaded"));
    return;
  }

  // EXISTING MODE
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

  // Unified nurse-only editing
  wirePrimaryButtonForExisting();

  document.dispatchEvent(new Event("caseLoaded"));
}

/* Nurse-only editing logic for existing cases */
function wirePrimaryButtonForExisting() {
  const role = (state.role || "").toLowerCase();
  if (!editDetailsBtn) return;

  if (role !== "nurse") {
    editDetailsBtn.hidden = true;   // non-nurse: no edit
    return;
  }

  // Start as "Edit" (view mode locked)
  setPrimaryButton("Edit", () => {
    lockFields(false);              // unlock for editing
    setPrimaryButton("Save", async () => {
      const details = gatherDetailsFromForm();
      await updateCase(state.caseId, { details }, state.user);

      // Back to view mode
      lockFields(true);
      setPrimaryButton("Edit", wirePrimaryButtonForExisting);
    });
  });
}

/* --- Finish / Undo --- */
finishBtn?.addEventListener("click", async () => {
  await finishCase(state.caseId, state.user);
  const updated = await getCase(state.caseId);
  state.caseDoc = updated;
  lockUIFinished(true);
  statusText.textContent = statusLabel(updated.status);
});

undoBtn?.addEventListener("click", async () => {
  await undoFinish(state.caseId, state.user);
  const updated = await getCase(state.caseId);
  state.caseDoc = updated;
  lockUIFinished(false);
  statusText.textContent = statusLabel(updated.status);
});

/* --- Live age recompute on date changes --- */
function updateAgeFields() {
  const age = computeAge(fDOB.value ? new Date(fDOB.value) : null,
                         fVisitDate.value ? new Date(fVisitDate.value) : new Date());
  fAgeYears.value  = age?.years ?? "";
  fAgeMonths.value = age?.months ?? "";
}
document.getElementById("fDOB")?.addEventListener("change", updateAgeFields);
document.getElementById("fVisitDate")?.addEventListener("change", updateAgeFields);
