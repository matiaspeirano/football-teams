import { useState, useEffect } from 'react'
import './App.css'

const API_BASE = import.meta.env.PROD
  ? 'https://football-teams-backend.onrender.com'
  : ''

const SCORE_PASSWORD = 'apertura2026'

const todayStr = () => new Date().toISOString().slice(0, 10)
const pairKey = (a, b) => [a, b].sort().join('|')

export default function App() {
  const [tab, setTab] = useState('standings')
  const [authed, setAuthed] = useState(false)
  const [players, setPlayers] = useState([])
  const [tournaments, setTournaments] = useState([])
  const [fetchError, setFetchError] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/players`)
      .then(r => r.json())
      .then(setPlayers)
      .catch(() => setFetchError('Could not load players. Is the backend running?'))
  }, [])

  useEffect(() => {
    fetch(`${API_BASE}/api/tournaments`)
      .then(r => r.json())
      .then(setTournaments)
      .catch(() => {})
  }, [])

  if (fetchError) {
    return (
      <div className="app">
        <h1>⚽ Team Generator</h1>
        <div className="error">{fetchError}</div>
      </div>
    )
  }

  const isProtected = tab === 'teams' || tab === 'score'

  return (
    <div className="app">
      <h1>⚽ Team Generator</h1>
      <NavBar tab={tab} setTab={setTab} />
      {tab === 'standings' && <StandingsTab tournaments={tournaments} />}
      {isProtected && !authed && <PasswordGate onAuth={() => setAuthed(true)} />}
      {tab === 'teams' && authed && <CreateTeamsTab players={players} />}
      {tab === 'score' && authed && <ScoreForm players={players} tournaments={tournaments} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function NavBar({ tab, setTab }) {
  return (
    <nav className="nav-bar">
      <button className={`nav-tab${tab === 'standings' ? ' active' : ''}`} onClick={() => setTab('standings')}>
        Standings
      </button>
      <button className={`nav-tab${tab === 'teams' ? ' active' : ''}`} onClick={() => setTab('teams')}>
        Create Teams
      </button>
      <button className={`nav-tab${tab === 'score' ? ' active' : ''}`} onClick={() => setTab('score')}>
        Enter Score
      </button>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Password gate (shared by Create Teams and Enter Score)
// ---------------------------------------------------------------------------

function PasswordGate({ onAuth }) {
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState(false)

  const tryUnlock = () => {
    if (pwInput === SCORE_PASSWORD) {
      onAuth()
    } else {
      setPwError(true)
      setPwInput('')
    }
  }

  return (
    <div className="password-gate">
      <div className="gate-card">
        <div className="gate-icon">🔒</div>
        <h2>Protected</h2>
        <p>Enter the password to continue.</p>
        <input
          type="password"
          className="gate-input"
          placeholder="Password"
          value={pwInput}
          onChange={e => { setPwInput(e.target.value); setPwError(false) }}
          onKeyDown={e => e.key === 'Enter' && tryUnlock()}
          autoFocus
        />
        {pwError && <div className="error">Incorrect password</div>}
        <button className="generate-btn" style={{ marginBottom: 0 }} onClick={tryUnlock}>
          Unlock
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create Teams tab
// ---------------------------------------------------------------------------

function CreateTeamsTab({ players }) {
  const [selected, setSelected] = useState(new Set())
  const [numPerTeam, setNumPerTeam] = useState(6)
  const [mustTogether, setMustTogether] = useState([])
  const [mustSeparate, setMustSeparate] = useState([])
  const [togetherP1, setTogetherP1] = useState('')
  const [togetherP2, setTogetherP2] = useState('')
  const [separateP1, setSeparateP1] = useState('')
  const [separateP2, setSeparateP2] = useState('')
  const [togetherError, setTogetherError] = useState('')
  const [separateError, setSeparateError] = useState('')
  const [solutions, setSolutions] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const needed = numPerTeam * 2
  const atLimit = selected.size >= needed
  const canGenerate = selected.size === needed
  const selectedNames = players.filter(p => selected.has(p.name)).map(p => p.name)

  const togglePlayer = (name) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else if (next.size < needed) {
        next.add(name)
      }
      return next
    })
  }

  const addTogether = () => {
    if (!togetherP1 || !togetherP2) return
    if (togetherP1 === togetherP2) {
      setTogetherError('Select two different players')
      return
    }
    const key = pairKey(togetherP1, togetherP2)
    if (mustTogether.some(([a, b]) => pairKey(a, b) === key)) {
      setTogetherError('This pair is already added')
      return
    }
    if (mustSeparate.some(([a, b]) => pairKey(a, b) === key)) {
      setTogetherError('Already in "Must be separated"')
      return
    }
    setTogetherError('')
    setMustTogether(prev => [...prev, [togetherP1, togetherP2]])
    setTogetherP1('')
    setTogetherP2('')
  }

  const addSeparate = () => {
    if (!separateP1 || !separateP2) return
    if (separateP1 === separateP2) {
      setSeparateError('Select two different players')
      return
    }
    const key = pairKey(separateP1, separateP2)
    if (mustSeparate.some(([a, b]) => pairKey(a, b) === key)) {
      setSeparateError('This pair is already added')
      return
    }
    if (mustTogether.some(([a, b]) => pairKey(a, b) === key)) {
      setSeparateError('Already in "Must play together"')
      return
    }
    setSeparateError('')
    setMustSeparate(prev => [...prev, [separateP1, separateP2]])
    setSeparateP1('')
    setSeparateP2('')
  }

  const generate = async () => {
    setLoading(true)
    setError(null)
    setSolutions(null)
    try {
      const selectedPlayers = players.filter(p => selected.has(p.name))
      const res = await fetch(`${API_BASE}/api/generate-teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          players: selectedPlayers.map(({ name, play, run, goals }) => ({ name, play, run, goals })),
          num_players_per_team: numPerTeam,
          must_together: mustTogether,
          must_separate: mustSeparate,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Server error')
      }
      const data = await res.json()
      setSolutions(data)
      setTimeout(() => {
        document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' })
      }, 100)
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
        <input
          type="number"
          min={2}
          max={15}
          value={numPerTeam}
          onChange={e => setNumPerTeam(Math.max(2, Number(e.target.value)))}
        />
      </div>

      <div className="counter">
        <span className={canGenerate ? 'count good' : 'count'}>
          {selected.size} / {needed} selected
        </span>
        <span className="hint"> — {numPerTeam} per team</span>
      </div>

      <div className="player-grid">
        {players.map(p => {
          const isSelected = selected.has(p.name)
          const isDisabled = !isSelected && atLimit
          return (
            <button
              key={p.name}
              className={`player-btn${isSelected ? ' selected' : ''}${isDisabled ? ' limit-reached' : ''}`}
              onClick={() => togglePlayer(p.name)}
              disabled={isDisabled}
            >
              {p.name}
            </button>
          )
        })}
      </div>

      <ConstraintSection
        title="Must play together"
        pairs={mustTogether}
        onRemove={i => setMustTogether(prev => prev.filter((_, idx) => idx !== i))}
        p1={togetherP1} setP1={v => { setTogetherP1(v); setTogetherError('') }}
        p2={togetherP2} setP2={v => { setTogetherP2(v); setTogetherError('') }}
        onAdd={addTogether}
        names={selectedNames}
        error={togetherError}
      />

      <ConstraintSection
        title="Must be separated"
        pairs={mustSeparate}
        onRemove={i => setMustSeparate(prev => prev.filter((_, idx) => idx !== i))}
        p1={separateP1} setP1={v => { setSeparateP1(v); setSeparateError('') }}
        p2={separateP2} setP2={v => { setSeparateP2(v); setSeparateError('') }}
        onAdd={addSeparate}
        names={selectedNames}
        error={separateError}
      />

      {error && <div className="error">{error}</div>}

      <button
        className="generate-btn"
        onClick={generate}
        disabled={!canGenerate || loading}
      >
        {loading ? (
          <span className="loading-text">
            <span className="spinner" />
            Generating…
          </span>
        ) : (
          `Generate Teams ${canGenerate ? '' : `(${needed - selected.size} more needed)`}`
        )}
      </button>

      {solutions && (
        <div id="results" className="solutions">
          <h2 className="results-title">Results</h2>
          {solutions.map((sol, i) => (
            <SolutionCard key={i} solution={sol} index={i} />
          ))}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Enter Score tab
// ---------------------------------------------------------------------------

function ScoreForm({ players, tournaments }) {
  const [numPerTeam, setNumPerTeam] = useState(6)
  const [tournamentId, setTournamentId] = useState('')
  const [date, setDate] = useState(todayStr())
  const [team1, setTeam1] = useState(new Set())
  const [team2, setTeam2] = useState(new Set())
  const [result, setResult] = useState('')
  const [mvp, setMvp] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (tournaments.length > 0 && !tournamentId) {
      setTournamentId(String(tournaments[0].id))
    }
  }, [tournaments])

  const matchPlayers = [...team1, ...team2]

  const toggleTeam1 = (name) => {
    if (!team1.has(name) && team1.size >= numPerTeam) return
    setTeam1(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
        setTeam2(prev2 => { const n = new Set(prev2); n.delete(name); return n })
      }
      return next
    })
    if (mvp === name) setMvp('')
  }

  const toggleTeam2 = (name) => {
    if (!team2.has(name) && team2.size >= numPerTeam) return
    setTeam2(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
        setTeam1(prev2 => { const n = new Set(prev2); n.delete(name); return n })
      }
      return next
    })
    if (mvp === name) setMvp('')
  }

  const resetTeams = () => {
    setTeam1(new Set())
    setTeam2(new Set())
    setMvp('')
  }

  const canSubmit = tournamentId && date && team1.size > 0 && team2.size > 0 && result

  const submit = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/matches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournament_id: Number(tournamentId),
          played_at: date,
          team1_players: [...team1],
          team2_players: [...team2],
          result,
          mvp: mvp || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Server error')
      }
      setSuccess(true)
      resetTeams()
      setResult('')
      setDate(todayStr())
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
          Match recorded successfully!
          <button onClick={() => setSuccess(false)}>×</button>
        </div>
      )}

      <div className="config-row" style={{ marginBottom: 16 }}>
        <label>Players per team</label>
        <input
          type="number"
          min={1}
          max={15}
          value={numPerTeam}
          onChange={e => { setNumPerTeam(Math.max(1, Number(e.target.value))); resetTeams() }}
        />
      </div>

      <div className="form-field">
        <label>Tournament</label>
        <select value={tournamentId} onChange={e => setTournamentId(e.target.value)}>
          <option value="">Select tournament…</option>
          {tournaments.map(t => (
            <option key={t.id} value={t.id}>{t.name} — {t.season} {t.year}</option>
          ))}
        </select>
      </div>

      <div className="form-field">
        <label>Match date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>

      <div className="player-cols">
        <div className="player-col">
          <div className="col-label">Team 1 ({team1.size}/{numPerTeam})</div>
          {players.map(p => {
            const inT1 = team1.has(p.name)
            const inT2 = team2.has(p.name)
            const disabled = !inT1 && (inT2 || team1.size >= numPerTeam)
            return (
              <label
                key={p.name}
                className={`check-row${inT1 ? ' checked-t1' : inT2 ? ' in-other' : ''}${disabled ? ' check-disabled' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={inT1}
                  disabled={disabled}
                  onChange={() => toggleTeam1(p.name)}
                />
                {p.name}
              </label>
            )
          })}
        </div>
        <div className="player-col">
          <div className="col-label">Team 2 ({team2.size}/{numPerTeam})</div>
          {players.map(p => {
            const inT1 = team1.has(p.name)
            const inT2 = team2.has(p.name)
            const disabled = !inT2 && (inT1 || team2.size >= numPerTeam)
            return (
              <label
                key={p.name}
                className={`check-row${inT2 ? ' checked-t2' : inT1 ? ' in-other' : ''}${disabled ? ' check-disabled' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={inT2}
                  disabled={disabled}
                  onChange={() => toggleTeam2(p.name)}
                />
                {p.name}
              </label>
            )
          })}
        </div>
      </div>

      <div className="form-field">
        <label>Result</label>
        <div className="result-btns">
          {[
            { value: 'team1', label: 'Team 1 Won' },
            { value: 'draw',  label: 'Draw' },
            { value: 'team2', label: 'Team 2 Won' },
          ].map(opt => (
            <button
              key={opt.value}
              className={`result-btn${result === opt.value ? ' active' : ''}`}
              onClick={() => setResult(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-field">
        <label>MVP <span className="optional">(optional)</span></label>
        <select value={mvp} onChange={e => setMvp(e.target.value)} disabled={matchPlayers.length === 0}>
          <option value="">None</option>
          {matchPlayers.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>

      {error && <div className="error">{error}</div>}

      <button className="generate-btn" onClick={submit} disabled={!canSubmit || loading}>
        {loading ? (
          <span className="loading-text"><span className="spinner" />Saving…</span>
        ) : 'Save Match'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Standings tab
// ---------------------------------------------------------------------------

const MEDAL = ['🥇', '🥈', '🥉']
const RANK_CLASS = ['rank-gold', 'rank-silver', 'rank-bronze']

function StandingsTab({ tournaments }) {
  const [tournamentId, setTournamentId] = useState('')
  const [standings, setStandings] = useState(null)
  const [totalMatches, setTotalMatches] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = async (tid) => {
    if (!tid) { setStandings(null); setTotalMatches(0); return }
    setLoading(true)
    setError(null)
    try {
      const [sRes, mRes] = await Promise.all([
        fetch(`${API_BASE}/api/standings?tournament_id=${tid}`),
        fetch(`${API_BASE}/api/matches?tournament_id=${tid}`),
      ])
      if (!sRes.ok || !mRes.ok) throw new Error('Failed to load standings')
      const [sData, mData] = await Promise.all([sRes.json(), mRes.json()])
      setStandings(sData)
      setTotalMatches(mData.length)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    setTournamentId(e.target.value)
    load(e.target.value)
  }

  const presencePct = (matchesPlayed) =>
    totalMatches === 0 ? '—' : `${Math.round(matchesPlayed / totalMatches * 100)}%`

  return (
    <div className="standings-tab">
      <div className="form-field">
        <label>Tournament</label>
        <select value={tournamentId} onChange={handleChange}>
          <option value="">Select tournament…</option>
          {tournaments.map(t => (
            <option key={t.id} value={t.id}>{t.name} — {t.season} {t.year}</option>
          ))}
        </select>
      </div>

      {standings !== null && (
        <div className="standings-summary">
          {totalMatches} {totalMatches === 1 ? 'match' : 'matches'} played this tournament
        </div>
      )}

      {loading && <div className="status-msg">Loading standings…</div>}
      {error && <div className="error">{error}</div>}

      {standings && standings.length === 0 && (
        <div className="status-msg">No matches recorded yet for this tournament.</div>
      )}

      {standings && standings.length > 0 && (
        <div className="table-wrap">
          <table className="standings-table">
            <thead>
              <tr>
                <th>#</th>
                <th className="th-left">Player</th>
                <th title="Matches played">M</th>
                <th title="Wins">W</th>
                <th title="Draws">D</th>
                <th title="Losses">L</th>
                <th title="Effectivity">Eff</th>
                <th title="MVP awards">MVP</th>
                <th title="Presence %">Pres</th>
                <th title="Total score">Score</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, i) => (
                <tr key={row.player} className={RANK_CLASS[i] ?? ''}>
                  <td className="rank-cell">{i < 3 ? MEDAL[i] : i + 1}</td>
                  <td className="name-cell">{row.player}</td>
                  <td>{row.matches_played}</td>
                  <td>{row.wins}</td>
                  <td>{row.draws}</td>
                  <td>{row.losses}</td>
                  <td>{(row.effectivity * 100).toFixed(0)}%</td>
                  <td>{row.mvp_count}</td>
                  <td>{presencePct(row.matches_played)}</td>
                  <td className="score-cell">{row.total_score.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared subcomponents
// ---------------------------------------------------------------------------

function ConstraintSection({ title, pairs, onRemove, p1, setP1, p2, setP2, onAdd, names, error }) {
  return (
    <div className="constraint-section">
      <h3>{title}</h3>
      <div className="constraint-row">
        <select value={p1} onChange={e => setP1(e.target.value)}>
          <option value="">Player 1</option>
          {names.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={p2} onChange={e => setP2(e.target.value)}>
          <option value="">Player 2</option>
          {names.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <button className="add-btn" onClick={onAdd}>Add</button>
      </div>
      {error && <div className="constraint-error">{error}</div>}
      {pairs.length > 0 && (
        <div className="tags">
          {pairs.map(([a, b], i) => (
            <span key={i} className="tag">
              {a} &amp; {b}
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
          <div key={p.name} className="player-row">
            <span className="player-name">{p.name}</span>
            <span className="player-score">{p.score}</span>
          </div>
        ))}
      </div>
      <div className="team-total">
        <span>Total</span>
        <span className="total-value">{total}</span>
      </div>
    </div>
  )
}
