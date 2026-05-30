import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import { supabase } from './supabase'
import AuthScreen from './components/AuthScreen'
import StandingsTab from './components/StandingsTab'
import MatchesTab from './components/MatchesTab'
import RatePlayersTab from './components/RatePlayersTab'
import ProfileTab from './components/ProfileTab'
import CreateTeamsTab from './components/CreateTeamsTab'
import EnterScoreTab from './components/EnterScoreTab'
import ManageTab, { CreateTournamentForm } from './components/ManageTab'

const API_BASE = import.meta.env.PROD
  ? 'https://football-teams-backend.onrender.com'
  : ''

function getInviteToken() {
  const m = window.location.pathname.match(/^\/invite\/(.+)$/)
  return m ? m[1] : null
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
  const [showNewTournament, setShowNewTournament] = useState(false)
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

      <div className="form-field" style={{ marginBottom: showNewTournament ? 0 : 20 }}>
        <label>Tournament</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select style={{ flex: 1, minWidth: 0 }} value={selectedTid ?? ''} onChange={e => handleSelectTournament(Number(e.target.value) || null)}>
            <option value="">Select a tournament…</option>
            {tournaments.map(t => (
              <option key={t.id} value={t.id}>{t.name} — {t.season} {t.year}</option>
            ))}
          </select>
          <button
            className="add-btn"
            onClick={() => setShowNewTournament(v => !v)}
            style={{ flexShrink: 0, padding: '0 14px' }}
          >
            {showNewTournament ? '×' : '+ New'}
          </button>
        </div>
      </div>

      {showNewTournament && (
        <div className="constraint-section" style={{ marginBottom: 20 }}>
          <h3>New Tournament</h3>
          <CreateTournamentForm
            apiFetch={apiFetch}
            onCreated={t => {
              setTournaments(prev => [t, ...prev])
              setSelectedTid(t.id)
              setShowNewTournament(false)
            }}
          />
        </div>
      )}

      {/* Empty state: no tournaments at all */}
      {!selectedTid && !roleLoading && !showNewTournament && (
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
                userId={myUserId}
                tournament={tournaments.find(t => t.id === selectedTid) ?? null}
                onTournamentUpdated={t => setTournaments(prev => prev.map(x => x.id === t.id ? t : x))}
                onPlayersChanged={refreshPlayers}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
