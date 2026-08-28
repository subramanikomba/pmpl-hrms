import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Views a generated PDF inside the application rather than in a new browser
 * tab. The blob URL is revoked when the viewer closes so nothing leaks.
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
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let created: string | null = null;
    build().then(
      (u) => {
        if (revoked) { URL.revokeObjectURL(u); return; }
        created = u;
        setUrl(u);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'Could not open the document'),
    );
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal open size="lg" title={title} onClose={onClose}>
      {error ? (
        <p className="error-text">{error}</p>
      ) : !url ? (
        <Spinner label="Preparing the document…" />
      ) : (
        <div className="doc-viewer">
          <iframe src={url} title={title} className="doc-frame" />
        </div>
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
