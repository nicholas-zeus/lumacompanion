// /js/case-menu.js
// Lightweight overflow (⋯) menu for the tab row.
// - Inline with tabs, right-aligned
// - Items hidden based on finished/unfinished + role
// - Actions: Mark Finished, Reopen, Download PDF, Copy (text), Share (URL)

import { state } from "/js/case-shared.js";
import {
  finishCase,
  undoFinish,
  listComments,
  getCommentMQ,
} from "/js/api.js";
import { buildTranscriptPDF, downloadBlob } from "/js/pdf-export.js";
import { toDate } from "/js/utils.js";

/* ---------- DOM helpers ---------- */
function $(sel, root = document) { return root.querySelector(sel); }
function create(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of children) el.append(c);
  return el;
}

/* ---------- Singleton UI ---------- */
let wrap, btn, menu;
function ensureMenuShell() {
  if (wrap && btn && menu) return;
  const tabsWrap = document.querySelector('nav.tabs .page-wrap');
  if (!tabsWrap) return;

  // Avoid duplicates if re-initialized
  wrap = tabsWrap.querySelector(".tabs-overflow");
  if (!wrap) {
    wrap = create("div", { className: "tabs-overflow" });
    tabsWrap.appendChild(wrap);
  } else {
    wrap.innerHTML = "";
  }

  btn = create("button", {
    className: "tab-overflow-btn",
    type: "button",
    ariaHasPopup: "true",
    ariaExpanded: "false",
    title: "More actions",
  });
  btn.textContent = "⋯";

  menu = create("div", { className: "tab-menu", role: "menu" });

  wrap.append(btn, menu);

  // Toggle logic
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !menu.classList.contains("is-open");
    setOpen(open);
  });

  // Close on outside click / Esc
  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("is-open")) return;
    if (!wrap.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.classList.contains("is-open")) {
      setOpen(false);
      btn.focus();
    }
  });
}

function setOpen(open) {
  if (!menu || !btn) return;
  menu.classList.toggle("is-open", !!open);
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

/* ---------- State-driven menu ---------- */
function isFinished() {
  return (state.caseDoc?.status || "").toLowerCase() === "finished";
}
function isNurseOrAdmin() {
  const r = (state.role || "").toLowerCase();
  return r === "nurse" || r === "admin";
}

function clearMenu() { if (menu) menu.innerHTML = ""; }
function addItem(label, onClick) {
  const it = create("button", { className: "menu-item", type: "button" });
  it.textContent = label;
  it.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    try {
      await onClick();
    } catch (err) {
      console.error(err);
      showBanner(`Action failed: ${err?.message || err}`, "error");
    }
  });
  menu.appendChild(it);
}

function renderMenu() {
  if (!wrap || !menu || !state.caseDoc) return;
  clearMenu();

  const finished = isFinished();
  const canToggleFinish = isNurseOrAdmin();

  if (!finished) {
    if (canToggleFinish) addItem("Mark Finished", onMarkFinished);
    addItem("Copy", onCopyTranscript);
    addItem("Share", onShareUrl);
  } else {
    addItem("Download PDF", onDownloadPDF);
    if (canToggleFinish) addItem("Reopen", onReopen);
    addItem("Copy", onCopyTranscript);
    addItem("Share", onShareUrl);
  }
}

/* ---------- Actions ---------- */
async function onMarkFinished() {
  if (!state.caseId || !state.user) throw new Error("Missing case/user.");
  await finishCase(state.caseId, state.user);
  state.caseDoc = { ...(state.caseDoc || {}), status: "finished", finishedAt: new Date() };
  // Minimal UI sync for now: reload to let existing modules lock fields, etc.
  location.reload();
}

async function onReopen() {
  if (!state.caseId || !state.user) throw new Error("Missing case/user.");
  await undoFinish(state.caseId, state.user);
  state.caseDoc = { ...(state.caseDoc || {}), status: "reopened", finishedAt: null };
  location.reload();
}

async function onDownloadPDF() {
  const { caseDoc } = state;
  if (!caseDoc?.id && !state.caseId) throw new Error("Missing case id.");

  const comments = await listComments(state.caseId);
  const mqMap = {};
  for (const c of comments) {
    mqMap[c.id] = await getCommentMQ(c.id);
  }

  const blob = await buildTranscriptPDF({ caseDoc, comments, mqMap });
  const fname = `Case-${caseDoc.id || state.caseId}.pdf`;
  downloadBlob(blob, fname);
  showBanner("PDF ready.", "ok");
}

async function onCopyTranscript() {
  const { caseDoc } = state;
  if (!caseDoc) throw new Error("No case loaded.");

  // DETAILS (prefer stored doc details to avoid reading live form states)
  const d = caseDoc.details || {};
  const lines = [];
  lines.push(`# Case ${caseDoc.id || state.caseId}`);
  const status = caseDoc.status ? String(caseDoc.status).toUpperCase() : "—";
  lines.push(`Status: ${status}`);
  if (caseDoc.createdAt) lines.push(`Created: ${fmt(caseDoc.createdAt)}`);
  if (caseDoc.finishedAt) lines.push(`Finished: ${fmt(caseDoc.finishedAt)}`);
  lines.push("");
  lines.push("## Details");
  for (const [k, v] of Object.entries(d)) {
    if (v == null || String(v).trim() === "") continue;
    lines.push(`- ${k}: ${String(v).trim()}`);
  }

  // COMMENTS + MQ
  lines.push("");
  lines.push("## Comments (with Medical Questionnaire)");
  const comments = await listComments(state.caseId);
  if (!comments.length) {
    lines.push("_No comments_");
  } else {
    for (const c of comments) {
      const when = fmt(c.createdAt || c.updatedAt);
      const who = c.author?.displayName || c.author?.email || "Unknown";
      lines.push(`\n**${who} — ${when}**`);
      if (c.body) lines.push(String(c.body).trim());

      const mq = await getCommentMQ(c.id);
      if (mq && Object.keys(mq).length) {
        lines.push("  Medical Questionnaire:");
        for (const [mk, mv] of Object.entries(mq)) {
          if (mv == null || String(mv).trim() === "") continue;
          lines.push(`  - ${mk}: ${String(mv).trim()}`);
        }
      }
    }
  }

  const text = lines.join("\n");
  await navigator.clipboard.writeText(text);
  showBanner("Copied case details + comments to clipboard.", "ok");
}

async function onShareUrl() {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    showBanner("Case URL copied.", "ok");
  } catch {
    showBanner("Could not copy URL.", "error");
  }
}

/* ---------- Utilities ---------- */
function fmt(firebaseTsOrDate) {
  try {
    return toDate(firebaseTsOrDate)?.toLocaleString() || "";
  } catch { return ""; }
}

let bannerEl;
function ensureBanner() {
  if (bannerEl) return bannerEl;
  bannerEl = create("div");
  Object.assign(bannerEl.style, {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%)",
    bottom: "16px",
    background: "var(--panel)",
    color: "var(--ink)",
    border: "1px solid var(--line)",
    boxShadow: "var(--shadow)",
    borderRadius: "10px",
    padding: "10px 12px",
    zIndex: "1100",
    display: "none",
  });
  document.body.appendChild(bannerEl);
  return bannerEl;
}
let bannerTimer;
function showBanner(msg, level = "ok") {
  const el = ensureBanner();
  el.textContent = msg;
  el.style.display = "block";
  el.style.opacity = "1";
  // subtle transparency for "ok"
  el.style.background = level === "ok" ? "color-mix(in oklab, var(--panel), transparent 0%)" : "var(--panel)";
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    el.style.transition = "opacity .2s ease";
    el.style.opacity = "0";
    setTimeout(() => { el.style.display = "none"; el.style.transition = ""; }, 220);
  }, 1600);
}

/* ---------- Init ---------- */
function initMenu() {
  ensureMenuShell();
  renderMenu();
}

// Build when the case is ready (status + role present)
document.addEventListener("caseLoaded", () => {
  initMenu();
});

// Also try once on DOM ready (in case caseLoaded already fired)
document.addEventListener("DOMContentLoaded", () => {
  if (state?.caseDoc) initMenu();
});
