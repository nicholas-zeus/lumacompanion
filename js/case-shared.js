// case-shared.js
import { initFirebase, onAuth, signOutNow } from "/js/firebase.js";
import { loadRole, getCase, updateCase, finishCase, undoFinish } from "/js/api.js";
import { toDate } from "/js/utils.js";
// /js/case-shared.js (top-level imports)
import { fab } from "/js/fab.js";
fab.init();


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
// Tab switching
const tabsNav = document.querySelector(".tabs");
tabsNav.addEventListener("click", async (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;

  const tabName = btn.dataset.tab;
  setActiveTab(tabName);
  updateFloatingUI(tabName);

  try {
    if (tabName === "docview") {
      const m = await import("/js/case-view.js");
      await m.ensureDocviewLoaded();
    } else if (tabName === "comments") {
      const m = await import("/js/case-comments.js");
      if (typeof m.renderComments === "function") {
        await m.renderComments();
      }
      const form = document.getElementById("commentForm");
      form?.scrollIntoView({ behavior: "smooth", block: "start" });
      const ta = document.getElementById("commentBody");
      ta?.focus();
    }
  } catch (err) {
    console.error("tab init failed:", err);
  }
});

/*function updateFloatingUI(tabName) {
  // Details FAB
  const detailsFab = document.getElementById("detailsFab");
  if (detailsFab) detailsFab.hidden = (tabName !== "details");

  // DocView "Go to Top" button
  const goTopBtn = document.getElementById("goTopBtn");
  if (goTopBtn) goTopBtn.style.display = (tabName === "docview" ? "grid" : "none");

  // Manage tab FABs live inside #tab-documents, so they hide with the panel automatically.
}*/

// inside setActiveTab flow you already have
function updateFloatingUI(tabName) {
  fab.setTab(tabName); // <-- single source of truth
  // remove the old element-specific toggles here (detailsFab/goTopBtn), fab handles it
}

document.addEventListener("caseLoaded", () => {
  const activeTab = document.querySelector(".tab.is-active")?.dataset?.tab || "details";
  updateFloatingUI(activeTab);
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
