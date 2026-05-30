import { useState, useEffect } from 'react'

function suggestTournament() {
  const now = new Date()
  const year = now.getFullYear()
  const season = now.getMonth() + 1 >= 7 ? 'Apertura' : 'Clausura'
  return { name: `${season} ${year}`, year, season }
}

export function CreateTournamentForm({ apiFetch, onCreated }) {
  const sug = suggestTournament()
  const [name, setName] = useState(sug.name)
  const [year, setYear] = useState(String(sug.year))
  const [season, setSeason] = useState(sug.season)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const create = async () => {
    if (!name.trim()) return
    setLoading(true); setError(null)
    try {
      const res = await apiFetch('/api/tournaments', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), year: Number(year), season }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed to create') }
      onCreated(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="form-field">
        <label>Name</label>
        <input type="text" className="gate-input" style={{ textAlign: 'left' }}
          placeholder="Tournament name" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div className="form-field">
          <label>Year</label>
          <input type="number" className="gate-input" style={{ textAlign: 'left' }}
            value={year} onChange={e => setYear(e.target.value)} />
        </div>
        <div className="form-field">
          <label>Season</label>
          <select value={season} onChange={e => setSeason(e.target.value)}>
            <option value="Apertura">Apertura</option>
            <option value="Clausura">Clausura</option>
          </select>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <button className="add-btn" onClick={create} disabled={loading}
        style={{ width: '100%', padding: 10 }}>
        {loading ? 'Creating…' : 'Create Tournament'}
      </button>
    </div>
  )
}

// ─── Sub-view header ──────────────────────────────────────────────────────────

function SubHeader({ title, onBack }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
      <button className="manage-back-btn" onClick={onBack}>← Back</button>
      <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text)' }}>{title}</span>
    </div>
  )
}

// ─── ManageTab ────────────────────────────────────────────────────────────────

export default function ManageTab({
  tournamentId, apiFetch, players, userId,
  tournament, onTournamentUpdated, onPlayersChanged,
}) {
  const [view, setView] = useState('menu')

  const ownerPlayer = players.find(p => p.is_owner)
  const isOwner = ownerPlayer?.user_id === userId

  // ── Edit Tournament state ────────────────────────────────────────────────
  const [editName, setEditName] = useState(tournament?.name ?? '')
  const [editYear, setEditYear] = useState(String(tournament?.year ?? ''))
  const [editSeason, setEditSeason] = useState(tournament?.season ?? 'Apertura')
  const [editSaving, setEditSaving] = useState(false)
  const [editSuccess, setEditSuccess] = useState(false)
  const [editError, setEditError] = useState(null)

  useEffect(() => {
    setEditName(tournament?.name ?? '')
    setEditYear(String(tournament?.year ?? ''))
    setEditSeason(tournament?.season ?? 'Apertura')
    setEditSuccess(false)
    setEditError(null)
  }, [tournament?.id])

  const saveTournament = async () => {
    setEditSaving(true); setEditError(null); setEditSuccess(false)
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editName.trim(), year: Number(editYear), season: editSeason }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed to save') }
      onTournamentUpdated?.(await res.json())
      setEditSuccess(true)
    } catch (e) {
      setEditError(e.message)
    } finally {
      setEditSaving(false)
    }
  }

  // ── Invite state ────────────────────────────────────────────────────────
  const [inviteRole, setInviteRole] = useState('player')
  const [inviteLink, setInviteLink] = useState(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState(null)
  const [copied, setCopied] = useState(false)

  const [pendingInvites, setPendingInvites] = useState([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingError, setPendingError] = useState(null)
  const [copiedToken, setCopiedToken] = useState(null)

  const loadPendingInvites = () => {
    setPendingLoading(true)
    apiFetch(`/api/tournaments/${tournamentId}/invites`)
      .then(r => r.json())
      .then(setPendingInvites)
      .catch(() => setPendingError('Failed to load invites'))
      .finally(() => setPendingLoading(false))
  }

  useEffect(() => {
    if (view === 'invites') loadPendingInvites()
  }, [view, tournamentId])

  const generateInvite = async () => {
    setInviteLoading(true); setInviteError(null); setInviteLink(null); setCopied(false)
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/invite`, {
        method: 'POST',
        body: JSON.stringify({ role: inviteRole }),
      })
      if (!res.ok) throw new Error('Failed to generate invite link')
      const data = await res.json()
      setInviteLink(window.location.origin + data.invite_url)
      loadPendingInvites()
    } catch (e) {
      setInviteError(e.message)
    } finally {
      setInviteLoading(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  const copyInviteUrl = (token) => {
    const url = `${window.location.origin}/invite/${token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(token); setTimeout(() => setCopiedToken(null), 2000)
    })
  }

  const formatExpiry = (iso) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  // ── Player management state ─────────────────────────────────────────────
  const [playerSearch, setPlayerSearch] = useState('')
  const [roleChanging, setRoleChanging] = useState({})
  const [removing, setRemoving] = useState({})
  const [playerError, setPlayerError] = useState(null)

  const changeRole = async (playerId, newRole) => {
    setRoleChanging(prev => ({ ...prev, [playerId]: true }))
    setPlayerError(null)
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/players/${playerId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed to update role') }
      onPlayersChanged?.()
    } catch (e) {
      setPlayerError(e.message)
    } finally {
      setRoleChanging(prev => ({ ...prev, [playerId]: false }))
    }
  }

  const removePlayer = async (playerId) => {
    setRemoving(prev => ({ ...prev, [playerId]: true }))
    setPlayerError(null)
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/players/${playerId}`, {
        method: 'DELETE',
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed to remove player') }
      onPlayersChanged?.()
    } catch (e) {
      setPlayerError(e.message)
    } finally {
      setRemoving(prev => ({ ...prev, [playerId]: false }))
    }
  }

  // ── Menu ─────────────────────────────────────────────────────────────────
  if (view === 'menu') {
    return (
      <div className="manage-menu">
        <button className="manage-menu-card" onClick={() => setView('edit')}>
          <div>
            <div className="manage-menu-card-title">Edit Tournament</div>
            <div className="manage-menu-card-sub">Name, year, season</div>
          </div>
          <span className="manage-menu-card-arrow">›</span>
        </button>
        <button className="manage-menu-card" onClick={() => setView('players')}>
          <div>
            <div className="manage-menu-card-title">Manage Players</div>
            <div className="manage-menu-card-sub">{players.length} player{players.length !== 1 ? 's' : ''}</div>
          </div>
          <span className="manage-menu-card-arrow">›</span>
        </button>
        <button className="manage-menu-card" onClick={() => setView('invites')}>
          <div>
            <div className="manage-menu-card-title">Invites</div>
            <div className="manage-menu-card-sub">Generate and view invite links</div>
          </div>
          <span className="manage-menu-card-arrow">›</span>
        </button>
      </div>
    )
  }

  // ── Edit Tournament ───────────────────────────────────────────────────────
  if (view === 'edit') {
    return (
      <div className="score-form">
        <SubHeader title="Edit Tournament" onBack={() => setView('menu')} />
        <div className="form-field">
          <label>Name</label>
          <input type="text" className="gate-input" style={{ textAlign: 'left' }}
            value={editName} onChange={e => { setEditName(e.target.value); setEditSuccess(false) }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="form-field">
            <label>Year</label>
            <input type="number" className="gate-input" style={{ textAlign: 'left' }}
              value={editYear} onChange={e => { setEditYear(e.target.value); setEditSuccess(false) }} />
          </div>
          <div className="form-field">
            <label>Season</label>
            <select value={editSeason} onChange={e => { setEditSeason(e.target.value); setEditSuccess(false) }}>
              <option value="Apertura">Apertura</option>
              <option value="Clausura">Clausura</option>
            </select>
          </div>
        </div>
        {editError && <div className="error">{editError}</div>}
        {editSuccess && (
          <div className="success-msg">
            Tournament updated! <button onClick={() => setEditSuccess(false)}>×</button>
          </div>
        )}
        <button className="generate-btn" onClick={saveTournament} disabled={editSaving}>
          {editSaving ? <span className="loading-text"><span className="spinner" />Saving…</span> : 'Save Tournament'}
        </button>
      </div>
    )
  }

  // ── Manage Players ────────────────────────────────────────────────────────
  if (view === 'players') {
    const q = playerSearch.trim().toLowerCase()
    const filtered = q
      ? players.filter(p => (p.display_name ?? p.user_id).toLowerCase().includes(q))
      : players

    return (
      <div className="score-form">
        <SubHeader title="Manage Players" onBack={() => { setView('menu'); setPlayerSearch('') }} />

        {!isOwner && (
          <div style={{
            background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.18)',
            borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 16,
            fontSize: '0.82rem', color: 'var(--text-dim)',
          }}>
            Only the tournament owner can manage admin roles.
          </div>
        )}

        <input
          type="text"
          className="gate-input"
          style={{ textAlign: 'left', marginBottom: 16 }}
          placeholder="Search players…"
          value={playerSearch}
          onChange={e => setPlayerSearch(e.target.value)}
        />

        {playerError && <div className="error" style={{ marginBottom: 12 }}>{playerError}</div>}

        {filtered.length === 0 && (
          <div className="status-msg" style={{ padding: '16px 0' }}>
            {q ? 'No players match.' : 'No players yet.'}
          </div>
        )}

        <div className="constraint-section" style={{ padding: 0, overflow: 'hidden' }}>
          {filtered.map((p, i) => {
            const isOwnRow = p.user_id === userId
            const isOwnerRow = p.is_owner
            const isLastRow = i === filtered.length - 1

            return (
              <div key={p.user_id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '11px 14px',
                borderBottom: isLastRow ? 'none' : '1px solid var(--border)',
              }}>
                {/* Name + badges */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '0.87rem', color: 'var(--text)', fontWeight: isOwnerRow ? 700 : 400 }}>
                    {p.display_name ?? p.user_id}
                  </span>
                  {isOwnerRow && (
                    <span style={{
                      marginLeft: 7, fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase',
                      letterSpacing: '0.07em', color: 'var(--green)',
                      background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)',
                      borderRadius: 20, padding: '1px 7px',
                    }}>
                      Owner
                    </span>
                  )}
                  {isOwnRow && !isOwnerRow && (
                    <span style={{
                      marginLeft: 7, fontSize: '0.72rem', color: 'var(--text-dim)',
                    }}>
                      (you)
                    </span>
                  )}
                  {isOwnRow && isOwnerRow && (
                    <span style={{
                      marginLeft: 7, fontSize: '0.72rem', color: 'var(--text-dim)',
                    }}>
                      (you)
                    </span>
                  )}
                </div>

                {/* Controls */}
                {!isOwnerRow && !isOwnRow && (() => {
                  const isAdminRow = p.role === 'admin'
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {isOwner ? (
                        <select
                          value={p.role}
                          disabled={!!roleChanging[p.user_id]}
                          onChange={e => changeRole(p.user_id, e.target.value)}
                          style={{ fontSize: '0.78rem', padding: '3px 6px' }}
                        >
                          <option value="player">Player</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span style={{
                          fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: isAdminRow ? 'var(--green)' : 'var(--text-muted)',
                        }}>
                          {p.role}
                        </span>
                      )}
                      {(isOwner || !isAdminRow) && (
                        <button
                          className="delete-match-btn"
                          disabled={!!removing[p.user_id]}
                          onClick={() => removePlayer(p.user_id)}
                          style={{ padding: '3px 8px', fontSize: '0.78rem' }}
                        >
                          {removing[p.user_id] ? '…' : 'Remove'}
                        </button>
                      )}
                    </div>
                  )
                })()}

                {/* Owner row — no controls, just role badge */}
                {isOwnerRow && (
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: 'var(--green)', flexShrink: 0,
                  }}>
                    admin
                  </span>
                )}

                {/* Own row (non-owner) — no controls, just role badge */}
                {!isOwnerRow && isOwnRow && (
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: p.role === 'admin' ? 'var(--green)' : 'var(--text-muted)',
                    flexShrink: 0,
                  }}>
                    {p.role}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Invites ───────────────────────────────────────────────────────────────
  if (view === 'invites') {
    return (
      <div className="score-form">
        <SubHeader title="Invites" onBack={() => setView('menu')} />

        {/* Generate */}
        <div className="constraint-section" style={{ marginBottom: 16 }}>
          <h3>Generate Invite Link</h3>
          <div className="form-field" style={{ marginTop: 10 }}>
            <label>Role</label>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
              <option value="player">Player</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button className="add-btn" onClick={generateInvite} disabled={inviteLoading}
            style={{ width: '100%', padding: 10 }}>
            {inviteLoading ? 'Generating…' : 'Generate Invite Link'}
          </button>
          {inviteError && <div className="error" style={{ marginTop: 8 }}>{inviteError}</div>}
          {inviteLink && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                background: 'var(--surface3)', border: '1px solid var(--border-mid)',
                borderRadius: 'var(--radius-sm)', padding: '10px 12px',
                fontSize: '0.75rem', color: 'var(--text-dim)', wordBreak: 'break-all',
                marginBottom: 8,
              }}>
                {inviteLink}
              </div>
              <button className="add-btn" onClick={copyLink} style={{ width: '100%', padding: 10 }}>
                {copied ? '✓ Copied!' : 'Copy Link'}
              </button>
            </div>
          )}
        </div>

        {/* Pending */}
        <div className="constraint-section">
          <h3>Pending Invites</h3>
          {pendingLoading && <div style={{ color: 'var(--text-dim)', fontSize: '0.87rem', paddingTop: 8 }}>Loading…</div>}
          {pendingError && <div className="error">{pendingError}</div>}
          {!pendingLoading && !pendingError && pendingInvites.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.87rem', paddingTop: 8 }}>No active invites.</div>
          )}
          {pendingInvites.map((inv, i) => (
            <div key={inv.token} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '9px 0',
              borderBottom: i < pendingInvites.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div>
                <span style={{
                  fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: inv.role === 'admin' ? 'var(--green)' : 'var(--text-muted)',
                  marginRight: 8,
                }}>
                  {inv.role}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  expires {formatExpiry(inv.expires_at)}
                </span>
              </div>
              <button className="add-btn" onClick={() => copyInviteUrl(inv.token)}
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
                {copiedToken === inv.token ? '✓ Copied!' : 'Copy'}
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return null
}
