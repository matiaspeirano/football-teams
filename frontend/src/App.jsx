import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import { supabase } from './supabase'

const API_BASE = import.meta.env.PROD
  ? 'https://football-teams-backend.onrender.com'
  : ''

const todayStr = () => new Date().toISOString().slice(0, 10)
const pairKey = (a, b) => [a, b].sort().join('|')

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const formatScheduledAt = iso => {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm}`
}

function getInviteToken() {
  const m = window.location.pathname.match(/^\/invite\/(.+)$/)
  return m ? m[1] : null
}

function suggestTournament() {
  const now = new Date()
  const year = now.getFullYear()
  const season = now.getMonth() + 1 >= 7 ? 'Apertura' : 'Clausura'
  return { name: `${season} ${year}`, year, season }
}

// ─── Top-level ────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [inviteToken] = useState(getInviteToken)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (authLoading) return <div className="app"><div className="status-msg">Loading…</div></div>
  if (!session) return <AuthScreen inviteToken={inviteToken} />
  return <MainApp session={session} inviteToken={inviteToken} />
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────

function AuthScreen({ inviteToken }) {
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

// ─── Main App ─────────────────────────────────────────────────────────────────

function MainApp({ session, inviteToken }) {
  const [tournaments, setTournaments] = useState([])
  const [selectedTid, setSelectedTid] = useState(null)
  const [myRole, setMyRole] = useState(null)
  const [tournamentPlayers, setTournamentPlayers] = useState([])
  const [roleLoading, setRoleLoading] = useState(false)
  const [tab, setTab] = useState('standings')
  const [inviteNote, setInviteNote] = useState(null) // 'accepted' | 'error'
  const [inviteErrMsg, setInviteErrMsg] = useState(null)
  const [teamsPreselect, setTeamsPreselect] = useState(null)
  const [teamsKey, setTeamsKey] = useState(0)
  const myUserId = session.user.id
  const inviteAcceptedRef = useRef(false)

  const apiFetch = useCallback((path, opts = {}) =>
    fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
        Authorization: `Bearer ${session.access_token}`,
      },
    }), [session.access_token])

  // Load tournaments on mount / token refresh
  useEffect(() => {
    apiFetch('/api/tournaments')
      .then(r => r.json())
      .then(data => {
        setTournaments(data)
        // Auto-select first tournament only if nothing is selected yet
        setSelectedTid(prev => prev ?? (data.length > 0 ? data[0].id : null))
      })
      .catch(() => {})
  }, [apiFetch])

  // Fetch role + players when tournament changes
  useEffect(() => {
    if (!selectedTid) { setMyRole(null); setTournamentPlayers([]); return }
    setRoleLoading(true)
    Promise.all([
      apiFetch(`/api/tournaments/${selectedTid}/my-role`).then(r => r.json()),
      apiFetch(`/api/tournaments/${selectedTid}/players`).then(r => r.json()),
    ]).then(([roleData, players]) => {
      setMyRole(roleData.role)
      setTournamentPlayers(players)
    }).catch(() => setMyRole(null))
      .finally(() => setRoleLoading(false))
  }, [selectedTid, apiFetch])

  // Drop to a valid tab when role changes
  useEffect(() => {
    if (myRole !== 'admin' && ['teams', 'score', 'manage'].includes(tab)) {
      setTab('standings')
    }
  }, [myRole])

  // Accept invite once after login
  useEffect(() => {
    if (!inviteToken || inviteAcceptedRef.current) return
    inviteAcceptedRef.current = true
    apiFetch('/api/invite/accept', {
      method: 'POST',
      body: JSON.stringify({ token: inviteToken }),
    }).then(async r => {
      if (!r.ok) {
        const e = await r.json()
        setInviteErrMsg(e.detail || 'Failed to accept invite')
        setInviteNote('error')
        return
      }
      const data = await r.json()
      setInviteNote('accepted')
      window.history.replaceState({}, '', '/')
      // Refresh tournaments and jump to the joined one
      apiFetch('/api/tournaments').then(r => r.json()).then(ts => {
        setTournaments(ts)
        if (data.tournament_id) setSelectedTid(data.tournament_id)
      }).catch(() => {})
    }).catch(() => { setInviteErrMsg('Failed to accept invite'); setInviteNote('error') })
  }, [inviteToken, apiFetch])

  const tabs = myRole === 'admin'
    ? [
        { id: 'standings', label: 'Standings' },
        { id: 'matches',   label: 'Matches' },
        { id: 'rate',      label: 'Rate Players' },
        { id: 'profile',   label: 'Profile' },
        { id: 'teams',     label: 'Create Teams' },
        { id: 'score',     label: 'Enter Score' },
        { id: 'manage',    label: 'Manage' },
      ]
    : [
        { id: 'standings', label: 'Standings' },
        { id: 'matches',   label: 'Matches' },
        { id: 'rate',      label: 'Rate Players' },
        { id: 'profile',   label: 'Profile' },
      ]

  const refreshPlayers = () => {
    if (!selectedTid) return
    apiFetch(`/api/tournaments/${selectedTid}/players`)
      .then(r => r.json()).then(setTournamentPlayers).catch(() => {})
  }

  const goToTeamsWithPlayers = useCallback(playerIds => {
    setTeamsPreselect(playerIds)
    setTeamsKey(k => k + 1)
    setTab('teams')
  }, [])

  const handleSelectTournament = id => {
    setSelectedTid(id || null)
    setTab('standings')
  }

  return (
    <div className="app">
      <div className="app-header">
        <h1>⚽ Fútbol Tournament</h1>
        <button className="logout-btn" onClick={() => supabase.auth.signOut()}>Logout</button>
      </div>

      {inviteNote === 'error' && (
        <div className="error" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Invite error: {inviteErrMsg}</span>
          <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.1rem' }}
            onClick={() => setInviteNote(null)}>×</button>
        </div>
      )}
      {inviteNote === 'accepted' && (
        <div className="info-msg" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>You've been added to the tournament!</span>
          <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.1rem' }}
            onClick={() => setInviteNote(null)}>×</button>
        </div>
      )}

      <div className="form-field" style={{ marginBottom: 20 }}>
        <label>Tournament</label>
        <select value={selectedTid ?? ''} onChange={e => handleSelectTournament(Number(e.target.value) || null)}>
          <option value="">Select a tournament…</option>
          {tournaments.map(t => (
            <option key={t.id} value={t.id}>{t.name} — {t.season} {t.year}</option>
          ))}
        </select>
      </div>

      {/* Empty state: no tournaments at all */}
      {!selectedTid && !roleLoading && (
        <div className="gate-card">
          <div className="gate-icon">🏆</div>
          <h2>Welcome!</h2>
          <p>Create your first tournament or join one via an invite link.</p>
          <CreateTournamentForm
            apiFetch={apiFetch}
            onCreated={t => { setTournaments(prev => [t, ...prev]); setSelectedTid(t.id) }}
          />
        </div>
      )}

      {selectedTid && roleLoading && <div className="status-msg">Loading…</div>}

      {/* Not a member of this tournament */}
      {selectedTid && !roleLoading && myRole === null && (
        <div className="gate-card">
          <div className="gate-icon">🔒</div>
          <h2>Not a member</h2>
          <p>You are not a member of this tournament. Join via an invite link.</p>
        </div>
      )}

      {/* Main tab content */}
      {selectedTid && !roleLoading && myRole && (
        <>
          <nav className="nav-bar">
            {tabs.map(t => (
              <button key={t.id} className={`nav-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>

          {/* key forces remount (and state reset) when the tournament changes */}
          <div key={selectedTid}>
            {tab === 'standings' && (
              <StandingsTab tournamentId={selectedTid} apiFetch={apiFetch} />
            )}
            {tab === 'matches' && (
              <MatchesTab
                tournamentId={selectedTid}
                apiFetch={apiFetch}
                myRole={myRole}
                userId={myUserId}
                onGenerateTeams={goToTeamsWithPlayers}
              />
            )}
            {tab === 'rate' && (
              <RatePlayersTab tournamentId={selectedTid} apiFetch={apiFetch} />
            )}
            {tab === 'profile' && (
              <ProfileTab apiFetch={apiFetch} />
            )}
            {tab === 'teams' && myRole === 'admin' && (
              <CreateTeamsTab
                key={teamsKey}
                tournamentId={selectedTid}
                apiFetch={apiFetch}
                preselectedIds={teamsPreselect}
              />
            )}
            {tab === 'score' && myRole === 'admin' && (
              <EnterScoreTab tournamentId={selectedTid} apiFetch={apiFetch} players={tournamentPlayers} />
            )}
            {tab === 'manage' && myRole === 'admin' && (
              <ManageTab
                tournamentId={selectedTid}
                apiFetch={apiFetch}
                players={tournamentPlayers}
                onTournamentCreated={t => {
                  setTournaments(prev => [t, ...prev])
                  setSelectedTid(t.id)
                  setTab('standings')
                }}
                onPlayersChanged={refreshPlayers}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Standings Tab ────────────────────────────────────────────────────────────

const MEDAL = ['🥇', '🥈', '🥉']
const RANK_CLASS = ['rank-gold', 'rank-silver', 'rank-bronze']

function StandingsTab({ tournamentId, apiFetch }) {
  const [standings, setStandings] = useState(null)
  const [matchCount, setMatchCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    Promise.all([
      apiFetch(`/api/tournaments/${tournamentId}/standings`).then(r => r.json()),
      apiFetch(`/api/tournaments/${tournamentId}/matches`).then(r => r.json()),
    ]).then(([rows, matches]) => {
      setStandings(rows)
      setMatchCount(matches.length)
    }).catch(() => setError('Failed to load standings'))
      .finally(() => setLoading(false))
  }, [tournamentId])

  return (
    <div className="standings-tab">
      {loading && <div className="status-msg">Loading standings…</div>}
      {error && <div className="error">{error}</div>}
      {standings && (
        <>
          <div className="standings-summary">
            {matchCount} {matchCount === 1 ? 'match' : 'matches'} played
          </div>
          {standings.length === 0 && (
            <div className="status-msg">No matches recorded yet.</div>
          )}
          {standings.length > 0 && (
            <div className="table-wrap">
              <table className="standings-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="th-left">Player</th>
                    <th title="Matches">M</th>
                    <th title="Wins">W</th>
                    <th title="Draws">D</th>
                    <th title="Losses">L</th>
                    <th title="Effectivity">Eff</th>
                    <th title="MVP">MVP</th>
                    <th title="Presence %">Pres%</th>
                    <th title="Total Score">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row, i) => (
                    <tr key={row.user_id} className={RANK_CLASS[i] ?? ''}>
                      <td className="rank-cell">{i < 3 ? MEDAL[i] : i + 1}</td>
                      <td className="name-cell">{row.display_name ?? row.user_id}</td>
                      <td>{row.matches_played}</td>
                      <td>{row.wins}</td>
                      <td>{row.draws}</td>
                      <td>{row.losses}</td>
                      <td>{(row.effectivity * 100).toFixed(0)}%</td>
                      <td>{row.mvp_count}</td>
                      <td>{row.presence_pct}%</td>
                      <td className="score-cell">{row.total_score.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Profile Tab ─────────────────────────────────────────────────────────────

function ProfileTab({ apiFetch }) {
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch('/api/me')
      .then(r => r.json())
      .then(data => { setDisplayName(data.display_name ?? ''); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true); setError(null); setSuccess(false)
    try {
      const res = await apiFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ display_name: displayName }),
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

// ─── Rate Players Tab ─────────────────────────────────────────────────────────

function RatePlayersTab({ tournamentId, apiFetch }) {
  const [players, setPlayers] = useState([])
  const [ratings, setRatings] = useState({}) // { [user_id]: { play, run, goals, skip } }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      apiFetch(`/api/tournaments/${tournamentId}/players`).then(r => r.json()),
      apiFetch(`/api/tournaments/${tournamentId}/ratings`).then(r => r.json()),
    ]).then(([playerList, myRatings]) => {
      setPlayers(playerList)
      const map = {}
      for (const r of myRatings) {
        map[r.rated_id] = { play: r.play, run: r.run, goals: r.goals, skip: false }
      }
      for (const p of playerList) {
        if (!map[p.user_id]) map[p.user_id] = { play: 3, run: 3, goals: 3, skip: false }
      }
      setRatings(map)
    }).catch(() => setError('Failed to load players'))
      .finally(() => setLoading(false))
  }, [tournamentId])

  const update = (uid, field, val) => {
    setRatings(prev => ({ ...prev, [uid]: { ...prev[uid], [field]: val } }))
    setSuccess(false)
  }

  const saveAll = async () => {
    setSaving(true); setError(null); setSuccess(false)
    const body = players
      .filter(p => !ratings[p.user_id]?.skip)
      .map(p => ({
        rated_id: p.user_id,
        play:  ratings[p.user_id]?.play  ?? 3,
        run:   ratings[p.user_id]?.run   ?? 3,
        goals: ratings[p.user_id]?.goals ?? 3,
      }))
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/ratings`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to save ratings')
      setSuccess(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="status-msg">Loading players…</div>

  return (
    <div className="score-form">
      <div style={{
        background: 'var(--surface)',
        borderLeft: '3px solid var(--green)',
        borderRadius: 'var(--radius-sm)',
        padding: '12px 14px',
        marginBottom: 16,
      }}>
        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--green)', marginBottom: 6 }}>
          How ratings work
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.55, margin: 0 }}>
          Rate each player across 3 dimensions from 1 (lowest) to 5 (highest). Scores are averaged
          across all submitted ratings and used to balance teams fairly.{' '}
          <strong style={{ color: 'var(--text)' }}>Play</strong> = technical ability,{' '}
          <strong style={{ color: 'var(--text)' }}>Run</strong> = athleticism and effort,{' '}
          <strong style={{ color: 'var(--text)' }}>Goals</strong> = scoring ability.
          You can rate yourself. Skip players you haven't played with.
        </p>
      </div>

      {players.length === 0 && (
        <div className="status-msg">No players in this tournament yet.</div>
      )}
      {players.map(p => {
        const r = ratings[p.user_id] ?? { play: 3, run: 3, goals: 3, skip: false }
        return (
          <div key={p.user_id} style={{
            background: 'var(--surface)', border: '1px solid var(--border-mid)',
            borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 10,
            opacity: r.skip ? 0.4 : 1, transition: 'opacity 0.15s',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)' }}>
                {p.display_name ?? p.user_id}
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-dim)', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  style={{ accentColor: 'var(--green)', width: 14, height: 14 }}
                  checked={r.skip}
                  onChange={e => update(p.user_id, 'skip', e.target.checked)}
                />
                Skip
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[['play', 'Play'], ['run', 'Run'], ['goals', 'Goals']].map(([field, label]) => (
                <div key={field}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)', marginBottom: 5 }}>
                    {label}
                  </div>
                  <input
                    type="number" min={1} max={5}
                    value={r[field]} disabled={r.skip}
                    onChange={e => update(p.user_id, field, Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
                    style={{
                      width: '100%', background: 'var(--surface3)',
                      border: '1px solid var(--border-mid)', borderRadius: 'var(--radius-sm)',
                      color: 'var(--text)', padding: '7px 4px', fontSize: '1rem',
                      fontWeight: 700, textAlign: 'center', outline: 'none',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {error && <div className="error">{error}</div>}
      {success && (
        <div className="success-msg">
          Ratings saved! <button onClick={() => setSuccess(false)}>×</button>
        </div>
      )}
      {players.length > 0 && (
        <button className="generate-btn" onClick={saveAll} disabled={saving}>
          {saving
            ? <span className="loading-text"><span className="spinner" />Saving…</span>
            : 'Save All Ratings'}
        </button>
      )}
    </div>
  )
}

// ─── Create Teams Tab ─────────────────────────────────────────────────────────

function CreateTeamsTab({ tournamentId, apiFetch, preselectedIds }) {
  const [players, setPlayers] = useState([])
  const [playersLoading, setPlayersLoading] = useState(true)
  const [selected, setSelected] = useState(() => new Set(preselectedIds ?? []))
  const [numPerTeam, setNumPerTeam] = useState(
    preselectedIds?.length >= 4 ? Math.floor(preselectedIds.length / 2) : 6
  )
  const [mustTogether, setMustTogether] = useState([])
  const [mustSeparate, setMustSeparate] = useState([])
  const [tp1, setTp1] = useState(''); const [tp2, setTp2] = useState('')
  const [sp1, setSp1] = useState(''); const [sp2, setSp2] = useState('')
  const [togetherErr, setTogetherErr] = useState('')
  const [separateErr, setSeparateErr] = useState('')
  const [solutions, setSolutions] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setPlayersLoading(true)
    apiFetch(`/api/tournaments/${tournamentId}/players`)
      .then(r => r.json())
      .then(data => { setPlayers(data); setPlayersLoading(false) })
      .catch(() => setPlayersLoading(false))
  }, [tournamentId])

  const needed = numPerTeam * 2
  const atLimit = selected.size >= needed
  const canGenerate = selected.size === needed
  const selectedPlayers = players.filter(p => selected.has(p.user_id))
  const nameFor = id => {
    const p = players.find(p => p.user_id === id)
    return p?.display_name || p?.email || id
  }

  const toggle = id => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else if (next.size < needed) next.add(id)
    return next
  })

  // Returns true if the pair was added, false if validation failed
  const tryAddPair = (p1, p2, list, setList, otherList, setErr) => {
    if (!p1 || !p2) return false
    if (p1 === p2) { setErr('Select two different players'); return false }
    const key = pairKey(p1, p2)
    if (list.some(([a, b]) => pairKey(a, b) === key)) { setErr('Already added'); return false }
    if (otherList.some(([a, b]) => pairKey(a, b) === key)) { setErr('Conflicts with other constraint'); return false }
    setErr(''); setList(prev => [...prev, [p1, p2]]); return true
  }

  const generate = async () => {
    setLoading(true); setError(null); setSolutions(null)
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/generate-teams`, {
        method: 'POST',
        body: JSON.stringify({
          num_players_per_team: numPerTeam,
          selected_player_ids: [...selected],
          must_together: mustTogether,
          must_separate: mustSeparate,
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Server error') }
      setSolutions(await res.json())
      setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="config-row">
        <label>Players per team</label>
        <input type="number" min={2} max={15} value={numPerTeam}
          onChange={e => setNumPerTeam(Math.max(2, Number(e.target.value)))} />
      </div>

      <div className="counter">
        <span className={canGenerate ? 'count good' : 'count'}>{selected.size} / {needed} selected</span>
        <span className="hint"> — {numPerTeam} per team</span>
      </div>

      <div className="player-grid">
        {playersLoading
          ? <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Loading players…</p>
          : players.map(p => {
              const isSel = selected.has(p.user_id)
              const isDis = !isSel && atLimit
              const score = (p.avg_play + p.avg_run + p.avg_goals).toFixed(1)
              return (
                <button key={p.user_id}
                  className={`player-btn${isSel ? ' selected' : ''}${isDis ? ' limit-reached' : ''}`}
                  onClick={() => toggle(p.user_id)} disabled={isDis}>
                  {p.display_name || p.email || p.user_id}
                  <span style={{ display: 'block', fontSize: '0.68rem', opacity: 0.65, marginTop: 2 }}>
                    [{score}]
                  </span>
                </button>
              )
            })
        }
      </div>

      <ConstraintSection
        title="Must play together"
        pairs={mustTogether}
        onRemove={i => setMustTogether(prev => prev.filter((_, j) => j !== i))}
        p1={tp1} setP1={v => { setTp1(v); setTogetherErr('') }}
        p2={tp2} setP2={v => { setTp2(v); setTogetherErr('') }}
        onAdd={() => {
          if (tryAddPair(tp1, tp2, mustTogether, setMustTogether, mustSeparate, setTogetherErr)) {
            setTp1(''); setTp2('')
          }
        }}
        players={selectedPlayers} nameFor={nameFor} error={togetherErr}
      />

      <ConstraintSection
        title="Must be separated"
        pairs={mustSeparate}
        onRemove={i => setMustSeparate(prev => prev.filter((_, j) => j !== i))}
        p1={sp1} setP1={v => { setSp1(v); setSeparateErr('') }}
        p2={sp2} setP2={v => { setSp2(v); setSeparateErr('') }}
        onAdd={() => {
          if (tryAddPair(sp1, sp2, mustSeparate, setMustSeparate, mustTogether, setSeparateErr)) {
            setSp1(''); setSp2('')
          }
        }}
        players={selectedPlayers} nameFor={nameFor} error={separateErr}
      />

      {error && <div className="error">{error}</div>}

      <button className="generate-btn" onClick={generate} disabled={!canGenerate || loading}>
        {loading
          ? <span className="loading-text"><span className="spinner" />Generating…</span>
          : `Generate Teams${canGenerate ? '' : ` (${needed - selected.size} more needed)`}`}
      </button>

      {solutions && (
        <div id="results" className="solutions">
          <h2 className="results-title">Results</h2>
          {solutions.map((sol, i) => <SolutionCard key={i} solution={sol} index={i} />)}
        </div>
      )}
    </>
  )
}

// ─── Enter Score Tab ──────────────────────────────────────────────────────────

function EnterScoreTab({ tournamentId, apiFetch, players }) {
  const [numPerTeam, setNumPerTeam] = useState(6)
  const [date, setDate] = useState(todayStr())
  const [team1, setTeam1] = useState(new Set())
  const [team2, setTeam2] = useState(new Set())
  const [result, setResult] = useState('')
  const [mvp, setMvp] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(null)

  const matchIds = [...team1, ...team2]

  const toggleTeam1 = id => {
    if (!team1.has(id) && team1.size >= numPerTeam) return
    setTeam1(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) }
      else { next.add(id); setTeam2(p => { const n = new Set(p); n.delete(id); return n }) }
      return next
    })
    if (mvp === id) setMvp('')
  }

  const toggleTeam2 = id => {
    if (!team2.has(id) && team2.size >= numPerTeam) return
    setTeam2(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) }
      else { next.add(id); setTeam1(p => { const n = new Set(p); n.delete(id); return n }) }
      return next
    })
    if (mvp === id) setMvp('')
  }

  const reset = () => { setTeam1(new Set()); setTeam2(new Set()); setMvp('') }

  const submit = async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/matches`, {
        method: 'POST',
        body: JSON.stringify({
          played_at: date,
          team1_players: [...team1],
          team2_players: [...team2],
          result,
          mvp: mvp || null,
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Server error') }
      setSuccess(true); reset(); setResult(''); setDate(todayStr())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="score-form">
      {success && (
        <div className="success-msg">
          Match recorded! <button onClick={() => setSuccess(false)}>×</button>
        </div>
      )}

      <div className="config-row" style={{ marginBottom: 16 }}>
        <label>Players per team</label>
        <input type="number" min={1} max={15} value={numPerTeam}
          onChange={e => { setNumPerTeam(Math.max(1, Number(e.target.value))); reset() }} />
      </div>

      <div className="form-field">
        <label>Match date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>

      <div className="player-cols">
        <div className="player-col">
          <div className="col-label">Team 1 ({team1.size}/{numPerTeam})</div>
          {players.map(p => {
            const inT1 = team1.has(p.user_id), inT2 = team2.has(p.user_id)
            const dis = !inT1 && (inT2 || team1.size >= numPerTeam)
            return (
              <label key={p.user_id}
                className={`check-row${inT1 ? ' checked-t1' : inT2 ? ' in-other' : ''}${dis ? ' check-disabled' : ''}`}>
                <input type="checkbox" checked={inT1} disabled={dis}
                  onChange={() => toggleTeam1(p.user_id)} />
                {p.display_name ?? p.user_id}
              </label>
            )
          })}
        </div>
        <div className="player-col">
          <div className="col-label">Team 2 ({team2.size}/{numPerTeam})</div>
          {players.map(p => {
            const inT1 = team1.has(p.user_id), inT2 = team2.has(p.user_id)
            const dis = !inT2 && (inT1 || team2.size >= numPerTeam)
            return (
              <label key={p.user_id}
                className={`check-row${inT2 ? ' checked-t2' : inT1 ? ' in-other' : ''}${dis ? ' check-disabled' : ''}`}>
                <input type="checkbox" checked={inT2} disabled={dis}
                  onChange={() => toggleTeam2(p.user_id)} />
                {p.display_name ?? p.user_id}
              </label>
            )
          })}
        </div>
      </div>

      <div className="form-field">
        <label>Result</label>
        <div className="result-btns">
          {[['team1', 'Team 1 Won'], ['draw', 'Draw'], ['team2', 'Team 2 Won']].map(([val, label]) => (
            <button key={val} className={`result-btn${result === val ? ' active' : ''}`}
              onClick={() => setResult(val)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="form-field">
        <label>MVP <span className="optional">(optional)</span></label>
        <select value={mvp} onChange={e => setMvp(e.target.value)} disabled={matchIds.length === 0}>
          <option value="">None</option>
          {matchIds.map(id => (
            <option key={id} value={id}>
              {players.find(p => p.user_id === id)?.display_name ?? id}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error">{error}</div>}

      <button className="generate-btn"
        onClick={submit}
        disabled={!(date && team1.size > 0 && team2.size > 0 && result) || loading}>
        {loading ? <span className="loading-text"><span className="spinner" />Saving…</span> : 'Save Match'}
      </button>
    </div>
  )
}

// ─── Manage Tab ───────────────────────────────────────────────────────────────

function ManageTab({ tournamentId, apiFetch, players, onTournamentCreated }) {
  const [inviteRole, setInviteRole] = useState('player')
  const [inviteLink, setInviteLink] = useState(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState(null)
  const [copied, setCopied] = useState(false)

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

  return (
    <div className="score-form">

      {/* ── Create New Tournament ── */}
      <div className="constraint-section" style={{ marginBottom: 20 }}>
        <h3>Create New Tournament</h3>
        <CreateTournamentForm apiFetch={apiFetch} onCreated={onTournamentCreated} />
      </div>

      {/* ── Invite Players ── */}
      <div className="constraint-section" style={{ marginBottom: 20 }}>
        <h3>Invite Players</h3>
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

      {/* ── Player list ── */}
      <div className="constraint-section">
        <h3>Players in this tournament</h3>
        {players.length === 0 && (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.87rem', paddingTop: 8 }}>
            No players yet.
          </div>
        )}
        {players.map((p, i) => (
          <div key={p.user_id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 0',
            borderBottom: i < players.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <span style={{ fontSize: '0.87rem', color: 'var(--text)' }}>
              {p.display_name ?? p.user_id}
            </span>
            <span style={{
              fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: p.role === 'admin' ? 'var(--green)' : 'var(--text-muted)',
            }}>
              {p.role}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Matches Tab ──────────────────────────────────────────────────────────────

function MatchesTab({ tournamentId, apiFetch, myRole, userId, onGenerateTeams }) {
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

// ─── Create Tournament Form ───────────────────────────────────────────────────

function CreateTournamentForm({ apiFetch, onCreated }) {
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

// ─── Shared Sub-components ────────────────────────────────────────────────────

function ConstraintSection({ title, pairs, onRemove, p1, setP1, p2, setP2, onAdd, players, nameFor, error }) {
  return (
    <div className="constraint-section">
      <h3>{title}</h3>
      <div className="constraint-row">
        <select value={p1} onChange={e => setP1(e.target.value)}>
          <option value="">Player 1</option>
          {players.map(p => (
            <option key={p.user_id} value={p.user_id}>{p.display_name ?? p.user_id}</option>
          ))}
        </select>
        <select value={p2} onChange={e => setP2(e.target.value)}>
          <option value="">Player 2</option>
          {players.map(p => (
            <option key={p.user_id} value={p.user_id}>{p.display_name ?? p.user_id}</option>
          ))}
        </select>
        <button className="add-btn" onClick={onAdd}>Add</button>
      </div>
      {error && <div className="constraint-error">{error}</div>}
      {pairs.length > 0 && (
        <div className="tags">
          {pairs.map(([a, b], i) => (
            <span key={i} className="tag">
              {nameFor(a)} &amp; {nameFor(b)}
              <button onClick={() => onRemove(i)} aria-label="Remove">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function SolutionCard({ solution, index }) {
  return (
    <div className="solution-card">
      <div className="solution-header">
        <span className="option-label">Option {index + 1}</span>
        <span className="diff-badge">Δ {solution.difference}</span>
      </div>
      <div className="teams">
        <TeamColumn label="Team 1" players={solution.team1} total={solution.score_team1} />
        <div className="team-divider" />
        <TeamColumn label="Team 2" players={solution.team2} total={solution.score_team2} />
      </div>
    </div>
  )
}

function TeamColumn({ label, players, total }) {
  return (
    <div className="team-col">
      <div className="team-label">{label}</div>
      <div className="player-list">
        {[...players].sort((a, b) => b.score - a.score).map(p => (
          <div key={p.id} className="player-row">
            <span className="player-name">{p.display_name ?? p.id}</span>
            <span className="player-score">{Number(p.score).toFixed(1)}</span>
          </div>
        ))}
      </div>
      <div className="team-total">
        <span>Total</span>
        <span className="total-value">{Number(total).toFixed(1)}</span>
      </div>
    </div>
  )
}
