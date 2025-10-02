// /js/index-role-guards.js
// Show "Create" for everyone EXCEPT doctors.
// Important: do NOT depend on global auth/user; rely on DOM signals only.

(function () {
  const q  = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---------- Button lookup ----------
  let createBtn, originalDisplay = "";
  function findCreateBtn() {
    if (createBtn && document.body.contains(createBtn)) return createBtn;

    const candidates = [
      "#newCaseBtn",               // index.html FAB
      "#createBtn",
      "[data-action='create-case']",
      ".btn-create",
      "button#create",
      "a#create",
      "[data-test='create']",
    ];
    for (const sel of candidates) {
      const el = q(sel);
      if (el) {
        createBtn = el;
        const cs = getComputedStyle(el);
        originalDisplay = el.style.display || (cs && cs.display !== "none" ? "" : "");
        return createBtn;
      }
    }

    // Fallback by text (rarely needed)
    const guess = qa("button, a").find(el => {
      const t = (el.textContent || "").trim().toLowerCase();
      return t === "create" || t.includes("create case") || t.includes("new case");
    });
    if (guess) {
      createBtn = guess;
      const cs = getComputedStyle(guess);
      originalDisplay = guess.style.display || (cs && cs.display !== "none" ? "" : "");
    }
    return createBtn;
  }

  function hideBtn(btn) {
    if (!btn) return;
    btn.hidden = true;
    btn.setAttribute("aria-hidden", "true");
    btn.style.display = "none";
  }
  function showBtn(btn) {
    if (!btn) return;
    btn.hidden = false;
    btn.removeAttribute("aria-hidden");
    btn.style.display = originalDisplay ?? "";
  }

  // ---------- Role / screen via DOM ----------
  function normalizeRole(val) {
    if (!val) return "";
    if (Array.isArray(val)) {
      const first = val.map(x => String(x || "").toLowerCase()).find(Boolean);
      return first || "";
    }
    return String(val).toLowerCase();
  }

  function getRoleFromDOM() {
    // Your UI pill in the drawer
    const pill = q("#rolePill");
    if (pill && pill.textContent) return normalizeRole(pill.textContent.trim());

    // Data/meta fallbacks (future-proof)
    const roleDataEl = q("[data-user-role], [data-role], [data-role-current]");
    const roleData = roleDataEl?.dataset?.userRole || roleDataEl?.dataset?.role || roleDataEl?.dataset?.roleCurrent;
    if (roleData) return normalizeRole(roleData);

    const metaRole = q('meta[name="user-role"]')?.getAttribute("content");
    if (metaRole) return normalizeRole(metaRole);

    // localStorage fallback if you ever set it
    try {
      const lsRole = localStorage.getItem("role") || localStorage.getItem("userRole");
      if (lsRole) return normalizeRole(lsRole);
    } catch {}

    return "";
  }

  function isSignInScreen() {
    // index.html exposes #signinBox (visible when signed out)
    const box = q("#signinBox");
    if (box && !box.classList.contains("hidden")) return true;

    // generic hints
    const hints = [
      "#signin", ".sign-in", ".login-card", ".auth-card",
      'form[action*="signin"]', 'form[action*="login"]',
      "#googleSignIn", "#microsoftSignIn",
      "[data-action='sign-in']", "[data-action='microsoft-sign-in']",
    ];
    if (hints.some(sel => q(sel))) return true;

    return false;
  }

  // ---------- Guard logic (conflict-free) ----------
  function applyGuard() {
    const btn = findCreateBtn();
    if (!btn) return;

    // Only force-hide when the sign-in UI is showing.
    if (isSignInScreen()) { hideBtn(btn); return; }

    const role = getRoleFromDOM();

    // Unknown role? Don't override whatever the page did.
    if (!role) return;

    // Only doctors are blocked; everyone else is allowed.
    if (role === "doctor") hideBtn(btn);
    else showBtn(btn);
  }

  // ---------- Wire up ----------
  function init() {
    applyGuard();

    // Retry briefly for late role UI
    let tries = 0, maxTries = 20;
    const iv = setInterval(() => {
      applyGuard();
      if (++tries >= maxTries) clearInterval(iv);
    }, 200);

    // React to DOM/UI updates
    const mo = new MutationObserver(() => applyGuard());
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // If your app dispatches these, we'll re-apply.
    ["roleChanged", "appReady"].forEach(ev =>
      document.addEventListener(ev, applyGuard)
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
