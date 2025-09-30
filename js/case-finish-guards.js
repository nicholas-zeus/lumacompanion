// /js/case-finish-guards.js
import { state } from "/js/case-shared.js";

const q = (s, r = document) => r.querySelector(s);
const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

function isFinished() {
    return (state?.caseDoc?.status || "").toLowerCase() === "finished";
}

/* -- DETAILS: only hide Edit triggers (leave fields as they are by default lock) -- */
function hideDetailsEditTriggers() {
    // Explicit buttons you likely have
    const explicit = [
        "#editDetailsBtn",
        'button[data-action="edit-details"]',
        'button[data-role="edit-details"]',
    ];
    explicit.forEach(sel => { const el = q(sel); if (el) el.style.display = "none"; });

    // Any FABs that look like "Edit" (FABs are added to <body>)
    qa(".fab, button.fab, .floating-action, .floating-btn").forEach(b => {
        const label = `${b.id || ""} ${b.title || ""} ${b.getAttribute?.("aria-label") || ""} ${b.textContent || ""}`.toLowerCase();
        if (/(^|\s)edit(\s|$)|edit details|pencil/.test(label)) {
            b.style.display = "none";
            b.setAttribute?.("aria-hidden", "true");
        }
    });
}

/* -- COMMENTS: hide new comment composer -- */
function hideNewCommentComposer() {
    // Your exact selectors:
    const idBox = q("#commentform");
    const classBox = q(".comment-form");
    if (idBox) {
        idBox.style.display = "none";
        qa("textarea, input, button, select", idBox).forEach(disableEl);
    }
    if (classBox) {
        classBox.style.display = "none";
        qa("textarea, input, button, select", classBox).forEach(disableEl);
    }

    // Fallbacks (in case DOM differs on some pages)
    const fallbacks = [
        "#newCommentForm", "#commentComposer", ".comment-composer", ".comment-new",
        ".comments .composer"
    ];
    fallbacks.forEach(sel => {
        const el = q(sel);
        if (el) {
            el.style.display = "none";
            qa("textarea, input, button, select", el).forEach(disableEl);
        }
    });
}

function disableEl(el) {
    el.disabled = true;
    el.setAttribute("aria-disabled", "true");
}

/* -- MANAGE/DOCUMENTS tab already handled by your previous run; keep it here for completeness -- */
function hideManageTabAndPanel() {
    const manageTab =
        q('.tabs .tab[data-tab="manage"]') ||
        q('.tabs a[href="#manage"]') ||
        q('#tab-manage');

    if (manageTab) manageTab.style.display = "none";

    ["#manage", "#managePanel", "#docManage", "#documents", '[data-tab-panel="manage"]']
        .forEach(sel => { const el = q(sel); if (el) el.style.display = "none"; });

    try { window.closeManageOverlay?.(); } catch { }
}

function applyGuards() {
    if (!isFinished()) return;
    hideDetailsEditTriggers();
    hideManageTabAndPanel();
    hideNewCommentComposer();
}

/* Retry a few times to catch late-injected UI (FABs, etc.) */
let tries = 0;
function applyWithRetries() {
    applyGuards();
    if (++tries < 5) setTimeout(applyGuards, 120 * tries);
}

document.addEventListener("caseLoaded", applyWithRetries);
document.addEventListener("DOMContentLoaded", () => { if (state?.caseDoc) applyWithRetries(); });

/* MutationObserver in case tabs/composer render later */
new MutationObserver(() => { if (isFinished()) applyGuards(); })
    .observe(document.documentElement, { childList: true, subtree: true });
