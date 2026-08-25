import { useAuth } from '@/auth/useAuth';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function InactivityDialog() {
  const { inactivityWarning, msUntilLogout, dismissInactivityWarning, signOut } = useAuth();

  return (
    <Modal
      open={inactivityWarning}
      title="Session about to expire"
      size="sm"
      onClose={dismissInactivityWarning}
    >
      <p className="muted">
        You have been inactive for a while. For security you will be signed out
        automatically in <strong className="countdown">{mmss(msUntilLogout)}</strong>.
      </p>
      <div className="row-end gap">
        <Button variant="ghost" onClick={() => void signOut()}>Sign out now</Button>
        <Button variant="primary" onClick={dismissInactivityWarning}>Stay signed in</Button>
      </div>
    </Modal>
  );
}
