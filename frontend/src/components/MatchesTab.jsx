import { useState, useEffect, useCallback } from 'react'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00')

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const formatScheduledAt = iso => {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm}`
}

// ─── Edit Teams Panel ──────────────────────────────────────────────────────────

function EditTeamsPanel({ match, tournamentId, apiFetch, onSaved, onCancel }) {
  const [team1, setTeam1] = useState(() => (match.team1 ?? []).map(p => ({ ...p })))
  const [team2, setTeam2] = useState(() => (match.team2 ?? []).map(p => ({ ...p })))
  const [allPlayers, setAllPlayers] = useState([])
  const [playersLoading, setPlayersLoading] = useState(true)
  const [addPlayerId, setAddPlayerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch(`/api/tournaments/${tournamentId}/players`)
      .then(r => r.json())
      .then(data => { setAllPlayers(data); setPlayersLoading(false) })
      .catch(() => setPlayersLoading(false))
  }, [])

  const inTeams = new Set([...team1.map(p => p.user_id), ...team2.map(p => p.user_id)])
  const available = allPlayers.filter(p => !inTeams.has(p.user_id))
  const unequal = team1.length !== team2.length

  const move1to2 = uid => {
    const p = team1.find(x => x.user_id === uid)
    setTeam1(t => t.filter(x => x.user_id !== uid))
    setTeam2(t => [...t, p])
  }
  const move2to1 = uid => {
    const p = team2.find(x => x.user_id === uid)
    setTeam2(t => t.filter(x => x.user_id !== uid))
    setTeam1(t => [...t, p])
  }
  const remove1 = uid => setTeam1(t => t.filter(x => x.user_id !== uid))
  const remove2 = uid => setTeam2(t => t.filter(x => x.user_id !== uid))

  const addToTeam = teamNum => {
    if (!addPlayerId) return
    const p = allPlayers.find(x => x.user_id === addPlayerId)
    if (!p) return
    const entry = { user_id: p.user_id, display_name: p.display_name }
    if (teamNum === 1) setTeam1(t => [...t, entry])
    else setTeam2(t => [...t, entry])
    setAddPlayerId('')
  }

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const res = await apiFetch(`/api/scheduled-matches/${match.id}/teams`, {
        method: 'PUT',
        body: JSON.stringify({
          team1_players: team1.map(p => p.user_id),
          team2_players: team2.map(p => p.user_id),
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed to save') }
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ borderTop: '1px solid var(--border-mid)', margin: '12px 0' }} />

      {/* Two-column editor */}
      <div className="edit-teams-cols">
        <div>
          <div className="edit-team-col-label">Team 1 ({team1.length})</div>
          {team1.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem', padding: '4px 0' }}>Empty</div>
          )}
          {team1.map(p => (
            <div key={p.user_id} className="edit-player-row">
              <span className="edit-player-name">{p.display_name ?? p.user_id}</span>
              <button className="edit-icon-btn" onClick={() => move1to2(p.user_id)} title="Move to Team 2">→</button>
              <button className="edit-icon-btn edit-remove" onClick={() => remove1(p.user_id)} title="Remove">×</button>
            </div>
          ))}
        </div>
        <div>
          <div className="edit-team-col-label">Team 2 ({team2.length})</div>
          {team2.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem', padding: '4px 0' }}>Empty</div>
          )}
          {team2.map(p => (
            <div key={p.user_id} className="edit-player-row">
              <span className="edit-player-name">{p.display_name ?? p.user_id}</span>
              <button className="edit-icon-btn" onClick={() => move2to1(p.user_id)} title="Move to Team 1">←</button>
              <button className="edit-icon-btn edit-remove" onClick={() => remove2(p.user_id)} title="Remove">×</button>
            </div>
          ))}
        </div>
      </div>

      {/* Unequal warning */}
      {unequal && (
        <div className="edit-warning">
          ⚠ Unequal sizes: {team1.length} vs {team2.length}
        </div>
      )}

      {/* Add substitute */}
      <div style={{ marginBottom: 14 }}>
        <div className="edit-team-col-label" style={{ marginBottom: 8 }}>Add Substitute</div>
        {playersLoading ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>Loading…</div>
        ) : available.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>All tournament players are assigned.</div>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={addPlayerId}
              onChange={e => setAddPlayerId(e.target.value)}
              style={{
                flex: 1, minWidth: 0, background: 'var(--surface3)', border: '1px solid var(--border-mid)',
                color: 'var(--text)', padding: '6px 8px', borderRadius: 'var(--radius-sm)',
                fontSize: '0.83rem', outline: 'none', WebkitAppearance: 'none', appearance: 'none',
              }}
            >
              <option value="">Player…</option>
              {available.map(p => (
                <option key={p.user_id} value={p.user_id}>{p.display_name ?? p.user_id}</option>
              ))}
            </select>
            <button className="add-btn" onClick={() => addToTeam(1)} disabled={!addPlayerId}
              style={{ flexShrink: 0, padding: '6px 10px', fontSize: '0.8rem' }}>
              → T1
            </button>
            <button className="add-btn" onClick={() => addToTeam(2)} disabled={!addPlayerId}
              style={{ flexShrink: 0, padding: '6px 10px', fontSize: '0.8rem' }}>
              → T2
            </button>
          </div>
        )}
      </div>

      {error && <div className="error" style={{ marginBottom: 10 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="manage-back-btn" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
        <button className="add-btn" onClick={save} disabled={saving}
          style={{ flex: 2, padding: 10 }}>
          {saving ? 'Saving…' : 'Save Teams'}
        </button>
      </div>
    </div>
  )
}

// ─── Match Card ────────────────────────────────────────────────────────────────

function MatchCard({ match, myRole, userId, rsvping, onRsvp, onUpdateStatus, onDelete, onGenerateTeams, tournamentId, apiFetch, onTeamsSaved }) {
  const [editingTeams, setEditingTeams] = useState(false)

  const myRsvp = match.rsvps.find(r => r.user_id === userId)
  const inPlayers = match.rsvps.filter(r => r.status === 'in')
  const isOpen = match.status === 'open' || match.status === 'confirmed'
  const hasTeams = match.team1?.length > 0 || match.team2?.length > 0

  const statusColor = {
    open: 'var(--text-dim)',
    confirmed: 'var(--green)',
    cancelled: 'var(--red)',
    played: '#60a5fa',
  }[match.status] ?? 'var(--text-dim)'

  return (
    <div className="match-card">
      {/* Header always visible */}
      <div className="match-card-header">
        <div>
          <div className="match-datetime">{formatScheduledAt(match.scheduled_at)}</div>
          {match.location && <div className="match-location">{match.location}</div>}
        </div>
        <span className="match-status-badge" style={{ color: statusColor }}>
          {match.status.charAt(0).toUpperCase() + match.status.slice(1)}
        </span>
      </div>

      {/* Edit mode */}
      {editingTeams ? (
        <EditTeamsPanel
          match={match}
          tournamentId={tournamentId}
          apiFetch={apiFetch}
          onSaved={() => { setEditingTeams(false); onTeamsSaved() }}
          onCancel={() => setEditingTeams(false)}
        />
      ) : (
        <>
          <div className="match-rsvp-count">
            {match.rsvp_count} / {match.players_needed} confirmed
          </div>

          {inPlayers.length > 0 && !hasTeams && (
            <div className="match-in-players">
              {inPlayers.map(r => (
                <span key={r.user_id} className="match-player-chip">
                  {r.display_name ?? r.user_id}
                </span>
              ))}
            </div>
          )}

          {hasTeams && (
            <div className="match-teams">
              <div className="match-team-side">
                <div className="match-team-label">Team 1</div>
                {(match.team1 ?? []).map(p => (
                  <div key={p.user_id} className="match-team-player">{p.display_name ?? p.user_id}</div>
                ))}
              </div>
              <div className="match-team-divider" />
              <div className="match-team-side">
                <div className="match-team-label">Team 2</div>
                {(match.team2 ?? []).map(p => (
                  <div key={p.user_id} className="match-team-player">{p.display_name ?? p.user_id}</div>
                ))}
              </div>
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
                    onClick={() => onGenerateTeams(inPlayers.map(r => r.user_id), match)}
                    style={{ flex: 1 }}
                  >
                    {hasTeams ? 'Regenerate Teams' : 'Generate Teams'}
                  </button>
                )}
                {hasTeams && (
                  <button
                    className="add-btn"
                    onClick={() => setEditingTeams(true)}
                    style={{ flex: 1 }}
                  >
                    Edit Teams
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
        </>
      )}
    </div>
  )
}

// ─── MatchesTab ────────────────────────────────────────────────────────────────

export default function MatchesTab({ tournamentId, apiFetch, myRole, userId, onGenerateTeams }) {
  const [matches, setMatches] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rsvpingId, setRsvpingId] = useState(null)

  // Scheduling form state
  const [showForm, setShowForm] = useState(false)
  const [matchDate, setMatchDate] = useState(todayStr)
  const [matchHour, setMatchHour] = useState('20:00')
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

  const resetForm = () => {
    setMatchDate(todayStr()); setMatchHour('20:00'); setLocation(''); setPlayersNeeded(12); setCreateError(null)
  }

  const closeForm = () => { setShowForm(false); resetForm() }

  const createMatch = async () => {
    if (!matchDate) return
    const scheduledAt = `${matchDate}T${matchHour}`
    if (new Date(scheduledAt) <= new Date()) {
      setCreateError('Cannot schedule a match in the past.')
      return
    }
    setCreating(true); setCreateError(null)
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/scheduled-matches`, {
        method: 'POST',
        body: JSON.stringify({ scheduled_at: scheduledAt, location: location.trim(), players_needed: playersNeeded }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed') }
      closeForm()
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
      {/* ── Schedule button + collapsible form ── */}
      {myRole === 'admin' && (
        <div style={{ marginBottom: 16 }}>
          {!showForm ? (
            <button
              className="add-btn"
              onClick={() => setShowForm(true)}
              style={{ width: '100%', padding: 11, fontSize: '0.9rem' }}
            >
              + Schedule Match
            </button>
          ) : (
            <div className="constraint-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h3 style={{ margin: 0 }}>Schedule a Match</h3>
                <button
                  onClick={closeForm}
                  style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, padding: 0 }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className="form-field">
                  <label>Date</label>
                  <input
                    type="date"
                    value={matchDate}
                    min={todayStr()}
                    onChange={e => setMatchDate(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label>Time</label>
                  <select value={matchHour} onChange={e => setMatchHour(e.target.value)}>
                    {HOURS.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-field">
                <label>Location <span className="optional">(optional)</span></label>
                <input
                  type="text"
                  className="gate-input"
                  style={{ textAlign: 'left' }}
                  placeholder="e.g. Lo de siempre (optional)"
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
                disabled={creating || !matchDate}
                style={{ width: '100%', padding: 10 }}
              >
                {creating ? 'Creating…' : 'Create Match'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Match list ── */}
      {loading && <div className="status-msg">Loading matches…</div>}
      {error && <div className="error">{error}</div>}
      {matches && matches.length === 0 && !loading && (
        <div className="status-msg">
          No matches scheduled yet.
          {myRole === 'admin' && <span style={{ display: 'block', marginTop: 6, fontSize: '0.82rem' }}>Use + Schedule Match above to create one.</span>}
        </div>
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
          tournamentId={tournamentId}
          apiFetch={apiFetch}
          onTeamsSaved={load}
        />
      ))}
    </div>
  )
}
