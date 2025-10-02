// /js/index-role-guards.js
// Show "Create" for everyone EXCEPT doctors.
// Works with your index.html which uses #newCaseBtn and #rolePill.

(function () {
  const q  = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

  let createBtn, originalDisplay = "";

  function findCreateBtn() {
    if (createBtn && document.body.contains(createBtn)) return createBtn;

    // Your index.html uses #newCaseBtn
    const candidates = [
      "#newCaseBtn",
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

    // Fallback by text (your button is "＋", so this likely won’t hit)
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
    btn.hidden = true;                   // <-- important
    btn.setAttribute("aria-hidden", "true");
    btn.style.display = "none";
  }

  function showBtn(btn) {
    if (!btn) return;
    btn.hidden = false;                  // <-- important
    btn.removeAttribute("aria-hidden");
    // Let CSS decide (your .fab uses inline-grid); fall back to previous
    btn.style.display = originalDisplay ?? "";
  }

  function getUser() {
    try { if (window.firebase?.auth?.().currentUser) return window.firebase.auth().currentUser; } catch {}
    try { if (window.auth && typeof window.auth.currentUser !== "undefined") return window.auth.currentUser; } catch {}
    if (window.currentUser && (window.currentUser.uid || window.currentUser.id)) return window.currentUser;
    if (window.APP_USER && (window.APP_USER.uid || window.APP_USER.id)) return window.APP_USER;
    if (window.state?.user) return window.state.user;
    try {
      const lsUser = JSON.parse(localStorage.getItem("user") || "null");
      if (lsUser && (lsUser.uid || lsUser.id)) return lsUser;
    } catch {}
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
    // 1) Role pill your page shows in the gear drawer
    const pill = q("#rolePill");
    if (pill && pill.textContent) return normalizeRole(pill.textContent.trim());

    // 2) Data attributes / meta (future-proof)
    const roleDataEl = q("[data-user-role], [data-role], [data-role-current]");
    const roleData = roleDataEl?.dataset?.userRole || roleDataEl?.dataset?.role || roleDataEl?.dataset?.roleCurrent;
    if (roleData) return normalizeRole(roleData);

    const metaRole = q('meta[name="user-role"]')?.getAttribute("content");
    if (metaRole) return normalizeRole(metaRole);

    // 3) App globals (if you ever hoist state)
    if (window.currentUser?.role) return normalizeRole(window.currentUser.role);
    if (window.APP_ROLE) return normalizeRole(window.APP_ROLE);
    if (window.state?.role) return normalizeRole(window.state.role);

    // 4) localStorage fallback
    try {
      const lsRole = localStorage.getItem("role") || localStorage.getItem("userRole");
      if (lsRole) return normalizeRole(lsRole);
    } catch {}

    return "";
  }

  function isSignInScreen() {
    // Your index has #signinBox which gets .hidden removed when signed out
    const box = q("#signinBox");
    if (box && !box.classList.contains("hidden")) return true;

    // Fallbacks (other pages)
    const hints = [
      "#signin", ".sign-in", ".login-card", ".auth-card",
      'form[action*="signin"]', 'form[action*="login"]',
      "#googleSignIn", "#microsoftSignIn",
      "[data-action='sign-in']", "[data-action='microsoft-sign-in']",
    ];
    if (hints.some(sel => q(sel))) return true;

    if (!getUser()) return true;
    return false;
  }

  function applyGuard() {
    const btn = findCreateBtn();
    if (!btn) return;

    // Hidden by default
    hideBtn(btn);

    if (isSignInScreen()) return;

    const user = getUser();
    if (!user) return;

    const role = getRole(); // "nurse" or "doctor"
    if (!role) return;

    // Only doctors are blocked
    if (role === "doctor") hideBtn(btn);
    else showBtn(btn);
  }

  function init() {
    applyGuard();

    // Retry briefly for late-initialized role/user
    let tries = 0;
    const maxTries = 20;
    const iv = setInterval(() => {
      applyGuard();
      if (++tries >= maxTries) clearInterval(iv);
    }, 200);

    const mo = new MutationObserver(() => applyGuard());
    mo.observe(document.documentElement, { childList: true, subtree: true });

    ["authChanged", "userChanged", "roleChanged", "appReady"].forEach(ev =>
      document.addEventListener(ev, applyGuard)
    );

    try { window.firebase?.auth?.().onAuthStateChanged?.(() => applyGuard()); } catch {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
