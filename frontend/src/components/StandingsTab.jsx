import { useState, useEffect } from 'react'

const MEDAL = ['🥇', '🥈', '🥉']
const RANK_CLASS = ['rank-gold', 'rank-silver', 'rank-bronze']

export default function StandingsTab({ tournamentId, apiFetch }) {
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
