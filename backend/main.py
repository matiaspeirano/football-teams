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
    res = supabase.table("matches").insert({
        "tournament_id": tournament_id,
        "played_at": body.played_at,
        "team1_players": body.team1_players,
        "team2_players": body.team2_players,
        "result": body.result,
        "mvp": body.mvp,
    }).execute()
    return res.data[0]


# ---------------------------------------------------------------------------
# STANDINGS
# ---------------------------------------------------------------------------

@app.get("/api/tournaments/{tournament_id}/standings")
def get_standings(tournament_id: int, user_id: str = Depends(get_required_user)):
    matches_res = supabase.table("matches").select("*").eq("tournament_id", tournament_id).execute()
    matches = matches_res.data
    total_matches = len(matches)

    stats: dict[str, dict] = defaultdict(lambda: {
        "matches_played": 0, "wins": 0, "draws": 0, "losses": 0,
        "match_points": 0, "mvp_count": 0,
    })

    for match in matches:
        result = match["result"]
        mvp = match.get("mvp")

        for pid in match.get("team1_players", []):
            s = stats[pid]
            s["matches_played"] += 1
            if result == "team1":
                s["wins"] += 1; s["match_points"] += sc.POINTS_WIN
            elif result == "draw":
                s["draws"] += 1; s["match_points"] += sc.POINTS_DRAW
            else:
                s["losses"] += 1; s["match_points"] += sc.POINTS_LOSS
            if mvp == pid:
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
            if mvp == pid:
                s["mvp_count"] += 1

    all_pids = list(stats.keys())
    names = _display_names(all_pids)

    rows = []
    for pid, s in stats.items():
        presence = s["matches_played"] * sc.PRESENCE_PER_MATCH
        eff = sc.effectivity(s["match_points"], s["matches_played"])
        score = sc.total_score(s["match_points"], s["matches_played"], s["mvp_count"], presence)
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
    res = supabase.table("invite_links").select("token,role,expires_at,created_by").eq("tournament_id", tournament_id).eq("used", False).gt("expires_at", now).execute()
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
    if invite.get("used"):
        raise HTTPException(status_code=400, detail="Invite already used")

    if parse_date(invite["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite expired")

    existing = supabase.table("tournament_players").select("user_id").eq("tournament_id", invite["tournament_id"]).eq("user_id", user_id).execute()
    if not existing.data:
        supabase.table("tournament_players").insert({
            "tournament_id": invite["tournament_id"],
            "user_id": user_id,
            "role": invite["role"],
        }).execute()

    supabase.table("invite_links").update({"used": True}).eq("token", body.token).execute()
    return {"tournament_id": invite["tournament_id"]}
