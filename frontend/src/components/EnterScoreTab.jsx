import { useState, useEffect } from 'react'

const todayStr = () => new Date().toISOString().slice(0, 10)

const RESULT_LABELS = { team1: 'Team 1 Won', draw: 'Draw', team2: 'Team 2 Won' }

function ManualForm({ tournamentId, apiFetch, players, onSuccess }) {
  const [numPerTeam, setNumPerTeam] = useState(6)
  const [date, setDate] = useState(todayStr())
  const [team1, setTeam1] = useState(new Set())
  const [team2, setTeam2] = useState(new Set())
  const [result, setResult] = useState('')
  const [mvp, setMvp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [guests, setGuests] = useState([])
  const [guestName, setGuestName] = useState('')
  const [guestLoading, setGuestLoading] = useState(false)
  const [guestError, setGuestError] = useState(null)

  useEffect(() => {
    apiFetch(`/api/tournaments/${tournamentId}/guests`)
      .then(r => r.json())
      .then(data => setGuests(data.map(g => ({ user_id: g.id, display_name: g.name, is_guest: true }))))
      .catch(() => {})
  }, [tournamentId])

  const selectable = [...players, ...guests]

  const addGuest = async () => {
    const name = guestName.trim()
    if (!name) return
    setGuestLoading(true); setGuestError(null)
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/guests`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Server error') }
      const g = await res.json()
      setGuests(prev => [...prev, { user_id: g.id, display_name: g.name, is_guest: true }])
      setGuestName('')
    } catch (e) {
      setGuestError(e.message)
    } finally {
      setGuestLoading(false)
    }
  }

  const toggleTeam1 = id => {
    if (!team1.has(id) && team1.size >= numPerTeam) return
    setTeam1(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) }
      else { next.add(id); setTeam2(p => { const n = new Set(p); n.delete(id); return n }) }
      return next
    })
  }

  const toggleTeam2 = id => {
    if (!team2.has(id) && team2.size >= numPerTeam) return
    setTeam2(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) }
      else { next.add(id); setTeam1(p => { const n = new Set(p); n.delete(id); return n }) }
      return next
    })
  }

  const reset = () => { setTeam1(new Set()); setTeam2(new Set()) }

  const chooseResult = val => { setResult(val); setMvp('') }

  const winningPlayers = result === 'team1' ? [...team1] : result === 'team2' ? [...team2] : []
  const mvpCandidates = winningPlayers
    .map(id => selectable.find(p => p.user_id === id))
    .filter(Boolean)

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
      reset(); setResult(''); setMvp(''); setDate(todayStr())
      onSuccess()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
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
          {selectable.map(p => {
            const inT1 = team1.has(p.user_id), inT2 = team2.has(p.user_id)
            const dis = !inT1 && (inT2 || team1.size >= numPerTeam)
            return (
              <label key={p.user_id}
                className={`check-row${inT1 ? ' checked-t1' : inT2 ? ' in-other' : ''}${dis ? ' check-disabled' : ''}`}>
                <input type="checkbox" checked={inT1} disabled={dis}
                  onChange={() => toggleTeam1(p.user_id)} />
                {(p.display_name ?? p.user_id) + (p.is_guest ? ' (guest)' : '')}
              </label>
            )
          })}
        </div>
        <div className="player-col">
          <div className="col-label">Team 2 ({team2.size}/{numPerTeam})</div>
          {selectable.map(p => {
            const inT1 = team1.has(p.user_id), inT2 = team2.has(p.user_id)
            const dis = !inT2 && (inT1 || team2.size >= numPerTeam)
            return (
              <label key={p.user_id}
                className={`check-row${inT2 ? ' checked-t2' : inT1 ? ' in-other' : ''}${dis ? ' check-disabled' : ''}`}>
                <input type="checkbox" checked={inT2} disabled={dis}
                  onChange={() => toggleTeam2(p.user_id)} />
                {(p.display_name ?? p.user_id) + (p.is_guest ? ' (guest)' : '')}
              </label>
            )
          })}
        </div>
      </div>

      <div className="form-field">
        <label>Add guest player</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" placeholder="Guest name" value={guestName}
            onChange={e => setGuestName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGuest() } }} />
          <button type="button" className="result-btn" onClick={addGuest} disabled={guestLoading || !guestName.trim()}>
            {guestLoading ? '…' : '+ Add guest'}
          </button>
        </div>
        {guestError && <div className="error">{guestError}</div>}
      </div>

      <div className="form-field">
        <label>Result</label>
        <div className="result-btns">
          {Object.entries(RESULT_LABELS).map(([val, label]) => (
            <button key={val} className={`result-btn${result === val ? ' active' : ''}`}
              onClick={() => chooseResult(val)}>{label}</button>
          ))}
        </div>
      </div>

      {(result === 'team1' || result === 'team2') && (
        <div className="form-field">
          <label>MVP (optional)</label>
          <select value={mvp} onChange={e => setMvp(e.target.value)}>
            <option value="">— No MVP (open poll) —</option>
            {mvpCandidates.map(p => (
              <option key={p.user_id} value={p.user_id}>
                {(p.display_name ?? p.user_id) + (p.is_guest ? ' (guest)' : '')}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <button className="generate-btn"
        onClick={submit}
        disabled={!(date && team1.size > 0 && team2.size > 0 && result) || loading}>
        {loading ? <span className="loading-text"><span className="spinner" />Saving…</span> : 'Save Match'}
      </button>
    </>
  )
}

function FromMatchForm({ tournamentId, apiFetch, players, initialMatch, onSuccess }) {
  const [eligibleMatches, setEligibleMatches] = useState(null)
  const [selectedMatchId, setSelectedMatchId] = useState(initialMatch?.id ?? '')
  const [result, setResult] = useState('')
  const [mvp, setMvp] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch(`/api/tournaments/${tournamentId}/scheduled-matches`)
      .then(r => r.json())
      .then(data => {
        // Only matches with teams saved and no result yet
        setEligibleMatches(data.filter(m => (m.team1?.length > 0 || m.team2?.length > 0) && !m.result_match_id))
      })
      .catch(() => setFetchError('Failed to load matches'))
  }, [tournamentId])

  const selectedMatch = eligibleMatches?.find(m => m.id === Number(selectedMatchId)) ?? initialMatch ?? null

  const chooseResult = val => { setResult(val); setMvp('') }

  const winningPlayers = result === 'team1' ? (selectedMatch?.team1 ?? [])
    : result === 'team2' ? (selectedMatch?.team2 ?? [])
    : []

  const submit = async () => {
    if (!selectedMatch || !result) return
    setLoading(true); setError(null)
    try {
      const playedAt = selectedMatch.scheduled_at.slice(0, 10)
      const res = await apiFetch(`/api/tournaments/${tournamentId}/matches`, {
        method: 'POST',
        body: JSON.stringify({
          played_at: playedAt,
          team1_players: (selectedMatch.team1 ?? []).map(p => p.user_id),
          team2_players: (selectedMatch.team2 ?? []).map(p => p.user_id),
          result,
          mvp: mvp || null,
          scheduled_match_id: selectedMatch.id,
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Server error') }
      setMvp('')
      onSuccess()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (fetchError) return <div className="error">{fetchError}</div>
  if (!eligibleMatches) return <div className="status-msg">Loading matches…</div>

  if (eligibleMatches.length === 0 && !initialMatch) {
    return (
      <div className="status-msg">
        No confirmed matches with saved teams found.<br />
        <span style={{ fontSize: '0.82rem' }}>Set up teams on a confirmed match first.</span>
      </div>
    )
  }

  return (
    <>
      {!initialMatch && (
        <div className="form-field">
          <label>Match</label>
          <select value={selectedMatchId} onChange={e => { setSelectedMatchId(e.target.value); setResult(''); setMvp('') }}>
            <option value="">Select a match…</option>
            {eligibleMatches.map(m => {
              const d = new Date(m.scheduled_at)
              const label = `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}${m.location ? ' — ' + m.location : ''}`
              return <option key={m.id} value={m.id}>{label}</option>
            })}
          </select>
        </div>
      )}

      {selectedMatch && (
        <>
          <div className="match-teams" style={{ marginBottom: 16 }}>
            <div className="match-team-side">
              <div className="match-team-label">Team 1</div>
              {(selectedMatch.team1 ?? []).map(p => (
                <div key={p.user_id} className="match-team-player">{p.display_name ?? p.user_id}</div>
              ))}
            </div>
            <div className="match-team-divider" />
            <div className="match-team-side">
              <div className="match-team-label">Team 2</div>
              {(selectedMatch.team2 ?? []).map(p => (
                <div key={p.user_id} className="match-team-player">{p.display_name ?? p.user_id}</div>
              ))}
            </div>
          </div>

          <div className="form-field">
            <label>Result</label>
            <div className="result-btns">
              {Object.entries(RESULT_LABELS).map(([val, label]) => (
                <button key={val} className={`result-btn${result === val ? ' active' : ''}`}
                  onClick={() => chooseResult(val)}>{label}</button>
              ))}
            </div>
          </div>

          {(result === 'team1' || result === 'team2') && (
            <div className="form-field">
              <label>MVP (optional)</label>
              <select value={mvp} onChange={e => setMvp(e.target.value)}>
                <option value="">— No MVP (open poll) —</option>
                {winningPlayers.map(p => (
                  <option key={p.user_id} value={p.user_id}>{p.display_name ?? p.user_id}</option>
                ))}
              </select>
            </div>
          )}

          {error && <div className="error">{error}</div>}

          <button className="generate-btn"
            onClick={submit}
            disabled={!result || loading}>
            {loading ? <span className="loading-text"><span className="spinner" />Saving…</span> : 'Save Result'}
          </button>
        </>
      )}
    </>
  )
}

export default function EnterScoreTab({ tournamentId, apiFetch, players, fromScheduledMatch }) {
  const [mode, setMode] = useState(fromScheduledMatch ? 'match' : 'manual')
  const [success, setSuccess] = useState(false)

  return (
    <div className="score-form">
      {success && (
        <div className="success-msg">
          Match recorded! <button onClick={() => setSuccess(false)}>×</button>
        </div>
      )}

      <div className="result-btns" style={{ marginBottom: 20 }}>
        <button className={`result-btn${mode === 'match' ? ' active' : ''}`}
          onClick={() => { setMode('match'); setSuccess(false) }}>
          From a Match
        </button>
        <button className={`result-btn${mode === 'manual' ? ' active' : ''}`}
          onClick={() => { setMode('manual'); setSuccess(false) }}>
          Manual
        </button>
      </div>

      {mode === 'match' ? (
        <FromMatchForm
          tournamentId={tournamentId}
          apiFetch={apiFetch}
          players={players}
          initialMatch={fromScheduledMatch}
          onSuccess={() => setSuccess(true)}
        />
      ) : (
        <ManualForm
          tournamentId={tournamentId}
          apiFetch={apiFetch}
          players={players}
          onSuccess={() => setSuccess(true)}
        />
      )}
    </div>
  )
}
