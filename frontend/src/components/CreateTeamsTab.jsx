import { useState, useEffect } from 'react'

const pairKey = (a, b) => [a, b].sort().join('|')

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

export default function CreateTeamsTab({ tournamentId, apiFetch, preselectedIds }) {
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
