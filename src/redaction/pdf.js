// PDF handling via MuPDF WASM (design §7).
// CRITICAL: true redaction removes text from the content stream via redaction
// annotations + applyRedactions — never a cosmetic overlay box. An overlay
// leaves the text extractable by copy-paste or pdftotext; that failure mode
// has leaked real "redacted" documents repeatedly.
//
// This module is a factory over an injected mupdf module handle so the exact
// same code runs in the browser (WASM from vendor/ or CDN) and in Node tests.

// Match Local Redact's document-level check. Blank or image-only pages do not
// prevent review of the readable pages; they remain visible in the page preview.
export function loadPdfForReview(engine, bytes) {
  const session = engine.load(bytes);
  if (!engine.hasTextLayer(session)) {
    engine.close(session);
    throw new Error('This PDF has no readable text layer. Scanned or image-only PDFs require OCR, which is not supported yet.');
  }
  return session;
}

export function createPdfEngine(mupdf) {
  function extractPageChars(page) {
    const st = page.toStructuredText('preserve-whitespace');
    const chars = [];
    let line = 0;
    st.walk({
      onChar(c, _origin, _font, _size, quad) {
        chars.push({ c, quad, line });
      },
      endLine() {
        chars.push({ c: '\n', quad: null, line });
        line++;
      }
    });
    st.destroy?.();
    return chars;
  }

  return {
    // Parse a PDF into per-page text + per-char quads.
    // Keeps the original bytes so redaction always starts from a pristine copy.
    load(bytes) {
      const originalBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const doc = mupdf.Document.openDocument(originalBytes.slice(), 'application/pdf');
      const pageCount = doc.countPages();
      const pages = [];
      for (let i = 0; i < pageCount; i++) {
        const page = doc.loadPage(i);
        const bounds = page.getBounds();
        const chars = extractPageChars(page);
        pages.push({
          index: i,
          bounds,
          width: bounds[2] - bounds[0],
          height: bounds[3] - bounds[1],
          chars,
          text: chars.map((ch) => ch.c).join('')
        });
        page.destroy?.();
      }
      return { doc, originalBytes, pages };
    },

    // Scanned PDFs have no text layer (design §8.4): detect and refuse rather
    // than silently returning an unredacted file.
    hasTextLayer(session) {
      let visible = 0;
      for (const p of session.pages) {
        for (const ch of p.chars) {
          if (ch.quad && ch.c.trim()) visible++;
          if (visible >= 16) return true;
        }
      }
      return visible > 0;
    },

    // Render a page to PNG bytes for the visual preview.
    renderPagePng(session, pageIndex, scale = 1.5) {
      const page = session.doc.loadPage(pageIndex);
      const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
      const png = pix.asPNG();
      pix.destroy?.();
      page.destroy?.();
      return png;
    },

    // Line-grouped rectangles covering chars [from, to) of a page.
    // Rects are shrunk inward by a small epsilon so shared glyph edges don't
    // pull neighbouring characters into the redaction.
    rectsForRange(session, pageIndex, from, to, epsilon = 0.2) {
      const chars = session.pages[pageIndex].chars;
      const byLine = new Map();
      for (let i = from; i < to && i < chars.length; i++) {
        const ch = chars[i];
        if (!ch || !ch.quad) continue;
        const q = ch.quad;
        const x0 = Math.min(q[0], q[2], q[4], q[6]);
        const x1 = Math.max(q[0], q[2], q[4], q[6]);
        const y0 = Math.min(q[1], q[3], q[5], q[7]);
        const y1 = Math.max(q[1], q[3], q[5], q[7]);
        const r = byLine.get(ch.line);
        if (!r) byLine.set(ch.line, { x0, y0, x1, y1 });
        else {
          r.x0 = Math.min(r.x0, x0);
          r.y0 = Math.min(r.y0, y0);
          r.x1 = Math.max(r.x1, x1);
          r.y1 = Math.max(r.y1, y1);
        }
      }
      return [...byLine.values()].map((r) => {
        const useEps = r.x1 - r.x0 > 2 * epsilon && r.y1 - r.y0 > 2 * epsilon;
        return useEps
          ? [r.x0 + epsilon, r.y0 + epsilon, r.x1 - epsilon, r.y1 - epsilon]
          : [r.x0, r.y0, r.x1, r.y1];
      });
    },

    // Apply true redactions and return the redacted file bytes.
    // pageOps: [{ pageIndex, boxes: [{ rect: [x0,y0,x1,y1], token }] }]
    // Opens a FRESH document from the original bytes so the preview session
    // is never mutated. Optionally draws the consistent token over each box
    // (white on black) and bakes it into real page content.
    redactToBytes(session, pageOps, { drawTokens = true } = {}) {
      const doc = mupdf.Document.openDocument(session.originalBytes.slice(), 'application/pdf');
      for (const op of pageOps) {
        if (!op.boxes.length) continue;
        const page = doc.loadPage(op.pageIndex);
        for (const b of op.boxes) {
          const annot = page.createAnnotation('Redact');
          annot.setRect(b.rect);
        }
        page.applyRedactions(true, mupdf.PDFPage.REDACT_IMAGE_PIXELS);
        page.destroy?.();
      }
      if (drawTokens) {
        try {
          let any = false;
          for (const op of pageOps) {
            const withTokens = op.boxes.filter((b) => b.token);
            if (!withTokens.length) continue;
            const page = doc.loadPage(op.pageIndex);
            for (const b of withTokens) {
              const [x0, y0, x1, y1] = b.rect;
              const h = y1 - y0;
              const fontSize = Math.max(4, Math.min(9, h * 0.55));
              const annot = page.createAnnotation('FreeText');
              annot.setRect([x0, y0, x1, y1]);
              annot.setContents(b.token);
              annot.setDefaultAppearance('Helv', fontSize, [1, 1, 1]);
              try { annot.setBorderWidth(0); } catch { /* cosmetic */ }
              annot.update();
              any = true;
            }
            page.update?.();
            page.destroy?.();
          }
          if (any) doc.bake(true, false);
        } catch {
          // Token overlay is best-effort; the black-box redaction above is
          // already complete and safe without it.
        }
      }
      const buf = doc.saveToBuffer('garbage,compress');
      const out = buf.asUint8Array().slice();
      buf.destroy?.();
      doc.destroy?.();
      return out;
    },

    close(session) {
      session.doc?.destroy?.();
    }
  };
}
