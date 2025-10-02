// /js/case-details.js
import { state, getHashId, bannerArea, toInputDate, toInputDateTimeLocal } from "/js/case-shared.js";
import { getCase, createCase, updateCase, finishCase, undoFinish, statusLabel } from "/js/api.js";
import { computeAge } from "/js/utils.js";
import { toDate } from "/js/utils.js";
import { fab } from "/js/fab.js";




document.addEventListener("caseLoaded", () => {
  fab.init?.();
  fab.setTab?.("details");
  try { syncDetailsFab(); } catch {}
});


// NEW CASE flow (inside loadCase -> state.isNew branch)

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
// --- Hospitals dropdown helpers ---
let hospitalsCache = null;     // [{ id: Hosp_ID, name: HospName }]
let hospitalMap = new Map();   // id -> name

async function fetchHospitalsList() {
  if (hospitalsCache) return hospitalsCache;
  const { db } = await import("/js/firebase.js");
  const { collection, getDocs } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const snap = await getDocs(collection(db, "hospitals"));
  const list = [];
  snap.forEach(d => {
    const row = d.data() || {};
    // doc id is Hosp_ID; field names per importer
    const id = d.id || row.Hosp_ID || "";
    const name = row.HospName || id || "(unknown hospital)";
    list.push({ id, name });
  });
  // cache + map
  hospitalsCache = list.sort((a,b)=>a.name.localeCompare(b.name));
  hospitalMap = new Map(hospitalsCache.map(h => [h.id, h.name]));
  return hospitalsCache;
}
// --- FAB sync helpers (centralized, role-safe) ---
const detailsFabHandlers = { onCreate: null, onSave: null, onEdit: null };

function anyDetailsFieldUnlocked() {
  return !!detailsForm?.querySelector('.input:not(:disabled)');
}

export function syncDetailsFab() {
  // Respect role-based guards: nurses can act, others see no actionable FAB
  const role = (state.role || "").toLowerCase();
  if (role !== "nurse") {
    // Keep label "Edit" (role guards will hide/neutralize it)
    fab.setDetails("edit", null);
    return;
  }

  // New case = Create (✓). Existing unlocked = Save (✓). Locked = Edit (✏)
  if (state.isNew) {
    fab.setDetails("create", detailsFabHandlers.onCreate);
  } else if (anyDetailsFieldUnlocked()) {
    fab.setDetails("save", detailsFabHandlers.onSave);
  } else {
    fab.setDetails("edit", detailsFabHandlers.onEdit);
  }
}

// Keep icon synced even if something else toggles disabled on inputs
const _detailsLockObserver = new MutationObserver((muts) => {
  if (muts.some(m => m.attributeName === "disabled")) {
    try { syncDetailsFab(); } catch {}
  }
});
if (detailsForm) {
  _detailsLockObserver.observe(detailsForm, { subtree: true, attributes: true, attributeFilter: ["disabled"] });
}

function ensureHospitalSelect() {
  const el = document.getElementById("fHospital");
  if (!el) return null;

  // If it's already a <select>, reuse it. If it's an <input>, replace it.
  if (el.tagName.toLowerCase() === "select") return el;

  // Replace <input id="fHospital"> with a <select id="fHospital" class="input">
  const sel = document.createElement("select");
  sel.id = el.id;
  sel.className = el.className || "input";
  sel.required = el.required || false;

  // Insert select in place of the input
  el.insertAdjacentElement("afterend", sel);
  el.remove();

  // Ensure hidden field exists
  if (!document.getElementById("fHospitalID")) {
    const hid = document.createElement("input");
    hid.type = "hidden";
    hid.id = "fHospitalID";
    sel.insertAdjacentElement("afterend", hid);
  }
  return sel;
}

async function populateHospitalOptions(selectedId = "") {
  const sel = ensureHospitalSelect();
  if (!sel) return;

  // Basic placeholder
  sel.innerHTML = `<option value="">— Select hospital —</option>`;

  const list = await fetchHospitalsList();
  for (const h of list) {
    const opt = document.createElement("option");
    opt.value = h.id;      // store ID as the option value
    opt.textContent = h.name;
    sel.appendChild(opt);
  }
  sel.value = selectedId || "";

  // keep hidden ID synced
  const hid = document.getElementById("fHospitalID");
  if (hid) hid.value = sel.value || "";

  // on change → sync hidden id
  sel.addEventListener("change", () => {
    const hid2 = document.getElementById("fHospitalID");
    if (hid2) hid2.value = sel.value || "";
  });
}

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
// Makes long fields collapsible in LOCKED mode; fully expands on click (no inner scroll)


function applyOverflowToggles(isLocked) {
  LONG_FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    const wrap = el.closest(".field") || el.parentElement;
    if (!wrap) return;

    // Ensure base collapsed class when locked
    wrap.classList.toggle("collapsible", !!isLocked);

    // find or create the button
    let btn = wrap.querySelector(".expand-btn");
    if (!isLocked) {
      // Editing mode: show full content, remove button and any forced sizing
      wrap.classList.remove("expanded");
      if (btn) btn.remove();
      el.style.maxHeight = "";
      el.style.overflow = "";
      el.style.height = "";
      return;
    }

    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "expand-btn";
      Object.assign(btn.style, {
        border: "1px solid var(--line)",
        background: "#fff",
        borderRadius: "8px",
        fontSize: "12px",
        padding: "2px 6px",
        alignSelf: "start",
        cursor: "pointer",
        marginTop: "4px"
      });
      btn.textContent = "Expand ▾";
      btn.setAttribute("aria-expanded", "false");
      el.insertAdjacentElement("afterend", btn);

      btn.addEventListener("click", () => {
        const expanded = wrap.classList.toggle("expanded");
        btn.textContent = expanded ? "Collapse ▴" : "Expand ▾";
        btn.setAttribute("aria-expanded", expanded ? "true" : "false");

        if (expanded) {
          // FULLY EXPAND: remove height limits and allow content to grow naturally
          el.style.maxHeight = "none";
          el.style.overflow = "visible";
          // for textareas, grow to full content height
          if (el.tagName.toLowerCase() === "textarea") {
            el.style.height = "auto";
            el.style.height = (el.scrollHeight + 2) + "px";
          } else {
            el.style.height = "auto";
          }
        } else {
          // COLLAPSE: restore compact view
          el.style.maxHeight = "84px";
          el.style.overflow = "hidden";
          // keep a reasonable collapsed height for textareas
          if (el.tagName.toLowerCase() === "textarea") {
            el.style.height = "84px";
          }
        }
      });
    }

    // Initial locked-state sizing (collapsed by default)
    if (!wrap.classList.contains("expanded")) {
      el.style.maxHeight = "84px";
      el.style.overflow = "hidden";
      if (el.tagName.toLowerCase() === "textarea") el.style.height = "84px";
    }
  });
}
function hideAgeInputsAndStatus() {
  // Hide separate Age fields (years & months)
  const fAgeYears = document.getElementById("fAgeYears");
  const fAgeMonths = document.getElementById("fAgeMonths");
  [fAgeYears, fAgeMonths].forEach(el => {
    if (!el) return;
    const field = el.closest(".field") || el.parentElement;
    if (field) field.style.display = "none";
    else el.style.display = "none";
  });

  // Hide status readout
  const statusText = document.getElementById("statusText");
  if (statusText) {
    const wrap = statusText.closest(".status-readout") || statusText.parentElement;
    if (wrap) wrap.style.display = "none";
    else statusText.style.display = "none";
  }
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
  // NEW: reflect FAB mode to match lock state
  try { syncDetailsFab(); } catch {}
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
  const fHospitalIdEl = document.getElementById("fHospitalID") || document.getElementById("fHospital");
  const hospitalId = (fHospitalIdEl?.value || "").trim();

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
    Hospital: hospitalId,  // <-- store ID
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

  // (existing lines above unchanged)
  // Ensure options exist (in case hydrate is called before populate — safe no-op if already done)
  // If you followed the call order suggested above, options already exist and this is fine:
  const sel = document.getElementById("fHospital");
  if (sel && sel.tagName.toLowerCase() === "select") {
    sel.value = d.Hospital || "";
    const hid = document.getElementById("fHospitalID");
    if (hid) hid.value = sel.value || "";
  } else {
    // fallback to plain input if the page hasn’t swapped yet (shouldn’t happen with the calls above)
    fHospital.value = d.Hospital || "";
  }

  // continue with your existing hydrations...
  fName.value = d.Name || ""; fMemberID.value = d.MemberID || "";
  fNationality.value = d.Nationality || "";
  fDOB.value = toInputDate(d.DOB);
  fPolicyEff.value = toInputDate(d.PolicyEffectiveDate);
  fUWType.value = d.UnderwritingType || "";
  fAdmissionType.value = d.TypeOfAdmission || "";
  fConsultType.value = d.TypeOfConsultation || "";
  fVisitDate.value = toInputDate(d.VisitDate);
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
// Floating unified primary button (FAB) with icons

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
  hideAgeInputsAndStatus();

  // Always ensure field order and DOB age chip exist
  reorderFields();
  ensureAgeInline();
  syncDeadlineVisibility();

  const id = getHashId();
  state.caseId = id;
  state.isNew = (id === "new");

  // Hide legacy button areas; we control a single FAB
  if (saveDetailsBtn) saveDetailsBtn.hidden = true;
  if (newCaseActions) newCaseActions.classList.add("hidden");

  if (state.isNew) {
    // NEW MODE
    state.caseDoc = null;
    statusText.textContent = "—";
    await populateHospitalOptions("");  // no selection yet
    clearDetailsForm();
    lockFields(false);         // allow typing
    setTabsEnabled(false);     // lock other tabs
    if (downloadPdfBtn) downloadPdfBtn.hidden = true;

    // Use the FAB for "Create"
    /*fab.setDetails("create", async () => {
      showLoading();
      try {
        syncDeadlineVisibility(); // enforce deadline requirement if urgent
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

        // switch URL to created id and reload record
        location.hash = `#${created.id}`;
        state.isNew = false;

        const fresh = await getCase(created.id);
        state.caseDoc = fresh;
        hydrateFormFromDoc(fresh);

        lockFields(true);
        setTabsEnabled(true);
        if (downloadPdfBtn) downloadPdfBtn.hidden = false;

        // Now wire Edit↔Save for existing case
        wirePrimaryButtonForExisting();
        document.dispatchEvent(new Event("caseLoaded"));
      } finally {
        hideLoading();
      }
    });*/
    // Use the FAB for "Create"
detailsFabHandlers.onCreate = async () => {
  showLoading();
  try {
    syncDeadlineVisibility(); // enforce deadline requirement if urgent
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

    // switch URL to created id and reload record
    location.hash = `#${created.id}`;
    state.isNew = false;

    const fresh = await getCase(created.id);
    state.caseDoc = fresh;
    hydrateFormFromDoc(fresh);

    lockFields(true);
    setTabsEnabled(true);
    if (downloadPdfBtn) downloadPdfBtn.hidden = false;

    // Now wire Edit↔Save for existing case
    wirePrimaryButtonForExisting();
    document.dispatchEvent(new Event("caseLoaded"));
  } finally {
    hideLoading();
  }
};

// Let sync decide the correct icon (✓ for Create because #new is unlocked)
syncDetailsFab();


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
await populateHospitalOptions((doc?.details?.Hospital) || "");
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



function wirePrimaryButtonForExisting() {
  const role = (state.role || "").toLowerCase();

  // Non-nurse roles: keep fields locked and show a non-actionable "Edit" (role guards will hide it)
  if (role !== "nurse") {
    try { lockFields?.(true); } catch {}
    detailsFabHandlers.onEdit = null;
    detailsFabHandlers.onSave = null;
    fab.setDetails("edit", null);
    return;
  }

  let saving = false;

  const enterEdit = () => {
    lockFields(false);           // unlock fields
    syncDetailsFab();            // FAB becomes ✓ Save
  };

  const onSave = async () => {
    if (saving) return;
    saving = true;
    showLoading();
    try {
      // Build a proper patch like createCase uses
      const details = gatherDetailsFromForm();
      const patch = {
        details,
        urgent: !!(fUrgent && fUrgent.checked),
        deadlineAt: fDeadline?.value ? new Date(fDeadline.value) : null
      };

      await updateCase(state.caseId, patch, state.user);

      lockFields(true);          // re-lock after save
      syncDetailsFab();          // FAB becomes ✏ Edit
    } catch (err) {
      console.error("Save failed:", err);
      alert("Failed to save changes. Please try again.");
      // stay in Save state
      try { syncDetailsFab(); } catch {}
    } finally {
      hideLoading();
      saving = false;
    }
  };

  // expose handlers for the sync engine
  detailsFabHandlers.onEdit = enterEdit;
  detailsFabHandlers.onSave = onSave;

  // Start locked for existing cases; FAB will show ✏ Edit
  lockFields(true);
  syncDetailsFab();
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
// Called by case-shared.js when starting a NEW case
export function updateAgeFields() {
  setAgeInline(fDOB?.value, fVisitDate?.value);
}
