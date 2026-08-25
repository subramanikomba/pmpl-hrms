import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="empty-state">
      <h2>Page not found</h2>
      <p className="muted">That screen doesn’t exist.</p>
      <Link className="btn btn-primary btn-md" to="/">Go to start</Link>
    </div>
  );
}
