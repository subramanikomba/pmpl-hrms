import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Views a generated PDF inside the application.
 *
 * Mobile browsers (notably Chrome on Android) refuse to render a PDF inside
 * an <iframe> from a blob: URL — they substitute a download placeholder
 * showing the blob's internal id, which is what users saw as a black box with
 * a UUID. So the PDF is rasterised to <canvas> with pdf.js instead, which
 * every browser can paint. The blob is still produced and is still what the
 * Download action saves, so the document shown is the real salary slip.
 */
export function PdfViewerModal(
  { title, build, onClose, onDownload }: {
    title: string;
    /** Produces a blob URL for the document to display. */
    build: () => Promise<string>;
    onClose: () => void;
    onDownload?: () => void;
  },
) {
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [ready, setReady] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const url = await build();
        if (cancelled) { URL.revokeObjectURL(url); return; }
        urlRef.current = url;

        const pdfjs = await import('pdfjs-dist');
        // The worker ships with the package; Vite fingerprints it via ?url.
        const workerUrl = (await import(
          'pdfjs-dist/build/pdf.worker.min.mjs?url'
        )).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) return;
        setPageCount(doc.numPages);

        const host = holder.current;
        if (!host) return;
        host.replaceChildren();

        // Render at the container's own width so the slip is legible on a
        // phone without pinch-zooming, capped so desktop stays crisp.
        const cssWidth = Math.min(host.clientWidth || 720, 900);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const scale = cssWidth / base.width;
          const viewport = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement('canvas');
          canvas.className = 'doc-page';
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Could not prepare the document canvas');

          host.appendChild(canvas);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
        }
        setReady(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not open the document');
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal open size="lg" title={title} onClose={onClose}>
      {error ? (
        <p className="error-text">{error}</p>
      ) : (
        <>
          {!ready && <Spinner label="Preparing the document…" />}
          <div
            className="doc-viewer"
            style={ready ? undefined : { display: 'none' }}
          >
            <div className="doc-pages" ref={holder} />
          </div>
          {ready && pageCount > 1 && (
            <p className="muted small">{pageCount} pages</p>
          )}
        </>
      )}
      <div className="row-end gap">
        {onDownload && (
          <Button variant="secondary" onClick={onDownload}>Download PDF</Button>
        )}
        <Button variant="primary" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
