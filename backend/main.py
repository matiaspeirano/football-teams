import random
import copy

import pulp
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from players import PLAYERS

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

class PlayerInput(BaseModel):
    name: str
    play: str
    run: str
    goals: str


class GenerateTeamsRequest(BaseModel):
    players: list[PlayerInput]
    num_players_per_team: int
    must_together: list[list[str]] = []
    must_separate: list[list[str]] = []


# ---------------------------------------------------------------------------
# Algorithm
# ---------------------------------------------------------------------------

def get_score(value: str) -> int:
    return {"Low": 1, "Medium Low": 2, "Medium": 3, "Medium High": 4, "High": 5}.get(value, 0)


def compute_base_score(player: dict) -> int:
    return get_score(player["play"]) + get_score(player["run"]) + get_score(player["goals"])


def optimize_teams_lp(players, randomization_level, num_players_per_team, must_together, must_separate):
    active_players = [p for p in players if p["playing"] == 1]

    if len(active_players) != num_players_per_team * 2:
        raise ValueError(
            "Need exactly {} players playing, got {}".format(
                num_players_per_team * 2, len(active_players)
            )
        )

    n = len(active_players)
    scores = {}
    name_to_index = {}

    for i, p in enumerate(active_players):
        base = compute_base_score(p)
        noise = random.uniform(-randomization_level, randomization_level)
        scores[i] = max(1, base + noise)
        name_to_index[p["name"]] = i

    model = pulp.LpProblem("TeamBalancing", pulp.LpMinimize)
    x = pulp.LpVariable.dicts("x", range(n), cat="Binary")
    d = pulp.LpVariable("difference", lowBound=0)

    team1_score = pulp.lpSum(scores[i] * x[i] for i in range(n))
    team2_score = pulp.lpSum(scores[i] * (1 - x[i]) for i in range(n))

    model += d
    model += team1_score - team2_score <= d
    model += team2_score - team1_score <= d
    model += pulp.lpSum(x[i] for i in range(n)) == num_players_per_team

    for p1, p2 in must_together:
        if p1 not in name_to_index or p2 not in name_to_index:
            raise ValueError(f"Unknown player in must_together: {p1}, {p2}")
        model += x[name_to_index[p1]] == x[name_to_index[p2]]

    for p1, p2 in must_separate:
        if p1 not in name_to_index or p2 not in name_to_index:
            raise ValueError(f"Unknown player in must_separate: {p1}, {p2}")
        model += x[name_to_index[p1]] + x[name_to_index[p2]] == 1

    model.solve(pulp.PULP_CBC_CMD(msg=0))

    team1, team2 = [], []
    for i in range(n):
        if pulp.value(x[i]) == 1:
            team1.append(active_players[i]["name"])
        else:
            team2.append(active_players[i]["name"])

    team1_score_real = sum(
        compute_base_score(active_players[i]) for i in range(n) if pulp.value(x[i]) == 1
    )
    team2_score_real = sum(
        compute_base_score(active_players[i]) for i in range(n) if pulp.value(x[i]) == 0
    )

    return {
        "team1": team1,
        "team2": team2,
        "score_team1": team1_score_real,
        "score_team2": team2_score_real,
        "difference": abs(team1_score_real - team2_score_real),
    }


def generate_multiple_solutions(players, n_solutions, randomization_level, num_players_per_team, must_together, must_separate):
    results = []
    for _ in range(n_solutions * 5):
        res = optimize_teams_lp(players, randomization_level, num_players_per_team, must_together, must_separate)
        results.append(res)

    results = sorted(results, key=lambda x: x["difference"])
    unique = []
    seen = set()
    for r in results:
        key = tuple(sorted(r["team1"]))
        if key not in seen:
            seen.add(key)
            unique.append(r)

    return unique[:n_solutions]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/players")
def get_players():
    return PLAYERS


@app.post("/api/generate-teams")
def generate_teams(request: GenerateTeamsRequest):
    selected_names = {p.name for p in request.players}

    # Build the ratings lookup from the canonical player list
    ratings = {p["name"]: p for p in PLAYERS}

    unknown = selected_names - ratings.keys()
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown players: {unknown}")

    # Compose the player list with playing flags set by the request
    players_for_solver = []
    for p in PLAYERS:
        entry = copy.copy(p)
        entry["playing"] = 1 if p["name"] in selected_names else 0
        players_for_solver.append(entry)

    expected = request.num_players_per_team * 2
    if len(selected_names) != expected:
        raise HTTPException(
            status_code=400,
            detail=f"Expected {expected} selected players, got {len(selected_names)}",
        )

    try:
        raw_solutions = generate_multiple_solutions(
            players=players_for_solver,
            n_solutions=3,
            randomization_level=0.5,
            num_players_per_team=request.num_players_per_team,
            must_together=request.must_together,
            must_separate=request.must_separate,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Enrich each solution with per-player scores
    def enrich(names):
        return [
            {"name": name, "score": compute_base_score(ratings[name])}
            for name in names
        ]

    solutions = [
        {
            "team1": enrich(sol["team1"]),
            "team2": enrich(sol["team2"]),
            "score_team1": sol["score_team1"],
            "score_team2": sol["score_team2"],
            "difference": sol["difference"],
        }
        for sol in raw_solutions
    ]

    return solutions
