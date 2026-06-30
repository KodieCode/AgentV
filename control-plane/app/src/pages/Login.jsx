import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const APP_NAME = import.meta.env.VITE_APP_NAME || 'Control Plane';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch {
      setErr('Invalid username or password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form onSubmit={submit} className="login-card">
        <h1 className="login-brand">
          <span className="logo-dot" />
          <span>{APP_NAME}</span>
        </h1>
        {err && <div className="error-banner">{err}</div>}
        <label className="field">
          <div className="field-label">Username</div>
          <input
            type="text"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <div className="field-label">Password</div>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
