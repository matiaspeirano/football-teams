import { useState, useEffect, useCallback } from 'react'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const formatScheduledAt = iso => {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm}`
}

function MatchCard({ match, myRole, userId, rsvping, onRsvp, onUpdateStatus, onDelete, onGenerateTeams }) {
  const myRsvp = match.rsvps.find(r => r.user_id === userId)
  const inPlayers = match.rsvps.filter(r => r.status === 'in')
  const isOpen = match.status === 'open' || match.status === 'confirmed'

  const statusColor = {
    open: 'var(--text-dim)',
    confirmed: 'var(--green)',
    cancelled: 'var(--red)',
    played: '#60a5fa',
  }[match.status] ?? 'var(--text-dim)'

  return (
    <div className="match-card">
      <div className="match-card-header">
        <div>
          <div className="match-datetime">{formatScheduledAt(match.scheduled_at)}</div>
          <div className="match-location">{match.location}</div>
        </div>
        <span className="match-status-badge" style={{ color: statusColor }}>
          {match.status.charAt(0).toUpperCase() + match.status.slice(1)}
        </span>
      </div>

      <div className="match-rsvp-count">
        {match.rsvp_count} / {match.players_needed} confirmed
      </div>

      {inPlayers.length > 0 && (
        <div className="match-in-players">
          {inPlayers.map(r => (
            <span key={r.user_id} className="match-player-chip">
              {r.display_name ?? r.user_id}
            </span>
          ))}
        </div>
      )}

      <div className="match-actions">
        {isOpen && (
          <div className="match-rsvp-row">
            <button
              className={`rsvp-btn${myRsvp?.status === 'in' ? ' rsvp-in-active' : ''}`}
              onClick={() => onRsvp(match.id, 'in')}
              disabled={rsvping}
            >
              I'm In
            </button>
            <button
              className={`rsvp-btn${myRsvp?.status === 'out' ? ' rsvp-out-active' : ''}`}
              onClick={() => onRsvp(match.id, 'out')}
              disabled={rsvping}
            >
              I'm Out
            </button>
          </div>
        )}

        {myRole === 'admin' && (
          <div className="match-admin-row">
            {match.status === 'confirmed' && (
              <button
                className="add-btn"
                onClick={() => onGenerateTeams(inPlayers.map(r => r.user_id))}
                style={{ flex: 1 }}
              >
                Generate Teams
              </button>
            )}
            {isOpen && (
              <button
                className="cancel-match-btn"
                onClick={() => onUpdateStatus(match.id, 'cancelled')}
              >
                Cancel
              </button>
            )}
            <button
              className="delete-match-btn"
              onClick={() => onDelete(match.id)}
              aria-label="Delete match"
            >
              🗑
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MatchesTab({ tournamentId, apiFetch, myRole, userId, onGenerateTeams }) {
  const [matches, setMatches] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rsvpingId, setRsvpingId] = useState(null)
  const [scheduledAt, setScheduledAt] = useState('')
  const [location, setLocation] = useState('')
  const [playersNeeded, setPlayersNeeded] = useState(12)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/scheduled-matches`)
      if (res.ok) setMatches(await res.json())
      else setError('Failed to load matches')
    } catch {
      setError('Failed to load matches')
    } finally {
      setLoading(false)
    }
  }, [tournamentId, apiFetch])

  useEffect(() => { load() }, [load])

  const createMatch = async () => {
    if (!scheduledAt || !location) return
    setCreating(true); setCreateError(null)
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/scheduled-matches`, {
        method: 'POST',
        body: JSON.stringify({ scheduled_at: scheduledAt, location, players_needed: playersNeeded }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed') }
      setScheduledAt(''); setLocation(''); setPlayersNeeded(12)
      load()
    } catch (e) {
      setCreateError(e.message)
    } finally {
      setCreating(false)
    }
  }

  const rsvp = async (matchId, status) => {
    setRsvpingId(matchId)
    try {
      const res = await apiFetch(`/api/scheduled-matches/${matchId}/rsvp`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      })
      if (res.ok) await load()
    } finally {
      setRsvpingId(null)
    }
  }

  const updateStatus = async (matchId, status) => {
    await apiFetch(`/api/scheduled-matches/${matchId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    })
    load()
  }

  const deleteMatch = async matchId => {
    if (!window.confirm('Delete this match?')) return
    await apiFetch(`/api/scheduled-matches/${matchId}`, { method: 'DELETE' })
    load()
  }

  return (
    <div>
      {myRole === 'admin' && (
        <div className="constraint-section" style={{ marginBottom: 20 }}>
          <h3>Schedule a Match</h3>
          <div className="form-field">
            <label>Date &amp; Time</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>Location</label>
            <input
              type="text"
              className="gate-input"
              style={{ textAlign: 'left' }}
              placeholder="e.g. Parque Central, Cancha 3"
              value={location}
              onChange={e => setLocation(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>Players Needed</label>
            <input
              type="number"
              min={2}
              max={30}
              value={playersNeeded}
              onChange={e => setPlayersNeeded(Math.max(2, Number(e.target.value)))}
            />
          </div>
          {createError && <div className="error">{createError}</div>}
          <button
            className="add-btn"
            onClick={createMatch}
            disabled={creating || !scheduledAt || !location}
            style={{ width: '100%', padding: 10, marginTop: 4 }}
          >
            {creating ? 'Creating…' : 'Create Match'}
          </button>
        </div>
      )}

      {loading && <div className="status-msg">Loading matches…</div>}
      {error && <div className="error">{error}</div>}
      {matches && matches.length === 0 && !loading && (
        <div className="status-msg">No matches scheduled yet.</div>
      )}
      {matches && matches.map(match => (
        <MatchCard
          key={match.id}
          match={match}
          myRole={myRole}
          userId={userId}
          rsvping={rsvpingId === match.id}
          onRsvp={rsvp}
          onUpdateStatus={updateStatus}
          onDelete={deleteMatch}
          onGenerateTeams={onGenerateTeams}
        />
      ))}
    </div>
  )
}
