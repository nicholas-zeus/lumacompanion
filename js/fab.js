// /js/fab.js

// ---- element factory ----
function mk(id, text, title) {
  let b = document.getElementById(id);
  if (!b) {
    b = document.createElement("button");
    b.id = id;
    b.className = "fab";
    b.type = "button";
    b.style.display = "none";
    document.body.appendChild(b);
  }
  b.textContent = text || "";
  b.title = title || text || "";
  b.setAttribute("aria-label", title || text || "");
  return b;
}

// ---- layout helpers ----
function isMobile(){ return window.matchMedia("(max-width: 860px)").matches; }

function setPos(el, slot) {
  if (!el) return;
  const primary   = { right: "16px", bottom: "88px" };
  const secondary = { right: "16px", bottom: "16px" };
  Object.assign(el.style, slot === "secondary" ? secondary : primary);
}

// ---- singleton refs ----
const els = {};
function ensure() {
  // create (or get) all FABs once
  els.details = mk("fab-details",       "💾", "Save");
  els.docTop  = mk("fab-docview-top",   "↑",  "Go to top");
  els.mToggle = mk("fab-manage-toggle", "≡",  "Open drawer");
  els.mSave   = mk("fab-manage-save",   "💾", "Save changes");

  // normalize base style (size, positioning layer)
  [els.details, els.docTop, els.mToggle, els.mSave].forEach(el => {
    Object.assign(el.style, {
      position: "fixed",
      zIndex: 1001,
      width: "56px",
      height: "56px",
      display: "none",   // visibility controlled by apply()
      displayMode: "grid",
      // ensure content centers even if a site-wide CSS resets button layout
      display: "grid",
      placeItems: "center",
      border: "0",
      borderRadius: "18px",
      cursor: "pointer",
      userSelect: "none",
      WebkitTapHighlightColor: "transparent",
    });
  });

  // set default slots now; apply() will re-assert each time
  setPos(els.details, "primary");
  setPos(els.docTop,  "primary");
  setPos(els.mToggle, "secondary");
  setPos(els.mSave,   "primary");
}

// ---- state ----
let activeTab = "details"; // "details" | "docview" | "documents"
let manageDirty = false;

// ---- API ----
export const fab = {
  init() { ensure(); this.apply(); },

  setTab(name){
    activeTab = String(name || "").toLowerCase();
    this.apply();
  },

  // ----- Details tab -----
  setDetails(mode, handler){
    ensure();
    const map = {
      create: { icon:"💾", label:"Create" },
      save:   { icon:"💾", label:"Save"   },
      edit:   { icon:"✏️", label:"Edit"   },
    };
    const key = String(mode || "").toLowerCase();
    const cfg = map[key] || map.save;

    els.details.textContent = cfg.icon;
    els.details.title = cfg.label;
    els.details.setAttribute("aria-label", cfg.label);
    els.details.onclick = (e)=>{ e.preventDefault(); handler?.(); };

    this.apply();
  },

  // ----- DocView tab -----
  useDocTop(handler){
    ensure();
    els.docTop.onclick = (e)=>{
      e.preventDefault();
      if (handler) handler();
      else window.scrollTo({ top: 0, behavior: "smooth" });
    };
    this.apply();
  },

  // ----- Manage tab (mobile-only) -----
  setManageToggle(handler){
    ensure();
    els.mToggle.onclick = (e)=>{ e.preventDefault(); handler?.(); };
    this.apply();
  },

  setManageSave(handler){
    ensure();
    els.mSave.onclick = (e)=>{ e.preventDefault(); handler?.(); };
    this.apply();
  },

  setManageDirty(flag){
    manageDirty = !!flag;
    this.apply();
  },

  // ----- visibility + consistent positions -----
  apply(){
    ensure();
    const mobile = isMobile();
    const tab = String(activeTab || "").toLowerCase();

    // hide all by default
    els.details.style.display = "none";
    els.docTop.style.display  = "none";
    els.mToggle.style.display = "none";
    els.mSave.style.display   = "none";

    // re-assert slot positions for consistency across tabs
    setPos(els.details, "primary");   // main action slot
    setPos(els.docTop,  "primary");   // main action slot
    setPos(els.mToggle, "secondary"); // burger always secondary
    setPos(els.mSave,   "primary");   // save always primary

    if (tab === "details") {
      // Single main FAB at PRIMARY slot
      els.details.style.display = "grid";
    } else if (tab === "docview") {
      // Go-to-top at PRIMARY slot
      els.docTop.style.display = "grid";
    } else if (tab === "documents") {
      // Manage tab — FABs only on mobile
      if (mobile) {
        els.mToggle.style.display = "grid";               // burger always visible
        if (manageDirty) els.mSave.style.display = "grid"; // save only when dirty
      }
    }
  }
};

// keep layout correct on viewport changes
window.addEventListener("resize", () => fab.apply());
