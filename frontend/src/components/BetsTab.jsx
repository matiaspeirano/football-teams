import { useState, useEffect, useCallback } from 'react'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ODDS_OPTIONS = ['1:1', '1:2', '1:3', '2:1']

function fmtDate(iso) {
  if (!iso) return '?'
  const d = new Date(iso)
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

function winAmt(stake, oddsRatio) {
  if (!oddsRatio || !stake) return 0
  const [a, b] = oddsRatio.split(':').map(Number)
  return +(stake * b / a).toFixed(2)
}

const fmt = n => `$${Number(n).toFixed(2)}`

const STATUS_LABEL = {
  open: 'Open',
  accepted: 'Active',
  settled: 'Settled',
  void: 'Voided',
  cancelled: 'Cancelled',
}

// ─── Bet Card ──────────────────────────────────────────────────────────────────

function BetCard({ bet, userId, myRole, onAction, loading }) {
  const isCreator = bet.creator_id === userId
  const isCreditor = bet.creditor_id === userId
  const canMarkPaid = isCreditor || myRole === 'admin'
  const predictedLabel = bet.predicted_winner === 'team1' ? 'Team 1' : 'Team 2'
  const win = winAmt(bet.stake, bet.odds_ratio)

  const statusColor =
    bet.status === 'accepted' ? 'var(--green)' :
    bet.status === 'settled'  ? (bet.paid ? 'var(--green)' : '#fbbf24') :
    bet.status === 'open'     ? 'var(--text-dim)' :
    'var(--text-muted)'

  const isDim = bet.status === 'void' || bet.status === 'cancelled'

  return (
    <div className={`bet-card${isDim ? ' bet-card-dim' : ''}${bet.paid ? ' bet-card-paid' : ''}`}>
      <div className="bet-card-header">
        <span className="bet-match-label">{fmtDate(bet.match_scheduled_at)}</span>
        <span className="bet-status-badge" style={{ color: statusColor }}>
          {STATUS_LABEL[bet.status] ?? bet.status}
          {bet.status === 'settled' && bet.paid ? ' · Paid' : ''}
        </span>
      </div>

      <div className="bet-terms-row">
        <strong>{bet.creator_name ?? 'Unknown'}</strong>{' '}
        bets {fmt(bet.stake)} on <strong>{predictedLabel}</strong>{' '}
        at <span className="bet-odds">{bet.odds_ratio}</span>
      </div>

      {bet.acceptor_name && (
        <div className="bet-secondary-row">
          Accepted by <strong>{bet.acceptor_name}</strong>
        </div>
      )}

      {(bet.status === 'open' || bet.status === 'accepted') && (
        <div className="bet-payout-hint">
          Win → collect {fmt(win)} · Lose → pay {fmt(bet.stake)}
        </div>
      )}

      {bet.status === 'settled' && bet.debtor_name && (
        <div className={`bet-owed-row${bet.paid ? ' bet-owed-paid' : ''}`}>
          <span>
            <strong>{bet.debtor_name}</strong> owes <strong>{bet.creditor_name}</strong>
          </span>
          <span className="bet-owed-amount">{fmt(bet.amount_owed)}</span>
        </div>
      )}

      {bet.status === 'void' && (
        <div className="bet-void-msg">
          {!bet.acceptor_id
            ? 'Voided — no taker before match was played'
            : 'Voided — match ended in a draw'}
        </div>
      )}

      <div className="bet-actions">
        {bet.status === 'open' && !isCreator && (
          <button className="add-btn" style={{ flex: 1, padding: 8 }}
            onClick={() => onAction('accept', bet.id)} disabled={loading}>
            {loading ? 'Accepting…' : 'Accept Bet'}
          </button>
        )}
        {bet.status === 'open' && isCreator && (
          <button className="cancel-match-btn"
            onClick={() => onAction('cancel', bet.id)} disabled={loading}>
            {loading ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
        {bet.status === 'settled' && !bet.paid && canMarkPaid && (
          <button className="add-btn" style={{ flex: 1, padding: 8 }}
            onClick={() => onAction('mark-paid', bet.id)} disabled={loading}>
            {loading ? 'Marking…' : 'Mark as Paid'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── BetsTab ───────────────────────────────────────────────────────────────────

export default function BetsTab({ tournamentId, apiFetch, userId, myRole }) {
  const [bets, setBets] = useState(null)
  const [matches, setMatches] = useState([])
  const [settleUp, setSettleUp] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState({})
  const [actionError, setActionError] = useState(null)

  const [showForm, setShowForm] = useState(false)
  const [matchId, setMatchId] = useState('')
  const [winner, setWinner] = useState(null)
  const [stake, setStake] = useState('')
  const [odds, setOdds] = useState('1:1')
  const [formError, setFormError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const loadBets = useCallback(async () => {
    try {
      const [betsRes, suRes] = await Promise.all([
        apiFetch(`/api/tournaments/${tournamentId}/bets`),
        apiFetch(`/api/tournaments/${tournamentId}/settle-up`),
      ])
      if (betsRes.ok) setBets(await betsRes.json())
      if (suRes.ok) setSettleUp(await suRes.json())
    } catch {
      setError('Failed to load bets')
    } finally {
      setLoading(false)
    }
  }, [tournamentId, apiFetch])

  const loadMatches = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/scheduled-matches`)
      if (res.ok) setMatches(await res.json())
    } catch {}
  }, [tournamentId, apiFetch])

  useEffect(() => { loadBets(); loadMatches() }, [loadBets, loadMatches])

  const eligibleMatches = matches.filter(m =>
    m.status !== 'played' && m.status !== 'cancelled' &&
    m.team1?.length > 0 && m.team2?.length > 0
  )

  const selectedMatch = eligibleMatches.find(m => m.id === Number(matchId))

  const preview = stake && Number(stake) > 0
    ? { win: winAmt(Number(stake), odds), lose: Number(stake) }
    : null

  const submitBet = async () => {
    if (!matchId || !winner || !stake || Number(stake) <= 0) {
      setFormError('Select a match, pick a winner, and enter a stake amount.')
      return
    }
    setSubmitting(true); setFormError(null)
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/bets`, {
        method: 'POST',
        body: JSON.stringify({
          scheduled_match_id: Number(matchId),
          predicted_winner: winner,
          stake: Number(stake),
          odds_ratio: odds,
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed to place bet') }
      setShowForm(false)
      setMatchId(''); setWinner(null); setStake(''); setOdds('1:1')
      loadBets()
    } catch (e) {
      setFormError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const doAction = async (action, betId) => {
    if (action === 'cancel' && !window.confirm('Cancel this bet?')) return
    if (action === 'mark-paid' && !window.confirm('Mark this debt as paid? This confirms the money was settled.')) return
    setActionLoading(prev => ({ ...prev, [betId]: true }))
    setActionError(null)
    try {
      const res = await apiFetch(`/api/bets/${betId}/${action}`, { method: 'POST' })
      if (!res.ok) {
        const e = await res.json()
        setActionError(e.detail || `Failed to ${action.replace('-', ' ')}`)
      } else {
        loadBets()
      }
    } catch {
      setActionError(`Failed to ${action.replace('-', ' ')}`)
    } finally {
      setActionLoading(prev => { const n = { ...prev }; delete n[betId]; return n })
    }
  }

  const openBets = (bets ?? []).filter(b => b.status === 'open')
  const activeBets = (bets ?? []).filter(b => b.status === 'accepted')
  const settledBets = (bets ?? []).filter(b => b.status === 'settled')
  const pastBets = (bets ?? []).filter(b => b.status === 'void' || b.status === 'cancelled')

  return (
    <div>
      {/* ── Disclaimer ── */}
      <div className="bets-disclaimer">
        <strong>Ledger only</strong> — no money passes through this app. Settle debts among
        yourselves. A bet is voided if the match ends in a draw.
      </div>

      {/* ── Place a Bet ── */}
      <div style={{ marginBottom: 16 }}>
        {!showForm ? (
          <button className="add-btn" onClick={() => setShowForm(true)}
            style={{ width: '100%', padding: 11, fontSize: '0.9rem' }}>
            + Place a Bet
          </button>
        ) : (
          <div className="constraint-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>Place a Bet</h3>
              <button onClick={() => { setShowForm(false); setFormError(null) }}
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, padding: 0 }}>
                ×
              </button>
            </div>

            <div className="form-field">
              <label>Match</label>
              <select value={matchId} onChange={e => { setMatchId(e.target.value); setWinner(null) }}>
                <option value="">Choose a match…</option>
                {eligibleMatches.map(m => (
                  <option key={m.id} value={m.id}>
                    {fmtDate(m.scheduled_at)}{m.location ? ` · ${m.location}` : ''}
                  </option>
                ))}
              </select>
              {eligibleMatches.length === 0 && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  No eligible matches — teams must be saved before placing a bet.
                </div>
              )}
            </div>

            {selectedMatch && (
              <div className="bet-team-preview">
                <div className="bet-team-preview-col">
                  <div className="bet-team-preview-label">Team 1</div>
                  {selectedMatch.team1.map(p => (
                    <div key={p.user_id} className="bet-team-preview-player">{p.display_name ?? p.user_id}</div>
                  ))}
                </div>
                <div className="bet-team-preview-vs">vs</div>
                <div className="bet-team-preview-col">
                  <div className="bet-team-preview-label">Team 2</div>
                  {selectedMatch.team2.map(p => (
                    <div key={p.user_id} className="bet-team-preview-player">{p.display_name ?? p.user_id}</div>
                  ))}
                </div>
              </div>
            )}

            {selectedMatch && (
              <>
                <div className="form-field">
                  <label>Predicted Winner</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['team1', 'team2'].map(t => (
                      <button key={t}
                        className={`result-btn${winner === t ? ' active' : ''}`}
                        style={{ flex: 1 }}
                        onClick={() => setWinner(t)}>
                        {t === 'team1' ? 'Team 1' : 'Team 2'}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div className="form-field">
                    <label>Stake</label>
                    <input type="number" min="1" step="any" placeholder="0"
                      value={stake} onChange={e => setStake(e.target.value)} />
                  </div>
                  <div className="form-field">
                    <label>Odds</label>
                    <select value={odds} onChange={e => setOdds(e.target.value)}>
                      {ODDS_OPTIONS.map(o => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {preview && (
                  <div className="bet-odds-preview">
                    Win → collect {fmt(preview.win)} &nbsp;·&nbsp; Lose → pay {fmt(preview.lose)}
                  </div>
                )}

                {formError && <div className="error">{formError}</div>}

                <button className="add-btn" onClick={submitBet}
                  disabled={submitting || !winner || !stake || Number(stake) <= 0}
                  style={{ width: '100%', padding: 10 }}>
                  {submitting ? 'Placing…' : 'Place Bet'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {loading && <div className="status-msg">Loading bets…</div>}
      {error && <div className="error">{error}</div>}
      {actionError && (
        <div className="error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{actionError}</span>
          <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.1rem' }}
            onClick={() => setActionError(null)}>×</button>
        </div>
      )}

      {/* ── Settle-Up summary ── */}
      {settleUp.length > 0 && (
        <div className="bets-settle-up">
          <div className="bets-section-label" style={{ marginBottom: 10 }}>Settle Up</div>
          {settleUp.map((s, i) => (
            <div key={i} className="settle-up-row">
              <span><strong>{s.debtor_name}</strong> owes <strong>{s.creditor_name}</strong></span>
              <span className="settle-up-amount">{fmt(s.net_amount)}</span>
            </div>
          ))}
        </div>
      )}
      {settleUp.length === 0 && settledBets.length > 0 && !loading && (
        <div className="empty-state" style={{ borderColor: 'rgba(74,222,128,0.2)', marginBottom: 20 }}>
          All settled up — no outstanding debts.
        </div>
      )}

      {bets !== null && (
        <>
          {openBets.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div className="bets-section-label">Open Bets</div>
              {openBets.map(b => (
                <BetCard key={b.id} bet={b} userId={userId} myRole={myRole}
                  onAction={doAction} loading={!!actionLoading[b.id]} />
              ))}
            </div>
          )}

          {activeBets.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div className="bets-section-label">Active Bets</div>
              {activeBets.map(b => (
                <BetCard key={b.id} bet={b} userId={userId} myRole={myRole}
                  onAction={doAction} loading={!!actionLoading[b.id]} />
              ))}
            </div>
          )}

          {settledBets.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div className="bets-section-label">Settled / Owed</div>
              {settledBets.map(b => (
                <BetCard key={b.id} bet={b} userId={userId} myRole={myRole}
                  onAction={doAction} loading={!!actionLoading[b.id]} />
              ))}
            </div>
          )}

          {bets.length === 0 && !loading && (
            <div className="empty-state">
              No bets yet. Place one on an upcoming match with teams.
            </div>
          )}

          {pastBets.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div className="bets-section-label" style={{ color: 'var(--text-muted)' }}>
                Void / Cancelled
              </div>
              {pastBets.map(b => (
                <BetCard key={b.id} bet={b} userId={userId} myRole={myRole}
                  onAction={doAction} loading={!!actionLoading[b.id]} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
