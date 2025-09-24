// /js/pdf-export.js
import { toDate } from "/js/utils.js";

/**
 * Build a simple transcript PDF (client-side) using jsPDF loaded on demand.
 * Includes MQ as requested.
 *
 * Usage:
 *   const blob = await buildTranscriptPDF({ caseDoc, comments, mqMap });
 *   downloadBlob(blob, `Case-${caseDoc.id}.pdf`);
 */
export async function buildTranscriptPDF({ caseDoc, comments, mqMap }) {
  // Load jsPDF from CDN on demand
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.es.min.js");

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const line = (x1, y1, x2, y2) => doc.line(x1, y1, x2, y2);

  let y = 56;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Escalation — Clinical Review Transcript", 56, y);
  y += 8;
  line(56, y, 539, y); y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  // Header table
  const H = caseDoc.details || {};
  const rows = [
    ["Case ID", caseDoc.id || ""],
    ["Name", H.Name || ""],
    ["MemberID", H.MemberID || ""],
    ["Hospital", H.Hospital || ""],
    ["Diagnosis", H.Diagnosis || ""],
    ["Status", caseDoc.status || ""],
    ["Urgent", caseDoc.urgent ? "Yes" : "No"],
    ["Deadline", H.deadlineAt ? toDate(caseDoc.deadlineAt).toLocaleString() : ""],
    ["Assigned Nurse", caseDoc.assignedNurse?.displayName || caseDoc.assignedNurse?.email || ""],
    ["Assigned Doctor", caseDoc.assignedDoctor?.displayName || caseDoc.assignedDoctor?.email || ""],
  ];
  rows.forEach(([k, v]) => {
    y += 16;
    doc.setFont("helvetica", "bold"); doc.text(`${k}:`, 56, y);
    doc.setFont("helvetica", "normal"); doc.text(String(v || ""), 160, y, { maxWidth: 360 });
  });
  y += 16; line(56, y, 539, y); y += 24;

  // Comments + MQ
  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("Comments", 56, y); y += 18;
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);

  const pageBreakIfNeeded = (increment) => {
    if (y + increment > 770) { doc.addPage(); y = 56; }
  };

  for (const c of comments) {
    const who = c.author?.displayName || c.author?.email || "Unknown";
    const when = c.createdAt ? toDate(c.createdAt).toLocaleString() : "";
    const header = `${who} — ${when}`;
    pageBreakIfNeeded(32);
    doc.setFont("helvetica", "bold"); doc.text(header, 56, y); y += 16;
    doc.setFont("helvetica", "normal");
    const bodyLines = doc.splitTextToSize(c.body || "", 460);
    bodyLines.forEach(lineText => {
      pageBreakIfNeeded(16);
      doc.text(lineText, 56, y); y += 16;
    });

    // MQ (always included per your spec)
    const mq = mqMap.get(c.id)?.text || "";
    if (mq) {
      pageBreakIfNeeded(22);
      doc.setFont("helvetica", "bold"); doc.text("Medical Questionnaire:", 56, y); y += 16;
      doc.setFont("helvetica", "normal");
      const mqLines = doc.splitTextToSize(mq, 460);
      mqLines.forEach(t => { pageBreakIfNeeded(16); doc.text(t, 56, y); y += 16; });
    }

    y += 8;
  }

  return doc.output("blob");
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename || "transcript.pdf";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
