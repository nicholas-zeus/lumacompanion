// /js/index-role-guards.js
// Hide the "Create" button on index.html for:
// - everyone on the sign-in screen (no user)
// - doctors even when signed in
// Show it only when signed in AND role !== 'doctor'

import { state } from "/js/case-shared.js";

const q = (s, r = document) => r.querySelector(s);
const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

let cachedBtn;
let originalDisplay;

function findCreateBtn() {
    if (cachedBtn && document.body.contains(cachedBtn)) return cachedBtn;

    // Try common ids/classes/attributes used in this project
    const candidates = [
        "#createBtn",
        "#newCaseBtn",
        "[data-action='create-case']",
        ".btn-create",
        "button#create",
        "a#create",
    ];

    for (const sel of candidates) {
        const el = q(sel);
        if (el) {
            cachedBtn = el;
            // store initial display so we can restore it later
            if (!originalDisplay) {
                const cs = getComputedStyle(el);
                originalDisplay = el.style.display || (cs && cs.display !== "none" ? "" : "");
            }
            return cachedBtn;
        }
    }

    // Fallback: any button that visibly says "Create" / "New Case"
    const guess = qa("button, a").find(el => {
        const t = (el.textContent || "").trim().toLowerCase();
        return t === "create" || t.includes("new case") || t.includes("create case");
    });
    if (guess) {
        cachedBtn = guess;
        const cs = getComputedStyle(guess);
        originalDisplay = guess.style.display || (cs && cs.display !== "none" ? "" : "");
    }
    return cachedBtn;
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

function onAuthOrRoleChange() {
    const btn = findCreateBtn();
    if (!btn) return;

    // Hide by default
    hideBtn(btn);

    // Not signed in → keep hidden (sign-in screen)
    const user = state?.user || null;
    if (!user) return;

    // If role is known and is 'doctor' → hide
    const role = (state?.role || "").toLowerCase();
    if (role === "doctor") return;

    // If role is known and not doctor → show
    if (role && role !== "doctor") {
        showBtn(btn);
        return;
    }

    // If role not yet loaded but user exists, keep hidden until role arrives
}

function wireGuards() {
    onAuthOrRoleChange();

    // Retry a few times (role/user may load after DOM)
    let tries = 0;
    const maxTries = 10;
    const iv = setInterval(() => {
        onAuthOrRoleChange();
        if (++tries >= maxTries) clearInterval(iv);
    }, 200);

    // Observe DOM changes (in case button is injected later)
    const mo = new MutationObserver(() => onAuthOrRoleChange());
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Listen to likely custom events your app may dispatch
    document.addEventListener("authChanged", onAuthOrRoleChange);
    document.addEventListener("roleChanged", onAuthOrRoleChange);
    document.addEventListener("caseLoaded", onAuthOrRoleChange);
}

document.addEventListener("DOMContentLoaded", wireGuards);
