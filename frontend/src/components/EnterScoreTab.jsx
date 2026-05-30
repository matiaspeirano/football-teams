import { useState } from 'react'

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function EnterScoreTab({ tournamentId, apiFetch, players }) {
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
