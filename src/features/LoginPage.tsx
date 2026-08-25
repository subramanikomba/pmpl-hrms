import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import logo from '@/assets/logo.jpg';

export function LoginPage() {
  const { employee, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner label="Loading…" />;
  // Already signed in — never show the login form behind the app.
  if (employee) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await signIn(email.trim(), password);
    if (err) {
      // Avoid confirming whether an address exists.
      setError(
        err.toLowerCase().includes('invalid')
          ? 'Incorrect email or password.'
          : err,
      );
      setBusy(false);
    }
    // On success the auth state change drives the redirect.
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={(e) => void onSubmit(e)}>
        <img src={logo} alt="" className="login-logo" />
        <p className="login-company">Polyfill Microns Pvt. Ltd.</p>
        <h1 className="login-title">HRMS</h1>
        <p className="login-sub">Employee Management &amp; Payroll · sign in to continue</p>

        <div className="field">
          <label className="field-label" htmlFor="login-email">Email address</label>
          <input
            id="login-email"
            className="input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="login-password">Password</label>
          <input
            id="login-password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error && <p className="login-error" role="alert">{error}</p>}

        <Button type="submit" variant="primary" size="md" disabled={busy} className="full">
          {busy ? 'Signing in…' : 'Sign In'}
        </Button>

        <p className="login-foot">Polyfill Microns Pvt. Ltd. — Internal System</p>
      </form>
    </div>
  );
}
