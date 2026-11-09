import { useState } from "react";
import { Check, LockKeyhole, Utensils } from "lucide-react";

export default function AuthScreen({ auth, authApi }) {
  const [mode, setMode] = useState("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);

    try {
      if (mode === "sign-up") {
        await authApi.createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await authApi.signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (authError) {
      const errors = {
        "auth/email-already-in-use": "An account with this email already exists. Sign in instead.",
        "auth/invalid-credential": "Email or password is incorrect.",
        "auth/invalid-email": "Enter a valid email address.",
        "auth/operation-not-allowed": "Email/password sign-in is not enabled in Firebase yet.",
        "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
        "auth/weak-password": "Choose a password with at least 6 characters.",
        "auth/network-request-failed": "Could not connect. Check your internet connection and try again."
      };
      setError(errors[authError.code] || "Could not authenticate. Check your Firebase setup and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setError("");
    setMessage("");
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    setBusy(true);
    try {
      await authApi.sendPasswordResetEmail(auth, email.trim());
      setMessage("If an account exists for that email, a password reset link has been sent.");
    } catch (authError) {
      setError(authError.code === "auth/invalid-email" ? "Enter a valid email address." : "Could not send the reset email. Check your Firebase setup and try again.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-card">
      <div className="auth-brand"><div className="auth-brand-mark"><Utensils size={21}/></div><div><b>messmate</b><small>MESS MANAGEMENT</small></div></div>
      <div className="auth-heading"><div className="auth-lock"><LockKeyhole size={19}/></div><h1>{mode === "sign-up" ? "Create your account" : "Sign in to MessMate"}</h1><p>Your bills and menu sync securely across your devices.</p></div>
      <form onSubmit={submit}>
        <label className="field-label">EMAIL ADDRESS<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com"/></label>
        <label className="field-label">PASSWORD<input type="password" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} minLength="6" required value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 6 characters"/></label>
        {error && <p className="auth-message error" role="alert">{error}</p>}
        {message && <p className="auth-message success" role="status"><Check size={15}/>{message}</p>}
        <button className="primary-btn auth-submit" disabled={busy}>{busy ? "Please wait..." : mode === "sign-up" ? "Create account" : "Sign in"}</button>
      </form>
      {mode === "sign-in" && <button className="auth-text-button" disabled={busy} onClick={resetPassword}>Forgot password?</button>}
      <div className="auth-switch">{mode === "sign-up" ? "Already have an account?" : "New to MessMate?"}<button disabled={busy} onClick={() => { setMode(mode === "sign-up" ? "sign-in" : "sign-up"); setError(""); setMessage(""); }}>{mode === "sign-up" ? "Sign in" : "Create account"}</button></div>
      <p className="auth-private-note">Your account's records are private to you. Sign in with the same account on each device to sync.</p>
    </section>
  </main>;
}
