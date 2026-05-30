import { useState, useEffect } from 'react'

const phoneValid = v => !v || /^\+[\d\s\-]+$/.test(v.trim())

export default function ProfileTab({ apiFetch }) {
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch('/api/me')
      .then(r => r.json())
      .then(data => {
        setDisplayName(data.display_name ?? '')
        setPhone(data.phone ?? '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handlePhoneChange = val => {
    setPhone(val)
    setSuccess(false)
    setPhoneError(val && !phoneValid(val)
      ? 'Must start with + and contain only digits, spaces, or dashes.'
      : null)
  }

  const save = async () => {
    setSaving(true); setError(null); setSuccess(false)
    try {
      const res = await apiFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ display_name: displayName, phone: phone || null }),
      })
      if (!res.ok) throw new Error('Failed to save profile')
      setSuccess(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="status-msg">Loading…</div>

  return (
    <div className="score-form">
      <div className="form-field">
        <label>Display Name</label>
        <input
          type="text"
          className="gate-input"
          style={{ textAlign: 'left' }}
          placeholder="Your display name"
          value={displayName}
          onChange={e => { setDisplayName(e.target.value); setSuccess(false) }}
          onKeyDown={e => e.key === 'Enter' && save()}
        />
      </div>

      <div className="form-field">
        <label>Phone Number</label>
        <input
          type="tel"
          className="gate-input"
          style={{ textAlign: 'left' }}
          placeholder="+54 9 11 2345 6789"
          value={phone}
          onChange={e => handlePhoneChange(e.target.value)}
        />
        {phoneError
          ? <div className="profile-field-error">{phoneError}</div>
          : <div className="profile-field-hint">
              Include your country code (e.g. +54 for Argentina). Used for match notifications — coming soon.
            </div>
        }
      </div>

      {error && <div className="error">{error}</div>}
      {success && (
        <div className="success-msg">
          Profile saved! <button onClick={() => setSuccess(false)}>×</button>
        </div>
      )}
      <button className="generate-btn" onClick={save} disabled={saving}>
        {saving
          ? <span className="loading-text"><span className="spinner" />Saving…</span>
          : 'Save Profile'}
      </button>
    </div>
  )
}
