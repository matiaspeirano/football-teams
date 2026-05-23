import { useState, useEffect } from 'react'
import './App.css'

const API_BASE = import.meta.env.PROD
  ? 'https://football-teams-backend.onrender.com'
  : ''

export default function App() {
  const [players, setPlayers] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [numPerTeam, setNumPerTeam] = useState(6)
  const [mustTogether, setMustTogether] = useState([])
  const [mustSeparate, setMustSeparate] = useState([])
  const [togetherP1, setTogetherP1] = useState('')
  const [togetherP2, setTogetherP2] = useState('')
  const [separateP1, setSeparateP1] = useState('')
  const [separateP2, setSeparateP2] = useState('')
  const [solutions, setSolutions] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [fetchError, setFetchError] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/players`)
      .then(r => r.json())
      .then(data => setPlayers(data))
      .catch(() => setFetchError('Could not load players. Is the backend running?'))
  }, [])

  const togglePlayer = (name) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const needed = numPerTeam * 2
  const canGenerate = selected.size === needed
  const selectedNames = players.filter(p => selected.has(p.name)).map(p => p.name)

  const addTogether = () => {
    if (!togetherP1 || !togetherP2 || togetherP1 === togetherP2) return
    setMustTogether(prev => [...prev, [togetherP1, togetherP2]])
    setTogetherP1('')
    setTogetherP2('')
  }

  const addSeparate = () => {
    if (!separateP1 || !separateP2 || separateP1 === separateP2) return
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

  if (fetchError) {
    return (
      <div className="app">
        <h1>⚽ Team Generator</h1>
        <div className="error">{fetchError}</div>
      </div>
    )
  }

  return (
    <div className="app">
      <h1>⚽ Team Generator</h1>

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
        <span className={selected.size === needed ? 'count good' : 'count'}>
          {selected.size} selected
        </span>
        <span className="hint"> — need {needed} for 2 teams of {numPerTeam}</span>
      </div>

      <div className="player-grid">
        {players.map(p => (
          <button
            key={p.name}
            className={`player-btn${selected.has(p.name) ? ' selected' : ''}`}
            onClick={() => togglePlayer(p.name)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <ConstraintSection
        title="Must play together"
        pairs={mustTogether}
        onRemove={i => setMustTogether(prev => prev.filter((_, idx) => idx !== i))}
        p1={togetherP1} setP1={setTogetherP1}
        p2={togetherP2} setP2={setTogetherP2}
        onAdd={addTogether}
        names={selectedNames}
      />

      <ConstraintSection
        title="Must be separated"
        pairs={mustSeparate}
        onRemove={i => setMustSeparate(prev => prev.filter((_, idx) => idx !== i))}
        p1={separateP1} setP1={setSeparateP1}
        p2={separateP2} setP2={setSeparateP2}
        onAdd={addSeparate}
        names={selectedNames}
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
    </div>
  )
}

function ConstraintSection({ title, pairs, onRemove, p1, setP1, p2, setP2, onAdd, names }) {
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
