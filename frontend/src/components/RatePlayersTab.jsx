import { useState, useEffect } from 'react'

const DIMS = [
  { field: 'play',  label: 'Play',  desc: 'technical ability on the ball' },
  { field: 'run',   label: 'Run',   desc: 'athleticism, stamina and effort' },
  { field: 'goals', label: 'Goals', desc: 'scoring ability and finishing' },
]

export default function RatePlayersTab({ tournamentId, apiFetch }) {
  const [players, setPlayers] = useState([])
  const [ratings, setRatings] = useState({})
  const [currentIndex, setCurrentIndex] = useState(0)
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
      const map = {}
      for (const r of myRatings) {
        map[r.rated_id] = { play: r.play, run: r.run, goals: r.goals, skip: false }
      }
      for (const p of playerList) {
        if (!map[p.user_id]) map[p.user_id] = { play: 3, run: 3, goals: 3, skip: false }
      }
      const ratedIds = new Set(myRatings.map(r => r.rated_id))
      const sorted = [
        ...playerList.filter(p => !ratedIds.has(p.user_id)),
        ...playerList.filter(p => ratedIds.has(p.user_id)),
      ]
      setPlayers(sorted)
      setRatings(map)
    }).catch(() => setError('Failed to load players'))
      .finally(() => setLoading(false))
  }, [tournamentId])

  const update = (field, val) => {
    const uid = players[currentIndex]?.user_id
    if (!uid) return
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
  if (error && players.length === 0) return <div className="error" style={{ marginTop: 8 }}>{error}</div>

  const current = players[currentIndex]
  const currentRating = current ? ratings[current.user_id] : null
  const isFirst = currentIndex === 0
  const isLast = currentIndex >= players.length - 1

  return (
    <div className="rate-tab">

      {/* ── Info box ── */}
      <div className="rate-info-box">
        <div className="rate-info-title">How ratings work</div>
        <p className="rate-info-line">Rate each player from 1 (lowest) to 5 (highest).</p>
        <div className="rate-info-dims">
          {DIMS.map(({ label, desc }) => (
            <div key={label} className="rate-info-dim-row">
              <strong>{label}</strong> — {desc}
            </div>
          ))}
        </div>
        <p className="rate-info-line">
          Scores are averaged across everyone's ratings to balance teams. You can rate yourself, and skip players you haven't played with.
        </p>
      </div>

      {players.length === 0 && (
        <div className="empty-state">No players to rate yet.</div>
      )}

      {players.length > 0 && current && (
        <>
          {/* ── Progress ── */}
          <div className="rate-progress">
            Player {currentIndex + 1} of {players.length}
          </div>

          {/* ── Player card ── */}
          <div className={`rate-card${currentRating.skip ? ' rate-card-skipped' : ''}`}>
            <div className="rate-player-name">{current.display_name ?? current.user_id}</div>

            {DIMS.map(({ field, label }) => (
              <div key={field} className="rate-dimension">
                <div className="rate-dim-label">{label}</div>
                <div className="rate-pip-row">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      className={`rate-pip${currentRating[field] === n && !currentRating.skip ? ' rate-pip-active' : ''}`}
                      onClick={() => update(field, n)}
                      disabled={currentRating.skip}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <label className="rate-skip-label">
              <input
                type="checkbox"
                checked={currentRating.skip}
                onChange={e => update('skip', e.target.checked)}
              />
              Skip this player
            </label>
          </div>

          {/* ── Navigation ── */}
          <div className="rate-nav">
            <button
              className="rate-nav-btn"
              onClick={() => setCurrentIndex(i => i - 1)}
              disabled={isFirst}
            >
              ← Previous
            </button>
            <button
              className="rate-nav-btn rate-nav-next"
              onClick={() => setCurrentIndex(i => i + 1)}
              disabled={isLast}
            >
              Next →
            </button>
          </div>

          {isLast && (
            <div className="rate-done-msg">
              You've rated everyone! Don't forget to save.
            </div>
          )}
        </>
      )}

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
