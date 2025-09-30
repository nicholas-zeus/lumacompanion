// /js/pdf-export.js
import { toDate } from "/js/utils.js";

/* Load jsPDF (UMD) without bare imports */
async function loadJsPDF() {
  // If already loaded, reuse
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;

  // Load UMD build (no @babel/runtime)
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load jsPDF"));
    document.head.appendChild(s);
  });

  if (!window.jspdf?.jsPDF) throw new Error("jsPDF not available after load");
  return window.jspdf.jsPDF;
}

/**
 * Build a transcript PDF (Details + Comments with MQ expanded).
 * Returns a Blob.
 */
export async function buildTranscriptPDF({ caseDoc, comments, mqMap }) {
  const jsPDFCtor = await loadJsPDF();
  const doc = new jsPDFCtor({ unit: "pt", format: "a4" });

  // helpers
  const addHRule = (x1, y1, x2) => doc.line(x1, y1, x2, y1);
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 56;
  const contentW = pageW - margin * 2;

  let y = margin;

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Clinical Review Transcript", margin, y);
  y += 8; addHRule(margin, y, margin + contentW); y += 18;

  // Case meta
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const id = caseDoc?.id || "—";
  const status = (caseDoc?.status || "—").toUpperCase();
  const created = caseDoc?.createdAt ? toDate(caseDoc.createdAt)?.toLocaleString() : "—";
  const finished = caseDoc?.finishedAt ? toDate(caseDoc.finishedAt)?.toLocaleString() : "—";

  const metaLines = [
    `Case ID: ${id}`,
    `Status: ${status}`,
    `Created: ${created}`,
    ...(caseDoc?.finishedAt ? [`Finished: ${finished}`] : []),
  ];
  metaLines.forEach(line => { doc.text(line, margin, y); y += 16; });
  y += 8;

  // Details
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Details", margin, y); y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const details = caseDoc?.details || {};
  const detailLines = Object.entries(details)
    .filter(([_, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `• ${k}: ${String(v).trim()}`);

  for (const line of detailLines) {
    y = writeMultiline(doc, line, margin, y, contentW);
    y += 6;
    y = pageBreakIfNeeded(doc, y, margin);
  }

  y += 6;
  doc.setLineWidth(0.5);
  addHRule(margin, y, margin + contentW); y += 20;

  // Comments + MQ
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Comments (with Medical Questionnaire)", margin, y); y += 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  if (!comments || !comments.length) {
    doc.text("No comments.", margin, y); y += 16;
  } else {
    for (const c of comments) {
      const who = c?.author?.displayName || c?.author?.email || "Unknown";
      const when = c?.createdAt || c?.updatedAt;
      const whenStr = when ? toDate(when)?.toLocaleString() : "—";

      // Header
      doc.setFont("helvetica", "bold");
      y = writeMultiline(doc, `${who} — ${whenStr}`, margin, y, contentW);
      doc.setFont("helvetica", "normal");
      y += 6;

      // Body
      if (c?.body) {
        y = writeMultiline(doc, String(c.body).trim(), margin, y, contentW);
        y += 8;
      }

      // MQ
      const mq = mqMap?.[c.id] || {};
      const keys = Object.keys(mq).filter(k => mq[k] != null && String(mq[k]).trim() !== "");
      if (keys.length) {
        doc.setFont("helvetica", "bold");
        y = writeMultiline(doc, "Medical Questionnaire:", margin + 8, y, contentW - 8);
        doc.setFont("helvetica", "normal");
        y += 6;
        for (const k of keys) {
          const line = `- ${k}: ${String(mq[k]).trim()}`;
          y = writeMultiline(doc, line, margin + 12, y, contentW - 12);
          y += 4;
          y = pageBreakIfNeeded(doc, y, margin);
        }
      }

      y += 10;
      y = pageBreakIfNeeded(doc, y, margin);
    }
  }

  return doc.output("blob");
}

/* Write wrapped text within a given width, return new y */
function writeMultiline(doc, text, x, y, maxWidth) {
  const lines = doc.splitTextToSize(text, maxWidth);
  for (const ln of lines) {
    doc.text(ln, x, y);
    y += 14;
  }
  return y;
}

/* Add a new page if close to bottom */
function pageBreakIfNeeded(doc, y, margin) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y > pageH - margin - 40) {
    doc.addPage();
    return margin;
  }
  return y;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "transcript.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}
