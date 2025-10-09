// /js/case-role-guards.js
import { state } from "/js/case-shared.js";

const q  = (s, r = document) => r.querySelector(s);
const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

function isDoctor() {
  return (state?.role || "").toLowerCase() === "doctor";
}

/* ----- Details: hide/disable Edit triggers (leave fields as-is) ----- */
function killDetailsEdit() {
  // Explicit known hooks
  [
    "#editDetailsBtn",
    'button[data-action="edit-details"]',
    'button[data-role="edit-details"]',
  ].forEach(sel => {
    const el = q(sel);
    if (el) {
      el.style.display = "none";
      el.disabled = true;
      el.setAttribute("aria-disabled", "true");
    }
  });

  // FABs or other buttons that look like Edit
  qa(".fab, button.fab, .floating-action, .floating-btn, button, a").forEach(b => {
    const label = `${b.id || ""} ${b.title || ""} ${b.getAttribute?.("aria-label") || ""} ${b.textContent || ""}`.toLowerCase();
    if (/(^|\s)edit(\s|$)|edit details|pencil/.test(label)) {
      b.style.display = "none";
      b.disabled = true;
      b.setAttribute?.("aria-disabled", "true");
    }
  });

  // Prevent late “Edit” clicks (defensive)
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) return;
    const label = `${t.id || ""} ${t.dataset?.action || ""} ${t.dataset?.role || ""} ${t.title || ""} ${t.getAttribute?.("aria-label") || ""} ${t.textContent || ""}`.toLowerCase();
    if (/(^|\s)edit(\s|$)|edit-details|edit details/.test(label)) {
      e.stopPropagation(); e.preventDefault();
    }
  }, { capture: true });
}

/* ----- Tabs: hide Manage/Documents for doctors ----- */
function hideManageTab() {
  const tabsRoot = q("nav.tabs") || document;

  const manageTab =
    q('.tabs .tab[data-tab="manage"]', tabsRoot) ||
    q('.tabs a[href="#manage"]', tabsRoot) ||
    q('#tab-manage', tabsRoot) ||
    // fallback by visible text
    qa(".tabs .tab, .tabs a, .tab", tabsRoot).find(el =>
      (el.textContent || "").trim().toLowerCase().includes("manage") ||
      (el.textContent || "").trim().toLowerCase().includes("documents")
    );

  if (manageTab) {
    const active = manageTab.classList.contains("active") || manageTab.getAttribute("aria-selected") === "true";
    manageTab.style.display = "none";
    if (active) {
      const detailsTab =
        q('.tabs .tab[data-tab="details"]', tabsRoot) ||
        q('.tabs a[href="#details"]', tabsRoot) ||
        q('#tab-details', tabsRoot) ||
        qa(".tabs .tab, .tabs a", tabsRoot).find(el => el.style.display !== "none");
      detailsTab?.click?.();
    }
  }

  // Hide panel if directly accessible
  ["#manage", "#managePanel", "#docManage", "#documents", '[data-tab-panel="manage"]']
    .forEach(sel => { const el = q(sel); if (el) el.style.display = "none"; });

  // Close overlay if your code exposes it
  try { window.closeManageOverlay?.(); } catch {}
}

function applyRoleGuards() {
  if (!isDoctor()) return;
  killDetailsEdit();
  hideManageTab();
}

// Apply after case is loaded
let tries = 0;
function runWithRetries() {
  applyRoleGuards();
  if (++tries < 5) setTimeout(applyRoleGuards, 120 * tries); // catch late FAB injection
}
document.addEventListener("caseLoaded", runWithRetries);
document.addEventListener("DOMContentLoaded", () => { if (state?.role) runWithRetries(); });

// Watch for dynamic UI changes
new MutationObserver(() => { if (isDoctor()) applyRoleGuards(); })
  .observe(document.documentElement, { childList: true, subtree: true });
