// case-details.js
import { state, getHashId, bannerArea, toInputDate, toInputDateTimeLocal } from "/js/case-shared.js";
import { getCase, createCase, updateCase, finishCase, undoFinish, statusLabel } from "/js/api.js";
import { computeAge, requireFields } from "/js/utils.js";
import { toDate } from "/js/utils.js";

const finishedLock   = document.getElementById("finishedLock");
const detailsForm    = document.getElementById("detailsForm");
const newCaseActions = document.getElementById("newCaseActions");
const editDetailsBtn = document.getElementById("editDetailsBtn");
const saveDetailsBtn = document.getElementById("saveDetailsBtn");
const assignNurseBtn = document.getElementById("assignNurseBtn");
const assignDoctorBtn= document.getElementById("assignDoctorBtn");
const statusText     = document.getElementById("statusText");
const finishBtn      = document.getElementById("finishBtn");
const undoBtn        = document.getElementById("undoBtn");
const downloadPdfBtn = document.getElementById("downloadPdf");

// field helpers
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

export async function loadCase() {
  const id = getHashId();
  state.caseId = id;
  state.isNew = (id === "new");

  if (state.isNew) {
    newCaseActions.classList.remove("hidden");
    document.dispatchEvent(new Event("caseLoaded")); // <-- add this
    return;
  }

  const doc = await getCase(id);
  if (!doc) {
    bannerArea.innerHTML = `<div class="banner">Case not found: <span class="mono">#${id}</span></div>`;
    document.dispatchEvent(new Event("caseLoaded")); // still notify
    return;
  }
  state.caseDoc = doc;

  const d = doc.details || {};
  fName.value = d.Name || ""; fMemberID.value = d.MemberID || "";
  fNationality.value = d.Nationality || "";
  fDOB.value = toInputDate(d.DOB);

  fAgeYears.value  = computeAge(toDate(d.DOB), toDate(d.VisitDate), "years") ?? "";
  fAgeMonths.value = computeAge(toDate(d.DOB), toDate(d.VisitDate), "months") ?? "";

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

  lockUIFinished(doc.status === "finished");
  downloadPdfBtn.hidden = false;

  document.dispatchEvent(new Event("caseLoaded")); // <-- keep this
}


function lockUIFinished(isFinished) {
  finishedLock.classList.toggle("hidden", !isFinished);
  detailsForm.querySelectorAll(".input").forEach(i =>
    i.disabled = isFinished || (!state.isNew && !state.isEditing)
  );
  finishBtn.hidden = isFinished || !(state.role === "nurse" || state.role === "admin");
  undoBtn.hidden   = !isFinished || !(state.role === "nurse" || state.role === "admin");
}

export function updateAgeFields() {
  const years = computeAge(fDOB.value, fVisitDate.value, "years");
  const months = computeAge(fDOB.value, fVisitDate.value, "months");
  fAgeYears.value = (years ?? "");
  fAgeMonths.value = (months ?? "");
}

document.getElementById("fDOB")?.addEventListener("change", updateAgeFields);
document.getElementById("fVisitDate")?.addEventListener("change", updateAgeFields);

finishBtn?.addEventListener("click", async () => {
  await finishCase(state.caseId, state.user);
  const updated = await getCase(state.caseId);
  state.caseDoc = updated; lockUIFinished(true);
  statusText.textContent = statusLabel(updated.status);
});
undoBtn?.addEventListener("click", async () => {
  await undoFinish(state.caseId, state.user);
  const updated = await getCase(state.caseId);
  state.caseDoc = updated; lockUIFinished(false);
  statusText.textContent = statusLabel(updated.status);
});
