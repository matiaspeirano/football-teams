import random
import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

import pulp
from dateutil.parser import parse as parse_date
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import supabase
from auth import get_required_user
import scoring as sc

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class TournamentCreate(BaseModel):
    name: str
    year: int
    season: str


class RatingItem(BaseModel):
    rated_id: str
    play: int
    run: int
    goals: int


class MatchCreate(BaseModel):
    played_at: str
    team1_players: list[str]
    team2_players: list[str]
    result: str
    mvp: Optional[str] = None
    scheduled_match_id: Optional[int] = None


class GenerateTeamsRequest(BaseModel):
    num_players_per_team: int
    selected_player_ids: list[str]
    must_together: list[list[str]] = []
    must_separate: list[list[str]] = []


class InviteCreate(BaseModel):
    role: str


class InviteAccept(BaseModel):
    token: str


class ProfileUpdate(BaseModel):
    display_name: str
    phone: Optional[str] = None


class ScheduledMatchCreate(BaseModel):
    scheduled_at: str
    location: str
    players_needed: int


class RSVPCreate(BaseModel):
    status: str  # 'in' or 'out'


class ScheduledMatchStatusUpdate(BaseModel):
    status: str  # 'open', 'confirmed', 'cancelled', 'played'


class TournamentUpdate(BaseModel):
    name: str
    year: int
    season: str


class PlayerRoleUpdate(BaseModel):
    role: str  # 'admin' or 'player'


class TeamsUpdate(BaseModel):
    team1_players: list[str]
    team2_players: list[str]


class VoteMVP(BaseModel):
    voted_for_id: str


class BetCreate(BaseModel):
    scheduled_match_id: int
    predicted_winner: str  # 'team1' or 'team2'
    stake: float
    odds_ratio: str  # '1:1', '1:2', '1:3', '2:1'


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _averaged_ratings(tournament_id: int) -> dict[str, dict]:
    """Returns avg play/run/goals per rated_id for a given tournament."""
    res = supabase.table("player_ratings").select("rated_id,play,run,goals").eq("tournament_id", tournament_id).execute()
    buckets: dict[str, list] = defaultdict(list)
    for r in res.data:
        buckets[r["rated_id"]].append(r)
    out = {}
    for uid, ratings in buckets.items():
        n = len(ratings)
        out[uid] = {
            "avg_play":  sum(r["play"]  for r in ratings) / n,
            "avg_run":   sum(r["run"]   for r in ratings) / n,
            "avg_goals": sum(r["goals"] for r in ratings) / n,
            "ratings_count": n,
        }
    return out


def _display_names(user_ids: list[str]) -> dict[str, Optional[str]]:
    if not user_ids:
        return {}
    res = supabase.table("profiles").select("id,display_name").in_("id", user_ids).execute()
    return {p["id"]: p.get("display_name") for p in res.data}


def _require_admin(tournament_id: int, user_id: str) -> None:
    res = supabase.table("tournament_players").select("role").eq("tournament_id", tournament_id).eq("user_id", user_id).execute()
    if not res.data or res.data[0]["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


def _is_admin(tournament_id: int, user_id: str) -> bool:
    res = supabase.table("tournament_players").select("role").eq("tournament_id", tournament_id).eq("user_id", user_id).execute()
    return bool(res.data) and res.data[0]["role"] == "admin"


def _compute_creator_winnings(stake: float, odds_ratio: str) -> float:
    """Amount the acceptor owes the creator when the creator wins (stake × B/A for ratio A:B)."""
    a, b = odds_ratio.split(":")
    return float(stake) * int(b) / int(a)


def close_expired_mvp_polls() -> None:
    """Close any MVP polls open for more than 24 hours. Called lazily on relevant reads."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    open_res = supabase.table("matches").select(
        "id,result,team1_players,team2_players"
    ).eq("mvp_poll_status", "open").lt("mvp_poll_opened_at", cutoff).execute()

    for match in open_res.data:
        match_id = match["id"]
        result = match.get("result")

        if result == "team1":
            winning_team = match.get("team1_players") or []
        elif result == "team2":
            winning_team = match.get("team2_players") or []
        else:
            supabase.table("matches").update(
                {"mvp_poll_status": "closed", "mvp_winners": []}
            ).eq("id", match_id).execute()
            continue

        votes_res = supabase.table("mvp_votes").select("voted_for_id").eq("match_id", match_id).execute()

        if not votes_res.data:
            supabase.table("matches").update(
                {"mvp_poll_status": "closed", "mvp_winners": []}
            ).eq("id", match_id).execute()
            continue

        tally: dict[str, int] = defaultdict(int)
        for vote in votes_res.data:
            tally[vote["voted_for_id"]] += 1

        max_votes = max(tally.values())
        winners = [pid for pid, count in tally.items() if count == max_votes]

        supabase.table("matches").update(
            {"mvp_poll_status": "closed", "mvp_winners": winners}
        ).eq("id", match_id).execute()


def _settle_bets_for_match(scheduled_match_id: int, match_result: str) -> None:
    """Settle all open/accepted bets on a scheduled match after the result is recorded."""
    now = datetime.now(timezone.utc).isoformat()
    bets_res = supabase.table("bets").select("*").eq("scheduled_match_id", scheduled_match_id).in_("status", ["open", "accepted"]).execute()
    for bet in bets_res.data:
        if bet["status"] == "open":
            supabase.table("bets").update({"status": "void", "outcome": "void", "settled_at": now}).eq("id", bet["id"]).execute()
            continue
        # accepted bet
        if match_result == "draw":
            supabase.table("bets").update({"status": "void", "outcome": "void", "settled_at": now}).eq("id", bet["id"]).execute()
            continue
        creator_won = bet["predicted_winner"] == match_result
        if creator_won:
            amount_owed = _compute_creator_winnings(bet["stake"], bet["odds_ratio"])
            supabase.table("bets").update({
                "status": "settled", "outcome": "creator_won",
                "debtor_id": bet["acceptor_id"], "creditor_id": bet["creator_id"],
                "amount_owed": amount_owed, "settled_at": now,
            }).eq("id", bet["id"]).execute()
        else:
            supabase.table("bets").update({
                "status": "settled", "outcome": "acceptor_won",
                "debtor_id": bet["creator_id"], "creditor_id": bet["acceptor_id"],
                "amount_owed": float(bet["stake"]), "settled_at": now,
            }).eq("id", bet["id"]).execute()


# ---------------------------------------------------------------------------
# LP team generation
# ---------------------------------------------------------------------------

def _optimize_once(players: list[dict], randomization_level: float, num_per_team: int,
                   must_together: list[list[str]], must_separate: list[list[str]]) -> dict:
    n = len(players)
    id_to_idx = {p["id"]: i for i, p in enumerate(players)}

    noisy_scores = {
        i: max(0.1, p["score"] + random.uniform(-randomization_level, randomization_level))
        for i, p in enumerate(players)
    }

    model = pulp.LpProblem("TeamBalancing", pulp.LpMinimize)
    x = pulp.LpVariable.dicts("x", range(n), cat="Binary")
    d = pulp.LpVariable("difference", lowBound=0)

    t1 = pulp.lpSum(noisy_scores[i] * x[i] for i in range(n))
    t2 = pulp.lpSum(noisy_scores[i] * (1 - x[i]) for i in range(n))

    model += d
    model += t1 - t2 <= d
    model += t2 - t1 <= d
    model += pulp.lpSum(x[i] for i in range(n)) == num_per_team

    for p1_id, p2_id in must_together:
        if p1_id not in id_to_idx or p2_id not in id_to_idx:
            raise ValueError(f"Unknown player in must_together: {p1_id}, {p2_id}")
        model += x[id_to_idx[p1_id]] == x[id_to_idx[p2_id]]

    for p1_id, p2_id in must_separate:
        if p1_id not in id_to_idx or p2_id not in id_to_idx:
            raise ValueError(f"Unknown player in must_separate: {p1_id}, {p2_id}")
        model += x[id_to_idx[p1_id]] + x[id_to_idx[p2_id]] == 1

    model.solve(pulp.PULP_CBC_CMD(msg=0))

    team1 = [players[i] for i in range(n) if pulp.value(x[i]) == 1]
    team2 = [players[i] for i in range(n) if pulp.value(x[i]) == 0]
    s1 = sum(p["score"] for p in team1)
    s2 = sum(p["score"] for p in team2)

    return {
        "team1": team1,
        "team2": team2,
        "score_team1": round(s1, 2),
        "score_team2": round(s2, 2),
        "difference": round(abs(s1 - s2), 2),
    }


def _generate_solutions(players: list[dict], n_solutions: int, randomization_level: float,
                         num_per_team: int, must_together: list[list[str]], must_separate: list[list[str]]) -> list[dict]:
    candidates = []
    for _ in range(n_solutions * 5):
        candidates.append(_optimize_once(players, randomization_level, num_per_team, must_together, must_separate))

    candidates.sort(key=lambda r: r["difference"])
    seen: set = set()
    unique = []
    for r in candidates:
        key = tuple(sorted(p["id"] for p in r["team1"]))
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique[:n_solutions]


# ---------------------------------------------------------------------------
# AUTH & PROFILE
# ---------------------------------------------------------------------------

@app.get("/api/me")
def get_me(user_id: str = Depends(get_required_user)):
    res = supabase.table("profiles").select("*").eq("id", user_id).execute()
    if not res.data:
        return {"id": user_id, "display_name": None, "linked_player_name": None, "phone": None}
    p = res.data[0]
    return {"id": user_id, "display_name": p.get("display_name"), "linked_player_name": p.get("linked_player_name"), "phone": p.get("phone")}


@app.put("/api/profile")
def update_profile(body: ProfileUpdate, user_id: str = Depends(get_required_user)):
    payload = {"id": user_id, "display_name": body.display_name}
    if body.phone is not None:
        payload["phone"] = body.phone
    supabase.table("profiles").upsert(payload).execute()
    return {"success": True}


# ---------------------------------------------------------------------------
# TOURNAMENTS
# ---------------------------------------------------------------------------

@app.get("/api/tournaments")
def get_tournaments(user_id: str = Depends(get_required_user)):
    res = supabase.table("tournaments").select("*").order("year", desc=True).order("season", desc=True).execute()
    return res.data


@app.post("/api/tournaments", status_code=201)
def create_tournament(body: TournamentCreate, user_id: str = Depends(get_required_user)):
    res = supabase.table("tournaments").insert({"name": body.name, "year": body.year, "season": body.season}).execute()
    tournament = res.data[0]
    supabase.table("tournament_players").insert({
        "tournament_id": tournament["id"],
        "user_id": user_id,
        "role": "admin",
    }).execute()
    return tournament


@app.put("/api/tournaments/{tournament_id}")
def update_tournament(tournament_id: int, body: TournamentUpdate, user_id: str = Depends(get_required_user)):
    _require_admin(tournament_id, user_id)
    res = supabase.table("tournaments").update({
        "name": body.name,
        "year": body.year,
        "season": body.season,
    }).eq("id", tournament_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Tournament not found")
    return res.data[0]


# ---------------------------------------------------------------------------
# TOURNAMENT PLAYERS
# ---------------------------------------------------------------------------

@app.get("/api/tournaments/{tournament_id}/players")
def get_tournament_players(tournament_id: int, user_id: str = Depends(get_required_user)):
    members_res = supabase.table("tournament_players").select("user_id,role").eq("tournament_id", tournament_id).execute()
    if not members_res.data:
        return []

    tournament_res = supabase.table("tournaments").select("created_by").eq("id", tournament_id).execute()
    owner_id = tournament_res.data[0]["created_by"] if tournament_res.data else None

    member_ids = [m["user_id"] for m in members_res.data]
    names = _display_names(member_ids)
    ratings_map = _averaged_ratings(tournament_id)

    result = []
    for m in members_res.data:
        uid = m["user_id"]
        r = ratings_map.get(uid, {})
        result.append({
            "user_id": uid,
            "display_name": names.get(uid),
            "role": m["role"],
            "is_owner": uid == owner_id,
            "avg_play":  round(r.get("avg_play",  3.0), 2),
            "avg_run":   round(r.get("avg_run",   3.0), 2),
            "avg_goals": round(r.get("avg_goals", 3.0), 2),
            "ratings_count": r.get("ratings_count", 0),
        })
    return result


@app.get("/api/tournaments/{tournament_id}/my-role")
def get_my_role(tournament_id: int, user_id: str = Depends(get_required_user)):
    res = supabase.table("tournament_players").select("role").eq("tournament_id", tournament_id).eq("user_id", user_id).execute()
    role = res.data[0]["role"] if res.data else None
    return {"role": role}


@app.put("/api/tournaments/{tournament_id}/players/{player_id}/role")
def update_player_role(tournament_id: int, player_id: str, body: PlayerRoleUpdate, current_user_id: str = Depends(get_required_user)):
    if body.role not in ("admin", "player"):
        raise HTTPException(status_code=400, detail="role must be 'admin' or 'player'")
    _require_admin(tournament_id, current_user_id)
    tournament_res = supabase.table("tournaments").select("created_by").eq("id", tournament_id).execute()
    owner_id = tournament_res.data[0]["created_by"] if tournament_res.data else None
    if player_id == owner_id:
        raise HTTPException(status_code=403, detail="The tournament owner's role cannot be changed.")
    if current_user_id != owner_id:
        raise HTTPException(status_code=403, detail="Only the tournament owner can change admin roles.")
    supabase.table("tournament_players").update({"role": body.role}).eq("tournament_id", tournament_id).eq("user_id", player_id).execute()
    return {"role": body.role}


@app.delete("/api/tournaments/{tournament_id}/players/{player_id}", status_code=204)
def remove_player(tournament_id: int, player_id: str, current_user_id: str = Depends(get_required_user)):
    _require_admin(tournament_id, current_user_id)
    tournament_res = supabase.table("tournaments").select("created_by").eq("id", tournament_id).execute()
    owner_id = tournament_res.data[0]["created_by"] if tournament_res.data else None
    if player_id == owner_id:
        raise HTTPException(status_code=403, detail="The tournament owner cannot be removed.")
    if current_user_id != owner_id:
        player_res = supabase.table("tournament_players").select("role").eq("tournament_id", tournament_id).eq("user_id", player_id).execute()
        if player_res.data and player_res.data[0]["role"] == "admin":
            raise HTTPException(status_code=403, detail="Only the owner can remove admins.")
    supabase.table("tournament_players").delete().eq("tournament_id", tournament_id).eq("user_id", player_id).execute()


# ---------------------------------------------------------------------------
# RATINGS
# ---------------------------------------------------------------------------

@app.get("/api/tournaments/{tournament_id}/ratings")
def get_my_ratings(tournament_id: int, user_id: str = Depends(get_required_user)):
    res = supabase.table("player_ratings").select("rated_id,play,run,goals").eq("tournament_id", tournament_id).eq("rater_id", user_id).execute()
    return res.data


@app.post("/api/tournaments/{tournament_id}/ratings", status_code=201)
def upsert_ratings(tournament_id: int, body: list[RatingItem], user_id: str = Depends(get_required_user)):
    if not body:
        return {"saved": 0}
    rows = [
        {
            "tournament_id": tournament_id,
            "rater_id": user_id,
            "rated_id": item.rated_id,
            "play": item.play,
            "run": item.run,
            "goals": item.goals,
        }
        for item in body
    ]
    supabase.table("player_ratings").upsert(rows, on_conflict="tournament_id,rater_id,rated_id").execute()
    return {"saved": len(rows)}


# ---------------------------------------------------------------------------
# MATCHES
# ---------------------------------------------------------------------------

@app.get("/api/tournaments/{tournament_id}/matches")
def get_matches(tournament_id: int, user_id: str = Depends(get_required_user)):
    res = supabase.table("matches").select("*").eq("tournament_id", tournament_id).execute()
    return res.data


@app.post("/api/tournaments/{tournament_id}/matches", status_code=201)
def create_match(tournament_id: int, body: MatchCreate, user_id: str = Depends(get_required_user)):
    _require_admin(tournament_id, user_id)
    now = datetime.now(timezone.utc).isoformat()
    is_draw = body.result == "draw"
    res = supabase.table("matches").insert({
        "tournament_id": tournament_id,
        "played_at": body.played_at,
        "team1_players": body.team1_players,
        "team2_players": body.team2_players,
        "result": body.result,
        "mvp": None,
        "mvp_poll_status": "closed" if is_draw else "open",
        "mvp_poll_opened_at": None if is_draw else now,
        "mvp_winners": [],
    }).execute()
    match = res.data[0]
    if body.scheduled_match_id:
        supabase.table("scheduled_matches").update({
            "result_match_id": match["id"],
            "status": "played",
        }).eq("id", body.scheduled_match_id).execute()
        _settle_bets_for_match(body.scheduled_match_id, body.result)
    return match


# ---------------------------------------------------------------------------
# MVP POLL
# ---------------------------------------------------------------------------

@app.post("/api/matches/{match_id}/vote-mvp")
def vote_mvp(match_id: int, body: VoteMVP, user_id: str = Depends(get_required_user)):
    match_res = supabase.table("matches").select(
        "tournament_id,result,team1_players,team2_players,mvp_poll_status"
    ).eq("id", match_id).execute()
    if not match_res.data:
        raise HTTPException(status_code=404, detail="Match not found")
    match = match_res.data[0]

    if match["mvp_poll_status"] != "open":
        raise HTTPException(status_code=400, detail="MVP poll is not open")

    result = match["result"]
    if result == "team1":
        winning_players = match.get("team1_players") or []
    elif result == "team2":
        winning_players = match.get("team2_players") or []
    else:
        raise HTTPException(status_code=400, detail="No MVP poll for draws")

    if body.voted_for_id not in winning_players:
        raise HTTPException(status_code=400, detail="voted_for_id must be a player on the winning team")

    supabase.table("mvp_votes").upsert(
        {"match_id": match_id, "voter_id": user_id, "voted_for_id": body.voted_for_id},
        on_conflict="match_id,voter_id",
    ).execute()
    return {"ok": True}


@app.get("/api/matches/{match_id}/mvp-poll")
def get_mvp_poll(match_id: int, user_id: str = Depends(get_required_user)):
    close_expired_mvp_polls()

    match_res = supabase.table("matches").select(
        "tournament_id,result,team1_players,team2_players,mvp_poll_status,mvp_poll_opened_at,mvp_winners"
    ).eq("id", match_id).execute()
    if not match_res.data:
        raise HTTPException(status_code=404, detail="Match not found")
    match = match_res.data[0]

    result = match["result"]
    if result == "team1":
        winning_players = match.get("team1_players") or []
    elif result == "team2":
        winning_players = match.get("team2_players") or []
    else:
        winning_players = []

    votes_res = supabase.table("mvp_votes").select("voted_for_id,voter_id").eq("match_id", match_id).execute()
    tally: dict[str, int] = defaultdict(int)
    my_vote = None
    for v in votes_res.data:
        tally[v["voted_for_id"]] += 1
        if v["voter_id"] == user_id:
            my_vote = v["voted_for_id"]

    all_ids: set[str] = set(winning_players) | set(tally.keys())
    all_ids.update(match.get("mvp_winners") or [])
    names = _display_names(list(all_ids)) if all_ids else {}

    time_remaining_seconds = None
    closes_at_iso = None
    opened_at_raw = match.get("mvp_poll_opened_at")
    if match["mvp_poll_status"] == "open" and opened_at_raw:
        try:
            # parse_date handles all ISO variants; fromisoformat is too strict on Python <3.11
            opened = parse_date(opened_at_raw)
            # If stored without timezone info (naive), assume UTC
            if opened.tzinfo is None:
                opened = opened.replace(tzinfo=timezone.utc)
            closes_at = opened + timedelta(hours=24)
            closes_at_iso = closes_at.isoformat()
            remaining = (closes_at - datetime.now(timezone.utc)).total_seconds()
            time_remaining_seconds = max(0.0, remaining)
        except Exception:
            pass

    candidates = [
        {"user_id": pid, "display_name": names.get(pid), "vote_count": tally.get(pid, 0)}
        for pid in winning_players
    ]
    candidates.sort(key=lambda x: x["vote_count"], reverse=True)

    winners = match.get("mvp_winners") or []
    return {
        "match_id": match_id,
        "poll_status": match["mvp_poll_status"],
        "opened_at": opened_at_raw,
        "closes_at": closes_at_iso,
        "time_remaining_seconds": time_remaining_seconds,
        "candidates": candidates,
        "my_vote": my_vote,
        "my_vote_name": names.get(my_vote) if my_vote else None,
        "winners": winners,
        "winner_names": [names.get(w) for w in winners],
    }


# ---------------------------------------------------------------------------
# STANDINGS
# ---------------------------------------------------------------------------

@app.get("/api/tournaments/{tournament_id}/standings")
def get_standings(tournament_id: int, user_id: str = Depends(get_required_user)):
    close_expired_mvp_polls()

    matches_res = supabase.table("matches").select("*").eq("tournament_id", tournament_id).execute()
    matches = matches_res.data
    total_matches = len(matches)

    stats: dict[str, dict] = defaultdict(lambda: {
        "matches_played": 0, "wins": 0, "draws": 0, "losses": 0,
        "match_points": 0, "mvp_count": 0,
    })

    for match in matches:
        result = match["result"]
        mvp_winners = match.get("mvp_winners") or []

        for pid in match.get("team1_players", []):
            s = stats[pid]
            s["matches_played"] += 1
            if result == "team1":
                s["wins"] += 1; s["match_points"] += sc.POINTS_WIN
            elif result == "draw":
                s["draws"] += 1; s["match_points"] += sc.POINTS_DRAW
            else:
                s["losses"] += 1; s["match_points"] += sc.POINTS_LOSS
            if pid in mvp_winners:
                s["mvp_count"] += 1

        for pid in match.get("team2_players", []):
            s = stats[pid]
            s["matches_played"] += 1
            if result == "team2":
                s["wins"] += 1; s["match_points"] += sc.POINTS_WIN
            elif result == "draw":
                s["draws"] += 1; s["match_points"] += sc.POINTS_DRAW
            else:
                s["losses"] += 1; s["match_points"] += sc.POINTS_LOSS
            if pid in mvp_winners:
                s["mvp_count"] += 1

    all_pids = list(stats.keys())
    names = _display_names(all_pids)

    rows = []
    for pid, s in stats.items():
        eff = sc.effectivity(s["match_points"], s["matches_played"])
        score = sc.total_score(s["match_points"], s["matches_played"], s["mvp_count"])
        presence_pct = round(s["matches_played"] / total_matches * 100, 1) if total_matches > 0 else 0.0
        rows.append({
            "user_id": pid,
            "display_name": names.get(pid),
            "matches_played": s["matches_played"],
            "wins": s["wins"],
            "draws": s["draws"],
            "losses": s["losses"],
            "match_points": s["match_points"],
            "effectivity": round(eff, 4),
            "mvp_count": s["mvp_count"],
            "presence_pct": presence_pct,
            "total_score": round(score, 4),
        })

    rows.sort(key=lambda r: r["total_score"], reverse=True)
    return rows


# ---------------------------------------------------------------------------
# TEAM GENERATION
# ---------------------------------------------------------------------------

@app.post("/api/tournaments/{tournament_id}/generate-teams")
def generate_teams(tournament_id: int, body: GenerateTeamsRequest, user_id: str = Depends(get_required_user)):
    _require_admin(tournament_id, user_id)

    expected = body.num_players_per_team * 2
    if len(body.selected_player_ids) != expected:
        raise HTTPException(
            status_code=400,
            detail=f"Expected {expected} selected players, got {len(body.selected_player_ids)}",
        )

    ratings_map = _averaged_ratings(tournament_id)
    names = _display_names(body.selected_player_ids)

    players = []
    for uid in body.selected_player_ids:
        r = ratings_map.get(uid, {})
        avg_play  = r.get("avg_play",  3.0)
        avg_run   = r.get("avg_run",   3.0)
        avg_goals = r.get("avg_goals", 3.0)
        players.append({
            "id": uid,
            "display_name": names.get(uid, uid),
            "score": avg_play + avg_run + avg_goals,
            "avg_play":  round(avg_play,  2),
            "avg_run":   round(avg_run,   2),
            "avg_goals": round(avg_goals, 2),
        })

    try:
        solutions = _generate_solutions(
            players=players,
            n_solutions=3,
            randomization_level=0.5,
            num_per_team=body.num_players_per_team,
            must_together=body.must_together,
            must_separate=body.must_separate,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return solutions


# ---------------------------------------------------------------------------
# INVITES
# ---------------------------------------------------------------------------

@app.get("/api/tournaments/{tournament_id}/invites")
def list_invites(tournament_id: int, user_id: str = Depends(get_required_user)):
    _require_admin(tournament_id, user_id)
    now = datetime.now(timezone.utc).isoformat()
    res = supabase.table("invite_links").select("token,role,expires_at,created_by").eq("tournament_id", tournament_id).gt("expires_at", now).execute()
    return res.data


@app.post("/api/tournaments/{tournament_id}/invite", status_code=201)
def create_invite(tournament_id: int, body: InviteCreate, user_id: str = Depends(get_required_user)):
    _require_admin(tournament_id, user_id)
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    supabase.table("invite_links").insert({
        "tournament_id": tournament_id,
        "role": body.role,
        "created_by": user_id,
        "token": token,
        "expires_at": expires_at,
        "used": False,
    }).execute()
    return {"invite_url": f"/invite/{token}"}


# ---------------------------------------------------------------------------
# SCHEDULED MATCHES & RSVP
# ---------------------------------------------------------------------------

@app.get("/api/tournaments/{tournament_id}/scheduled-matches")
def get_scheduled_matches(tournament_id: int, user_id: str = Depends(get_required_user)):
    close_expired_mvp_polls()
    matches_res = supabase.table("scheduled_matches").select("*").eq("tournament_id", tournament_id).order("scheduled_at").execute()
    matches = matches_res.data
    if not matches:
        return []

    match_ids = [m["id"] for m in matches]
    rsvps_res = supabase.table("match_rsvps").select("scheduled_match_id,user_id,status").in_("scheduled_match_id", match_ids).execute()
    rsvps_by_match: dict[int, list] = defaultdict(list)
    all_uids: set[str] = set()
    for r in rsvps_res.data:
        rsvps_by_match[r["scheduled_match_id"]].append(r)
        all_uids.add(r["user_id"])

    for m in matches:
        for uid in (m.get("team1_players") or []):
            all_uids.add(uid)
        for uid in (m.get("team2_players") or []):
            all_uids.add(uid)

    # Fetch linked match results for scheduled matches that have one
    result_match_ids = [m["result_match_id"] for m in matches if m.get("result_match_id")]
    results_by_id: dict[int, dict] = {}
    if result_match_ids:
        res_matches = supabase.table("matches").select(
            "id,result,mvp,mvp_winners,mvp_poll_status,mvp_poll_opened_at"
        ).in_("id", result_match_ids).execute()
        for rm in res_matches.data:
            results_by_id[rm["id"]] = rm
            if rm.get("mvp"):
                all_uids.add(rm["mvp"])
            for wid in (rm.get("mvp_winners") or []):
                all_uids.add(wid)

    names = _display_names(list(all_uids))

    result = []
    for m in matches:
        rsvps = rsvps_by_match.get(m["id"], [])
        enriched_rsvps = [
            {"user_id": r["user_id"], "display_name": names.get(r["user_id"]), "status": r["status"]}
            for r in rsvps
        ]
        t1 = m.get("team1_players") or []
        t2 = m.get("team2_players") or []
        rm_id = m.get("result_match_id")
        rm = results_by_id.get(rm_id) if rm_id else None
        result.append({
            "id": m["id"],
            "scheduled_at": m["scheduled_at"],
            "location": m["location"],
            "players_needed": m["players_needed"],
            "status": m["status"],
            "created_by": m["created_by"],
            "rsvps": enriched_rsvps,
            "rsvp_count": sum(1 for r in rsvps if r["status"] == "in"),
            "team1": [{"user_id": uid, "display_name": names.get(uid)} for uid in t1],
            "team2": [{"user_id": uid, "display_name": names.get(uid)} for uid in t2],
            "result_match_id": rm_id,
            "result": rm["result"] if rm else None,
            "mvp_display_name": names.get(rm["mvp"]) if rm and rm.get("mvp") else None,
            "mvp_poll_status": rm["mvp_poll_status"] if rm else None,
            "mvp_poll_opened_at": rm.get("mvp_poll_opened_at") if rm else None,
            "mvp_winners": rm.get("mvp_winners") or [] if rm else [],
            "mvp_winner_names": [names.get(w) for w in (rm.get("mvp_winners") or [])] if rm else [],
        })
    return result


@app.put("/api/scheduled-matches/{match_id}/teams")
def save_match_teams(match_id: int, body: TeamsUpdate, user_id: str = Depends(get_required_user)):
    match_res = supabase.table("scheduled_matches").select("tournament_id").eq("id", match_id).execute()
    if not match_res.data:
        raise HTTPException(status_code=404, detail="Scheduled match not found")
    _require_admin(match_res.data[0]["tournament_id"], user_id)
    res = supabase.table("scheduled_matches").update({
        "team1_players": body.team1_players,
        "team2_players": body.team2_players,
    }).eq("id", match_id).execute()
    return res.data[0]


@app.post("/api/tournaments/{tournament_id}/scheduled-matches", status_code=201)
def create_scheduled_match(tournament_id: int, body: ScheduledMatchCreate, user_id: str = Depends(get_required_user)):
    _require_admin(tournament_id, user_id)
    res = supabase.table("scheduled_matches").insert({
        "tournament_id": tournament_id,
        "scheduled_at": body.scheduled_at,
        "location": body.location,
        "players_needed": body.players_needed,
        "status": "open",
        "created_by": user_id,
    }).execute()
    return res.data[0]


@app.post("/api/scheduled-matches/{match_id}/rsvp")
def rsvp_to_match(match_id: int, body: RSVPCreate, user_id: str = Depends(get_required_user)):
    if body.status not in ("in", "out"):
        raise HTTPException(status_code=400, detail="status must be 'in' or 'out'")

    match_res = supabase.table("scheduled_matches").select("*").eq("id", match_id).execute()
    if not match_res.data:
        raise HTTPException(status_code=404, detail="Scheduled match not found")
    match = match_res.data[0]

    supabase.table("match_rsvps").upsert(
        {"scheduled_match_id": match_id, "user_id": user_id, "status": body.status},
        on_conflict="scheduled_match_id,user_id",
    ).execute()

    in_count_res = supabase.table("match_rsvps").select("user_id").eq("scheduled_match_id", match_id).eq("status", "in").execute()
    in_count = len(in_count_res.data)

    new_status = match["status"]
    if in_count >= match["players_needed"] and match["status"] == "open":
        new_status = "confirmed"
    elif in_count < match["players_needed"] and match["status"] == "confirmed":
        new_status = "open"

    if new_status != match["status"]:
        supabase.table("scheduled_matches").update({"status": new_status}).eq("id", match_id).execute()

    return {"rsvp_count": in_count, "match_status": new_status}


@app.put("/api/scheduled-matches/{match_id}/status")
def update_scheduled_match_status(match_id: int, body: ScheduledMatchStatusUpdate, user_id: str = Depends(get_required_user)):
    if body.status not in ("open", "confirmed", "cancelled", "played"):
        raise HTTPException(status_code=400, detail="Invalid status")

    match_res = supabase.table("scheduled_matches").select("tournament_id").eq("id", match_id).execute()
    if not match_res.data:
        raise HTTPException(status_code=404, detail="Scheduled match not found")

    _require_admin(match_res.data[0]["tournament_id"], user_id)
    supabase.table("scheduled_matches").update({"status": body.status}).eq("id", match_id).execute()
    return {"status": body.status}


@app.delete("/api/scheduled-matches/{match_id}", status_code=204)
def delete_scheduled_match(match_id: int, user_id: str = Depends(get_required_user)):
    match_res = supabase.table("scheduled_matches").select("tournament_id").eq("id", match_id).execute()
    if not match_res.data:
        raise HTTPException(status_code=404, detail="Scheduled match not found")

    _require_admin(match_res.data[0]["tournament_id"], user_id)
    supabase.table("match_rsvps").delete().eq("scheduled_match_id", match_id).execute()
    supabase.table("scheduled_matches").delete().eq("id", match_id).execute()


@app.post("/api/invite/accept")
def accept_invite(body: InviteAccept, user_id: str = Depends(get_required_user)):
    res = supabase.table("invite_links").select("*").eq("token", body.token).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Invalid invite token")

    invite = res.data[0]

    if parse_date(invite["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite expired")

    existing = supabase.table("tournament_players").select("user_id").eq("tournament_id", invite["tournament_id"]).eq("user_id", user_id).execute()
    if not existing.data:
        supabase.table("tournament_players").insert({
            "tournament_id": invite["tournament_id"],
            "user_id": user_id,
            "role": invite["role"],
        }).execute()

    return {"tournament_id": invite["tournament_id"]}


# ---------------------------------------------------------------------------
# BETS
# ---------------------------------------------------------------------------

_BET_STATUS_ORDER = {"open": 0, "accepted": 1, "settled": 2, "void": 4, "cancelled": 5}


def _bet_sort_key(bet: dict) -> tuple:
    status = bet["status"]
    if status == "settled":
        return (2 if not bet.get("paid") else 3, bet.get("settled_at") or "")
    return (_BET_STATUS_ORDER.get(status, 9), bet.get("created_at") or "")


@app.get("/api/tournaments/{tournament_id}/bets")
def get_bets(tournament_id: int, user_id: str = Depends(get_required_user)):
    bets_res = supabase.table("bets").select("*").eq("tournament_id", tournament_id).execute()
    bets = bets_res.data
    if not bets:
        return []

    all_uids: set[str] = set()
    match_ids: set[int] = set()
    for b in bets:
        for field in ("creator_id", "acceptor_id", "debtor_id", "creditor_id"):
            if b.get(field):
                all_uids.add(b[field])
        if b.get("scheduled_match_id"):
            match_ids.add(b["scheduled_match_id"])

    names = _display_names(list(all_uids))

    matches_by_id: dict[int, dict] = {}
    if match_ids:
        sm_res = supabase.table("scheduled_matches").select("id,scheduled_at,location,team1_players,team2_players").in_("id", list(match_ids)).execute()
        for m in sm_res.data:
            matches_by_id[m["id"]] = m

    result = []
    for b in bets:
        sm = matches_by_id.get(b.get("scheduled_match_id"))
        result.append({
            "id": b["id"],
            "tournament_id": b["tournament_id"],
            "scheduled_match_id": b.get("scheduled_match_id"),
            "match_scheduled_at": sm["scheduled_at"] if sm else None,
            "match_location": sm.get("location") if sm else None,
            "creator_id": b["creator_id"],
            "creator_name": names.get(b["creator_id"]),
            "acceptor_id": b.get("acceptor_id"),
            "acceptor_name": names.get(b["acceptor_id"]) if b.get("acceptor_id") else None,
            "predicted_winner": b["predicted_winner"],
            "stake": float(b["stake"]),
            "odds_ratio": b["odds_ratio"],
            "status": b["status"],
            "outcome": b.get("outcome"),
            "amount_owed": float(b["amount_owed"]) if b.get("amount_owed") is not None else None,
            "debtor_id": b.get("debtor_id"),
            "debtor_name": names.get(b["debtor_id"]) if b.get("debtor_id") else None,
            "creditor_id": b.get("creditor_id"),
            "creditor_name": names.get(b["creditor_id"]) if b.get("creditor_id") else None,
            "paid": bool(b.get("paid")),
            "created_at": b.get("created_at"),
            "settled_at": b.get("settled_at"),
        })

    result.sort(key=_bet_sort_key)
    return result


@app.post("/api/tournaments/{tournament_id}/bets", status_code=201)
def create_bet(tournament_id: int, body: BetCreate, user_id: str = Depends(get_required_user)):
    if body.predicted_winner not in ("team1", "team2"):
        raise HTTPException(status_code=400, detail="predicted_winner must be 'team1' or 'team2'")
    if body.odds_ratio not in ("1:1", "1:2", "1:3", "2:1"):
        raise HTTPException(status_code=400, detail="odds_ratio must be one of: 1:1, 1:2, 1:3, 2:1")
    if body.stake <= 0:
        raise HTTPException(status_code=400, detail="stake must be positive")

    sm_res = supabase.table("scheduled_matches").select("id,tournament_id,status,team1_players,team2_players").eq("id", body.scheduled_match_id).execute()
    if not sm_res.data:
        raise HTTPException(status_code=404, detail="Scheduled match not found")
    sm = sm_res.data[0]
    if sm["tournament_id"] != tournament_id:
        raise HTTPException(status_code=400, detail="Match does not belong to this tournament")
    if sm["status"] == "played":
        raise HTTPException(status_code=400, detail="Cannot bet on a match that is already played")
    if not sm.get("team1_players") and not sm.get("team2_players"):
        raise HTTPException(status_code=400, detail="Match must have saved teams before bets can be placed")

    res = supabase.table("bets").insert({
        "tournament_id": tournament_id,
        "scheduled_match_id": body.scheduled_match_id,
        "creator_id": user_id,
        "predicted_winner": body.predicted_winner,
        "stake": body.stake,
        "odds_ratio": body.odds_ratio,
        "status": "open",
    }).execute()
    return res.data[0]


@app.post("/api/bets/{bet_id}/accept")
def accept_bet(bet_id: int, user_id: str = Depends(get_required_user)):
    bet_res = supabase.table("bets").select("*").eq("id", bet_id).execute()
    if not bet_res.data:
        raise HTTPException(status_code=404, detail="Bet not found")
    bet = bet_res.data[0]
    if bet["creator_id"] == user_id:
        raise HTTPException(status_code=400, detail="Cannot accept your own bet")
    if bet["status"] != "open":
        raise HTTPException(status_code=400, detail="Bet is not open for acceptance")

    supabase.table("bets").update({"acceptor_id": user_id, "status": "accepted"}).eq("id", bet_id).execute()
    return {"status": "accepted"}


@app.post("/api/bets/{bet_id}/cancel")
def cancel_bet(bet_id: int, user_id: str = Depends(get_required_user)):
    bet_res = supabase.table("bets").select("*").eq("id", bet_id).execute()
    if not bet_res.data:
        raise HTTPException(status_code=404, detail="Bet not found")
    bet = bet_res.data[0]
    if bet["creator_id"] != user_id:
        raise HTTPException(status_code=403, detail="Only the bet creator can cancel it")
    if bet["status"] != "open":
        raise HTTPException(status_code=400, detail="Only open bets can be cancelled")

    supabase.table("bets").update({"status": "cancelled"}).eq("id", bet_id).execute()
    return {"status": "cancelled"}


@app.post("/api/bets/{bet_id}/mark-paid")
def mark_bet_paid(bet_id: int, user_id: str = Depends(get_required_user)):
    bet_res = supabase.table("bets").select("*").eq("id", bet_id).execute()
    if not bet_res.data:
        raise HTTPException(status_code=404, detail="Bet not found")
    bet = bet_res.data[0]
    if bet["status"] != "settled":
        raise HTTPException(status_code=400, detail="Only settled bets can be marked as paid")
    if bet.get("paid"):
        raise HTTPException(status_code=400, detail="Bet is already marked as paid")
    is_creditor = bet.get("creditor_id") == user_id
    is_admin = _is_admin(bet["tournament_id"], user_id)
    if not is_creditor and not is_admin:
        raise HTTPException(status_code=403, detail="Only the creditor or a tournament admin can mark this as paid")

    supabase.table("bets").update({"paid": True}).eq("id", bet_id).execute()
    return {"paid": True}


@app.get("/api/tournaments/{tournament_id}/settle-up")
def settle_up(tournament_id: int, user_id: str = Depends(get_required_user)):
    bets_res = supabase.table("bets").select("debtor_id,creditor_id,amount_owed").eq("tournament_id", tournament_id).eq("status", "settled").eq("paid", False).execute()
    bets = bets_res.data

    raw: dict[tuple, float] = defaultdict(float)
    all_uids: set[str] = set()
    for b in bets:
        d, c, amt = b.get("debtor_id"), b.get("creditor_id"), b.get("amount_owed")
        if d and c and amt:
            raw[(d, c)] += float(amt)
            all_uids.add(d)
            all_uids.add(c)

    names = _display_names(list(all_uids))

    result = []
    processed: set[tuple] = set()
    for (a, b_id), amount in raw.items():
        if (a, b_id) in processed:
            continue
        reverse = raw.get((b_id, a), 0.0)
        net = amount - reverse
        if net > 0.005:
            result.append({
                "debtor_id": a, "creditor_id": b_id,
                "debtor_name": names.get(a, a), "creditor_name": names.get(b_id, b_id),
                "net_amount": round(net, 2),
            })
        elif net < -0.005:
            result.append({
                "debtor_id": b_id, "creditor_id": a,
                "debtor_name": names.get(b_id, b_id), "creditor_name": names.get(a, a),
                "net_amount": round(-net, 2),
            })
        processed.add((a, b_id))
        processed.add((b_id, a))

    result.sort(key=lambda x: x["net_amount"], reverse=True)
    return result
