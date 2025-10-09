// /js/pdf-splitter.js
// Split large PDFs client-side into <= maxBytes parts by flattening each page to JPEG,
// then repacking into jsPDF documents. Also includes an image compressor helper.
//
// Public API:
//   - splitIfNeeded(file, { maxBytes=4.5*1024*1024, dpi=120, quality=0.72 })
//       -> { isSplit, mode, blobs, pageCounts, totalBytes, parts }
//   - splitPdf(file, { maxBytes, dpi, quality }) -> same as above
//   - compressImageToMaxBytes(file, { maxBytes, maxWidth }) -> Blob
//
// Notes:
// - Uses the same pdf.js CDN as /js/tagging.js to keep versions aligned.
// - Loads jsPDF UMD on demand (no bundler required).
// - Keeps aspect ratio faithful by sizing each jsPDF page to the rendered page’s point size.
// - If a single page exceeds maxBytes, we progressively lower JPEG quality and (if needed) DPI.

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120";
const JSPDF_UMD = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensurePdfJs() {
  if (globalThis.pdfjsLib) {
    if (!globalThis.pdfjsLib.GlobalWorkerOptions?.workerSrc) {
      globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
    }
    return globalThis.pdfjsLib;
  }
  await loadScript(`${PDFJS_CDN}/pdf.min.js`);
  const lib = globalThis.pdfjsLib;
  if (!lib) throw new Error("Failed to load pdf.js");
  lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
  return lib;
}

async function ensureJsPDF() {
  if (globalThis.jspdf?.jsPDF) return globalThis.jspdf.jsPDF;
  await loadScript(JSPDF_UMD);
  if (!globalThis.jspdf?.jsPDF) throw new Error("Failed to load jsPDF");
  return globalThis.jspdf.jsPDF;
}

/** px → pt at a given render DPI */
function pxToPt(px, dpi) {
  return (px * 72) / dpi;
}

/** Render a single PDF page to a canvas at the target DPI. */
async function renderPageToCanvas(pdfPage, dpi) {
  const scale = dpi / 72; // pdf.js viewport scale is relative to 72 DPI
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: false });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, widthPx: canvas.width, heightPx: canvas.height };
}

/** Add an image to jsPDF page sized to exactly match the canvas page. */
function addCanvasAsPage(doc, canvas, dpi) {
  const wPt = pxToPt(canvas.width, dpi);
  const hPt = pxToPt(canvas.height, dpi);
  const orientation = wPt > hPt ? "landscape" : "portrait";

  if (doc.getNumberOfPages() === 0) {
    // First page = create doc at this size
    doc.addPage([wPt, hPt], orientation);
    doc.deletePage(1); // jsPDF starts with an implicit page; delete then add again below
  } else {
    doc.addPage([wPt, hPt], orientation);
  }

  // Recreate page (jsPDF requires an existing page context)
  const pageCount = doc.getNumberOfPages();
  doc.setPage(pageCount);
  // Use JPEG for good size/quality balance; image data provided by caller
}

/** Build a fresh jsPDF instance (pt units) */
function newDoc() {
  const jsPDFCtor = globalThis.jspdf.jsPDF;
  return new jsPDFCtor({ unit: "pt" });
}

/**
 * Try to add a page (from canvas) to the current doc with the given quality/dpi.
 * If the doc becomes larger than maxBytes, optionally delete the last page and return false.
 */
async function tryAddPageAndCheckSize({ doc, canvas, dpi, jpegQuality, maxBytes }) {
  const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
  const wPt = pxToPt(canvas.width, dpi);
  const hPt = pxToPt(canvas.height, dpi);
  const orientation = wPt > hPt ? "landscape" : "portrait";

  if (doc.getNumberOfPages() === 0) {
    doc.addPage([wPt, hPt], orientation);
  } else {
    doc.addPage([wPt, hPt], orientation);
  }
  const pageNo = doc.getNumberOfPages();
  doc.setPage(pageNo);
  doc.addImage(dataUrl, "JPEG", 0, 0, wPt, hPt);

  const blob = await doc.output("blob");
  const ok = blob.size <= maxBytes;
  if (!ok) {
    // Remove last page so caller can finalize prev part or start new doc
    doc.deletePage(pageNo);
  }
  return { ok, blobMaybe: ok ? blob : null };
}

/**
 * Handle the "single-page already exceeds maxBytes" case:
 * Decrease quality, then DPI progressively until it fits or we hit hard floors.
 */
async function fitSinglePage({ maxBytes, dpiStart, qStart, docFactory, canvas }) {
  let dpi = dpiStart;
  let q = qStart;

  // Hard floors to keep legibility
  const DPI_FLOOR = 80;
  const Q_FLOOR = 0.4;

  while (dpi >= DPI_FLOOR) {
    // create fresh doc for each attempt
    const doc = docFactory();
    const attempt = await tryAddPageAndCheckSize({ doc, canvas, dpi, jpegQuality: q, maxBytes });
    if (attempt.ok) {
      const blob = await doc.output("blob");
      return { ok: true, blob, dpi, quality: q, pageCount: 1 };
    }
    // Lower quality first down to floor, then reduce DPI by 15% and reset quality
    if (q > Q_FLOOR) {
      q = Math.max(Q_FLOOR, Math.round((q - 0.1) * 100) / 100);
    } else {
      dpi = Math.floor(dpi * 0.85);
      q = 0.6; // reset to a reasonable quality when DPI drops
    }
  }
  return { ok: false, error: "Page cannot be compressed under maxBytes while remaining legible." };
}

/**
 * Split a PDF into parts <= maxBytes.
 * Returns blobs[], pageCounts[] (per part), totalBytes, parts, isSplit, mode.
 */
export async function splitPdf(file, { maxBytes = 4.5 * 1024 * 1024, dpi = 120, quality = 0.72 } = {}) {
  if (!file || file.type !== "application/pdf") {
    throw new Error("splitPdf requires a PDF File.");
  }

  const pdfjsLib = await ensurePdfJs();
  const jsPDFCtor = await ensureJsPDF(); // ensures globalThis.jspdf.jsPDF is present; we'll use newDoc()

  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;

  const blobs = [];
  const pageCounts = [];
  let currentDoc = newDoc();
  let pagesInCurrentDoc = 0;
  let totalBytes = 0;

  // We collect canvases page-by-page to avoid holding many in memory
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    let { canvas } = await renderPageToCanvas(page, dpi);

    // Try to add this page with current settings
    let added = false;
    {
      const { ok } = await tryAddPageAndCheckSize({
        doc: currentDoc,
        canvas,
        dpi,
        jpegQuality: quality,
        maxBytes
      });

      if (ok) {
        pagesInCurrentDoc += 1;
        added = true;
      }
    }

    // If not added because it overflowed:
    if (!added) {
      if (pagesInCurrentDoc === 0) {
        // First (and only) page in a new part is already too big → try to fit by lowering q/DPI
        const fitted = await fitSinglePage({
          maxBytes,
          dpiStart: dpi,
          qStart: quality,
          docFactory: newDoc,
          canvas
        });
        if (!fitted.ok) {
          throw new Error(fitted.error || "Unable to compress page under size limit.");
        }
        blobs.push(fitted.blob);
        pageCounts.push(1);
        totalBytes += fitted.blob.size;

        // Start a fresh doc for next pages
        currentDoc = newDoc();
        pagesInCurrentDoc = 0;
      } else {
        // Finalize current part (without this page)
        const partBlob = await currentDoc.output("blob");
        blobs.push(partBlob);
        pageCounts.push(pagesInCurrentDoc);
        totalBytes += partBlob.size;

        // Start a new part and add this page into it
        currentDoc = newDoc();
        pagesInCurrentDoc = 0;

        // Re-add the page to fresh doc (should fit, otherwise handled like above)
        // Try default quality/DPI first
        const retryAdd = await tryAddPageAndCheckSize({
          doc: currentDoc,
          canvas,
          dpi,
          jpegQuality: quality,
          maxBytes
        });
        if (retryAdd.ok) {
          pagesInCurrentDoc += 1;
        } else {
          // Single page still too large → run fitter
          const fitted = await fitSinglePage({
            maxBytes,
            dpiStart: dpi,
            qStart: quality,
            docFactory: newDoc,
            canvas
          });
          if (!fitted.ok) {
            throw new Error(fitted.error || "Unable to compress page under size limit.");
          }
          blobs.push(fitted.blob);
          pageCounts.push(1);
          totalBytes += fitted.blob.size;

          // Start a new empty doc for subsequent pages
          currentDoc = newDoc();
          pagesInCurrentDoc = 0;
        }
      }
    }

    // Release canvas memory ASAP
    canvas.width = 1;
    canvas.height = 1;
    canvas = null;
  }

  // Finalize the last part if it has pages
  if (pagesInCurrentDoc > 0) {
    const partBlob = await currentDoc.output("blob");
    blobs.push(partBlob);
    pageCounts.push(pagesInCurrentDoc);
    totalBytes += partBlob.size;
  }

  return {
    isSplit: blobs.length > 1,
    mode: blobs.length > 1 ? "split" : "single",
    blobs,
    pageCounts,
    totalBytes,
    parts: blobs.length,
  };
}

/** If file is PDF and > maxBytes → split; if image and > maxBytes → compress. */
export async function splitIfNeeded(file, { maxBytes = 4.5 * 1024 * 1024, dpi = 120, quality = 0.72, imageMaxWidth = 2600 } = {}) {
  if (!file) throw new Error("No file provided.");

  if (file.type === "application/pdf") {
    if (file.size <= maxBytes) {
      return {
        isSplit: false,
        mode: "single",
        blobs: [file],
        pageCounts: [],
        totalBytes: file.size,
        parts: 1,
      };
    }
    return await splitPdf(file, { maxBytes, dpi, quality });
  }

  if (/^image\//i.test(file.type)) {
    if (file.size <= maxBytes) {
      return {
        isSplit: false,
        mode: "single-image",
        blobs: [file],
        pageCounts: [],
        totalBytes: file.size,
        parts: 1,
      };
    }
    const blob = await compressImageToMaxBytes(file, { maxBytes, maxWidth: imageMaxWidth });
    return {
      isSplit: false,
      mode: "compressed-image",
      blobs: [blob],
      pageCounts: [],
      totalBytes: blob.size,
      parts: 1,
    };
  }

  throw new Error("Only PDF and image types are supported.");
}

/** Compress a bitmap image to <= maxBytes by scaling and lowering JPEG quality if needed. */
export async function compressImageToMaxBytes(file, { maxBytes = 4.5 * 1024 * 1024, maxWidth = 2600, minQuality = 0.5 } = {}) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Failed to load image for compression"));
    i.src = URL.createObjectURL(file);
  });

  // Scale down if wider than maxWidth
  const ratio = img.width > maxWidth ? maxWidth / img.width : 1;
  const targetW = Math.max(1, Math.round(img.width * ratio));
  const targetH = Math.max(1, Math.round(img.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, targetW, targetH);

  let q = 0.85;
  while (q >= minQuality) {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", q));
    if (blob && blob.size <= maxBytes) {
      return blob;
    }
    q = Math.round((q - 0.05) * 100) / 100;
  }

  // If still too big, final attempt with aggressive shrink
  const fallbackW = Math.round(targetW * 0.85);
  const fallbackH = Math.round(targetH * 0.85);
  canvas.width = fallbackW;
  canvas.height = fallbackH;
  ctx.drawImage(img, 0, 0, fallbackW, fallbackH);
  const finalBlob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", minQuality));
  if (!finalBlob) throw new Error("Compression failed.");
  return finalBlob;
}
