// case-shared.js
import { initFirebase, onAuth, signOutNow } from "/js/firebase.js";
import { loadRole, getCase, updateCase, finishCase, undoFinish } from "/js/api.js";
import { toDate } from "/js/utils.js";

export const state = {
  caseId: null,
  isNew: false,
  caseDoc: null,
  isEditing: false,
  role: null,
  user: null,
  // Upload staging
  stagedFile: null,
  stagedIsPdf: false,
  // View Documents
  docviewLoaded: false,
  uploadsIndex: [],
  uploadsById: new Map(),
  allTags: new Set(),
  tagHits: [],
  pageIndex: new Map(),
};

// --- DOM ---
export const roleBadge = document.getElementById("roleBadge");
export const avatar = document.getElementById("avatar");
export const signOutBtn = document.getElementById("signOutBtn");
export const bannerArea = document.getElementById("bannerArea");

export function getHashId() {
  const h = (location.hash || "").slice(1);
  return h || "new";
}
export function setActiveTab(name) {
  document.querySelectorAll(".tab").forEach(b =>
    b.classList.toggle("is-active", b.dataset.tab === name)
  );
  document.querySelectorAll(".tabpanel").forEach(el =>
    el.classList.toggle("is-active", el.id === `tab-${name}`)
  );
}
export function setHeaderUser(user, role) {
  if (!user) return;
  roleBadge.hidden = false;
  roleBadge.textContent = (role || "").toUpperCase();
  signOutBtn.hidden = false;
  avatar.hidden = false;
  avatar.alt = user.displayName || user.email || "User";
}
export function toInputDate(d) {
  const dt = toDate(d); if (!dt) return "";
  return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
export function toInputDateTimeLocal(d) {
  const dt = toDate(d); if (!dt) return "";
  return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

signOutBtn.addEventListener("click", () => signOutNow());
// Tab switching
const tabsNav = document.querySelector(".tabs");
tabsNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  setActiveTab(btn.dataset.tab);

  // Special: load View tab on demand
  if (btn.dataset.tab === "docview") {
    import("/js/case-view.js").then(m => m.ensureDocviewLoaded()).catch(console.error);
  }
});


// Init Firebase + auth
initFirebase();
onAuth(async (user) => {
  if (!user) { location.href = "/index.html"; return; }
  state.user = user;
  state.role = await loadRole();
  setHeaderUser(user, state.role);

  const { loadCase } = await import("/js/case-details.js");
  await loadCase();
  if (state.isNew) {
    const { updateAgeFields } = await import("/js/case-details.js");
    updateAgeFields();
  }
});
