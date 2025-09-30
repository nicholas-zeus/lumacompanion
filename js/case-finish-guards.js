// /js/case-finish-guards.js
// When a case is "finished":
// - Disable Edit button on Details tab
// - Hide Manage/Documents tab (and its panel/overlay) for ALL roles
// - Hide the New Comment composer on Comments tab

import { state } from "/js/case-shared.js";

function isFinished() {
  return (state?.caseDoc?.status || "").toLowerCase() === "finished";
}

function disableDetailsEditBtn() {
  // Try a few likely selectors (keeps current CSS/HTML intact)
  const candidates = [
    "#editDetailsBtn",
    'button[data-action="edit-details"]',
    'button[data-role="edit-details"]',
  ];
  const btn = document.querySelector(candidates.join(","));
  if (!btn) return;

  btn.disabled = true;
  btn.setAttribute("aria-disabled", "true");
  btn.classList.add("is-disabled");

  // Optional: make it clearly non-interactive without changing your theme
  btn.style.pointerEvents = "none";
  btn.style.opacity = "0.6";
}

function hideManageTabAndPanel() {
  // Likely tab button/anchor
  const tabCandidates = [
    '.tabs .tab[data-tab="manage"]',
    '.tabs a[href="#manage"]',
    "#tab-manage",
    '[data-nav="manage"]',
  ];
  const tabEl = document.querySelector(tabCandidates.join(","));
  if (tabEl) {
    tabEl.style.display = "none";
  }

  // If currently on Manage tab, switch to Details to avoid empty screen
  const activeTab = document.querySelector(".tabs .tab.active");
  if (activeTab && (activeTab === tabEl)) {
    // Try to click Details tab safely
    const detailsTab =
      document.querySelector('.tabs .tab[data-tab="details"]') ||
      document.querySelector('.tabs a[href="#details"]') ||
      document.querySelector("#tab-details");
    detailsTab?.click?.();
  }

  // Hide the panel itself if it's visible in-page
  const panelCandidates = ["#manage", "#managePanel", "#docManage", "#documents"];
  const panel = document.querySelector(panelCandidates.join(","));
  if (panel) {
    panel.style.display = "none";
  }

  // Close any floating/overlay Manage UI if present
  try {
    // your project already defines these in case-manage.js (no-op if absent)
    if (window.closeManageOverlay) window.closeManageOverlay();
  } catch { /* ignore */ }
}

function hideNewCommentComposer() {
  // Try common composer containers (keeps current HTML intact)
  const boxCandidates = [
    "#newCommentForm",
    "#commentComposer",
    ".comment-composer",
    ".comment-new",
    ".comments .composer",
  ];
  const box = document.querySelector(boxCandidates.join(","));
  if (!box) return;

  // Hide the whole composer UI
  box.style.display = "none";

  // Also defensively disable inputs if you keep layout space
  box.querySelectorAll("textarea, input, button").forEach(el => {
    el.disabled = true;
    el.setAttribute("aria-disabled", "true");
  });
}

function applyFinishGuards() {
  if (!isFinished()) return;
  disableDetailsEditBtn();
  hideManageTabAndPanel();
  hideNewCommentComposer();
}

// Run after the case is fully loaded
document.addEventListener("caseLoaded", applyFinishGuards);

// In case caseLoaded fired before this script loaded
document.addEventListener("DOMContentLoaded", () => {
  if (state?.caseDoc) applyFinishGuards();
});
