/** Convert Firestore Timestamp | {seconds,nanoseconds} | Date | string → Date */
export function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  // Firestore Timestamp object from SDK has toDate()
  if (typeof val.toDate === "function") return val.toDate();
  // Plain object from some serializers
  if (typeof val.seconds === "number") return new Date(val.seconds * 1000);
  // ISO string
  return new Date(val);
}

function pad2(n){ return String(n).padStart(2, "0"); }

/** e.g., "23 Sep 2025, 14:30" (uses browser TZ as requested) */
export function formatDeadline(ts) {
  const d = toDate(ts);
  if (!d || Number.isNaN(d.getTime())) return "—";
  const day = pad2(d.getDate());
  const mon = d.toLocaleString(undefined, { month: "short" });
  const year = d.getFullYear();
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  return `${day} ${mon} ${year}, ${hh}:${mm}`;
}

/** "Updated 2h ago" / "Updated just now" */
export function formatUpdatedAt(ts) {
  const d = toDate(ts);
  if (!d || Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "Updated just now";
  if (min < 60) return `Updated ${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Updated ${h}h ago`;
  const days = Math.floor(h / 24);
  return `Updated ${days}d ago`;
}

/** Case-insensitive contains */
export function contains(hay, needle) {
  if (!hay || !needle) return true;
  return String(hay).toLowerCase().includes(String(needle).toLowerCase());
}

/** Stable sort: urgent first, then by (deadline asc if urgent) else updatedAt desc */
export function sortCasesForDashboard(cases) {
  return [...cases].sort((a, b) => {
    // Urgent pin
    if (!!b.urgent - !!a.urgent !== 0) return (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0);
    if (a.urgent && b.urgent) {
      const ad = toDate(a.deadlineAt)?.getTime() || Infinity;
      const bd = toDate(b.deadlineAt)?.getTime() || Infinity;
      return ad - bd; // earlier deadline first
    }
    const au = toDate(a.updatedAt)?.getTime() || 0;
    const bu = toDate(b.updatedAt)?.getTime() || 0;
    return bu - au; // newer first
  });
}
