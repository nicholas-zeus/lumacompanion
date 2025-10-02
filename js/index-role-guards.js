// /js/index-role-guards.js
// Purpose:
// - Hide "Create" on sign-in screen (no user)
// - Hide "Create" for role === "doctor"
// - Show "Create" for any other role (e.g., "nurse")
// - Resilient against late-initialized globals/DOM; retries briefly and listens for common app events.

(function () {
  const q  = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---------- Find the Create button ----------
  let createBtn, originalDisplay = "";
  function findCreateBtn() {
    if (createBtn && document.body.contains(createBtn)) return createBtn;

    const candidates = [
      "#createBtn",
      "#newCaseBtn",
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

    // Fallback: guess a prominent button with matching text
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
    btn.style.display = "none";
    btn.setAttribute("aria-hidden", "true");
  }
  function showBtn(btn) {
    if (!btn) return;
    btn.style.display = originalDisplay ?? "";
    btn.removeAttribute("aria-hidden");
  }

  // ---------- User / role detection ----------
  function getUser() {
    // Firebase namespaced
    try { if (window.firebase?.auth?.().currentUser) return window.firebase.auth().currentUser; } catch (_) {}
    // Firebase v9 modular (exported globals)
    try { if (window.auth && typeof window.auth.currentUser !== "undefined") return window.auth.currentUser; } catch (_) {}
    // App globals
    if (window.currentUser && (window.currentUser.uid || window.currentUser.id)) return window.currentUser;
    if (window.APP_USER && (window.APP_USER.uid || window.APP_USER.id)) return window.APP_USER;
    if (window.state?.user) return window.state.user;
    // LocalStorage hint
    try {
      const lsUser = JSON.parse(localStorage.getItem("user") || "null");
      if (lsUser && (lsUser.uid || lsUser.id)) return lsUser;
    } catch (_) {}
    return null;
  }

  function normalizeRole(val) {
    if (!val) return "";
    if (Array.isArray(val)) {
      const first = val.map(x => String(x || "").toLowerCase()).find(Boolean);
      return first || "";
    }
    return String(val).toLowerCase();
  }

  function getRole() {
    // Prefer explicit data attributes if present
    const roleDataEl = q("[data-user-role], [data-role], [data-role-current]");
    const roleData = roleDataEl?.dataset?.userRole || roleDataEl?.dataset?.role || roleDataEl?.dataset?.roleCurrent;
    if (roleData) return normalizeRole(roleData);

    // Meta tag
    const metaRole = q('meta[name="user-role"]')?.getAttribute("content");
    if (metaRole) return normalizeRole(metaRole);

    // Visible role chip/text
    const roleTextEl = q(".user-role, #userRole, [data-label='role']");
    if (roleTextEl?.textContent) return normalizeRole(roleTextEl.textContent.trim());

    // App globals
    if (window.currentUser?.role) return normalizeRole(window.currentUser.role);
    if (window.APP_ROLE) return normalizeRole(window.APP_ROLE);
    if (window.state?.role) return normalizeRole(window.state.role);

    // LocalStorage fallback (if you stash it there)
    try {
      const lsRole = localStorage.getItem("role") || localStorage.getItem("userRole");
      if (lsRole) return normalizeRole(lsRole);
    } catch (_) {}

    return "";
  }

  // ---------- Sign-in screen heuristic ----------
  function isSignInScreen() {
    // Obvious sign-in DOM hints
    const hints = [
      "#signin", "#login", ".sign-in", ".login-card", ".auth-card",
      'form[action*="signin"]', 'form[action*="login"]',
      "#googleSignIn", "[data-action='sign-in']", "[data-test='sign-in']",
      "#microsoftSignIn", "[data-action='microsoft-sign-in']",
    ];
    if (hints.some(sel => q(sel))) return true;

    // If we know user is absent, treat as sign-in
    if (!getUser()) return true;

    return false;
  }

  // ---------- Main guard ----------
  function applyGuard() {
    const btn = findCreateBtn();
    if (!btn) return;

    // Default: hidden until proven otherwise
    hideBtn(btn);

    // On the sign-in screen: keep hidden
    if (isSignInScreen()) return;

    // Must have a signed-in user
    const user = getUser();
    if (!user) return;

    // Need a known role
    const role = getRole(); // e.g., "nurse" or "doctor"
    if (!role) return;

    // Hide for doctors only; show for everyone else (nurse, admin, etc.)
    if (role === "doctor") hideBtn(btn);
    else showBtn(btn);
  }

  // ---------- Wire it up ----------
  function init() {
    applyGuard();

    // Retry briefly to catch late user/role injection
    let tries = 0;
    const maxTries = 20;            // ~4s total at 200ms
    const iv = setInterval(() => {
      applyGuard();
      if (++tries >= maxTries) clearInterval(iv);
    }, 200);

    // Observe DOM changes (SPA nav, injecting buttons, role badges, etc.)
    const mo = new MutationObserver(() => applyGuard());
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Listen for likely app events; fire one from your bootstrap after you resolve role if you can.
    ["authChanged", "userChanged", "roleChanged", "appReady"].forEach(ev =>
      document.addEventListener(ev, applyGuard)
    );

    // If Firebase is present, react to auth changes
    try { window.firebase?.auth?.().onAuthStateChanged?.(() => applyGuard()); } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
