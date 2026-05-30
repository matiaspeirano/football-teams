import { useState } from 'react'
import { supabase } from '../supabase'

export default function AuthScreen({ inviteToken }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
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
