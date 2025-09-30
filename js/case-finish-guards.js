// /js/case-finish-guards.js
import { state } from "/js/case-shared.js";

/* ---------- helpers ---------- */
const q = (s, r = document) => r.querySelector(s);
const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
const byText = (root, sel, text) =>
  qa(sel, root).find(el => (el.textContent || "").trim().toLowerCase().includes(text));

function isFinished() {
  return (state?.caseDoc?.status || "").toLowerCase() === "finished";
}

/* ---------- DETAILS: lock all inputs + kill edit buttons/FABs ---------- */
function lockDetailsArea() {
  // 1) Prefer explicit form if present
  const form =
    q("#detailsForm") ||
    q('form[data-section="details"]') ||
    q('#details, [data-tab-panel="details"], [role="tabpanel"][data-tab="details"]');

  if (form) {
    qa("input, select, textarea, button", form).forEach(el => {
      // keep non-edit buttons (like navigation) enabled
      const type = (el.type || "").toLowerCase();
      const isPrimaryEditButton =
        /edit/.test((el.id || "").toLowerCase()) ||
        /edit/.test((el.dataset?.action || "").toLowerCase()) ||
        /edit/.test((el.dataset?.role || "").toLowerCase()) ||
        /edit/.test((el.title || "").toLowerCase()) ||
        /edit/.test((el.getAttribute?.("aria-label") || "").toLowerCase()) ||
        /edit/.test((el.textContent || "").toLowerCase());

      if (["text","number","email","tel","date","datetime-local","time","url","search","checkbox","radio","file","color","range","month","week","password"].includes(type) ||
          el.tagName === "TEXTAREA" || el.tagName === "SELECT" || isPrimaryEditButton) {
        el.disabled = true;
        el.setAttribute("aria-disabled", "true");
        el.style.pointerEvents = "none";
        if (isPrimaryEditButton) el.style.opacity = "0.5";
      }
    });

    // ContentEditable fields (if any)
    qa("[contenteditable=''], [contenteditable='true']", form).forEach(el => {
      el.setAttribute("contenteditable", "false");
      el.classList.add("is-locked");
      el.style.userSelect = "text";
    });
  }

  // 2) Specific well-known button ids/classes
  [
    "#editDetailsBtn",
    'button[data-action="edit-details"]',
    'button[data-role="edit-details"]'
  ].forEach(s => {
    const b = q(s);
    if (b) {
      b.disabled = true;
      b.setAttribute("aria-disabled", "true");
      b.style.pointerEvents = "none";
      b.style.opacity = "0.5";
    }
  });

  // 3) Any FABs that look like Edit
  qa(".fab, button.fab, .floating-action, .floating-btn").forEach(b => {
    const label = `${b.title || ""} ${b.getAttribute?.("aria-label") || ""} ${b.textContent || ""}`.toLowerCase();
    if (/(^|\s)edit(\s|$)|edit details|pencil/.test(label)) {
      b.style.display = "none";
      b.disabled = true;
      b.setAttribute("aria-disabled", "true");
    }
  });

  // 4) As a final guard, intercept any late “Edit” clicks
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) return;
    const label = `${t.id || ""} ${t.dataset?.action || ""} ${t.dataset?.role || ""} ${t.title || ""} ${t.getAttribute?.("aria-label") || ""} ${t.textContent || ""}`.toLowerCase();
    if (/(^|\s)edit(\s|$)|edit-details|edit details/.test(label)) {
      e.stopPropagation(); e.preventDefault();
    }
  }, { capture: true });
}

/* ---------- MANAGE/DOCUMENTS tab: hide tab + panel/overlay ---------- */
function hideManageEverywhere() {
  const tabsRoot = q("nav.tabs") || document;

  // Match by data attributes first
  const manageTab =
    q('.tabs .tab[data-tab="manage"]', tabsRoot) ||
    q('.tabs a[href="#manage"]', tabsRoot) ||
    q('#tab-manage', tabsRoot) ||
    // Fallback: by visible text
    byText(tabsRoot, ".tabs .tab, .tabs a, .tab", "manage") ||
    byText(tabsRoot, ".tabs .tab, .tabs a, .tab", "documents");

  if (manageTab) {
    manageTab.style.display = "none";
    // If it's currently active, switch to Details or first visible tab
    const active = manageTab.classList.contains("active") || manageTab.getAttribute("aria-selected") === "true";
    if (active) {
      const detailsTab =
        q('.tabs .tab[data-tab="details"]', tabsRoot) ||
        q('.tabs a[href="#details"]', tabsRoot) ||
        q('#tab-details', tabsRoot) ||
        qa(".tabs .tab, .tabs a", tabsRoot).find(el => el.style.display !== "none");
      detailsTab?.click?.();
    }
  }

  // Hide likely panels
  [
    "#manage", "#managePanel", "#docManage", "#documents",
    '[data-tab-panel="manage"]'
  ].forEach(sel => { const el = q(sel); if (el) el.style.display = "none"; });

  // Close overlay if project defined it
  try { window.closeManageOverlay?.(); } catch {}
}

/* ---------- COMMENTS: hide “new comment” composer ---------- */
function hideNewCommentComposer() {
  const commentsRoot =
    q("#comments") ||
    q('[data-tab-panel="comments"]') ||
    q('#commentsTabPanel') ||
    document;

  // Common containers
  const composer =
    q("#newCommentForm", commentsRoot) ||
    q("#commentComposer", commentsRoot) ||
    q(".comment-composer", commentsRoot) ||
    q(".comment-new", commentsRoot) ||
    q(".comments .composer", commentsRoot) ||
    // Fallback: any form containing a textarea and a submit button inside comments area
    qa("form", commentsRoot).find(f => q("textarea", f) && (q('button[type="submit"]', f) || q("button", f)));

  if (composer) {
    composer.style.display = "none";
    qa("textarea, input, button, select", composer).forEach(el => {
      el.disabled = true;
      el.setAttribute("aria-disabled", "true");
    });
  }
}

/* ---------- Orchestrator with retries & observer ---------- */
function applyGuards() {
  if (!isFinished()) return;

  lockDetailsArea();
  hideManageEverywhere();
  hideNewCommentComposer();
}

let tries = 0;
function applyWithRetries() {
  applyGuards();
  // Some parts render late — retry a few times
  if (++tries < 6) setTimeout(applyGuards, 120 * tries);
}

// Re-run when DOM mutates (tabs/panels injected later)
const mo = new MutationObserver(() => { if (isFinished()) applyGuards(); });
mo.observe(document.documentElement, { childList: true, subtree: true });

// Run after case is ready
document.addEventListener("caseLoaded", applyWithRetries);
document.addEventListener("DOMContentLoaded", () => { if (state?.caseDoc) applyWithRetries(); });
