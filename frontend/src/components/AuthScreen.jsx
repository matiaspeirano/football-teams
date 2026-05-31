import { useState } from 'react'
import { supabase } from '../supabase'

export default function AuthScreen({ inviteToken }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  const submit = async () => {
    setLoading(true); setError(null); setMessage(null)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMessage('Check your email to confirm your account.')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const signInWithGoogle = async () => {
    setOauthLoading(true); setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    })
    if (error) { setError(error.message); setOauthLoading(false) }
    // on success the browser redirects — no need to reset loading
  }

  return (
    <div className="app">
      <h1>⚽ Fútbol Tournament</h1>
      {inviteToken && (
        <div className="info-msg" style={{ marginBottom: 16 }}>
          You've been invited! Log in or sign up to join.
        </div>
      )}
      <div className="password-gate">
        <div className="gate-card">
          <div className="gate-icon">{mode === 'login' ? '🔑' : '✨'}</div>
          <h2>{mode === 'login' ? 'Sign In' : 'Create Account'}</h2>

          {/* Google OAuth */}
          <button
            onClick={signInWithGoogle}
            disabled={oauthLoading}
            style={{
              width: '100%', padding: '10px 16px', marginBottom: 4,
              background: '#fff', color: '#3c4043',
              border: '1px solid #dadce0', borderRadius: 'var(--radius-sm)',
              fontSize: '0.95rem', fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}
          >
            {oauthLoading ? 'Redirecting…' : (
              <>
                <svg width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  <path fill="none" d="M0 0h48v48H0z"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>

          {/* Divider */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            margin: '12px 0', color: 'var(--text-dim)', fontSize: '0.8rem',
          }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            or
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          {/* Email / password */}
          <input
            type="email" className="gate-input" placeholder="Email"
            value={email} autoFocus
            onChange={e => { setEmail(e.target.value); setError(null) }}
          />
          <input
            type="password" className="gate-input" placeholder="Password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(null) }}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
          {error && <div className="error">{error}</div>}
          {message && <div className="info-msg">{message}</div>}
          <button
            className="generate-btn" style={{ marginBottom: 0 }}
            onClick={submit} disabled={loading}
          >
            {loading
              ? <span className="loading-text"><span className="spinner" />{mode === 'login' ? 'Signing in…' : 'Creating account…'}</span>
              : mode === 'login' ? 'Sign In' : 'Sign Up'}
          </button>
          <button className="link-btn" onClick={() => {
            setMode(m => m === 'login' ? 'signup' : 'login')
            setError(null); setMessage(null)
          }}>
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
