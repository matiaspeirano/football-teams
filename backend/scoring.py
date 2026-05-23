# ---------------------------------------------------------------------------
# Match point values
# ---------------------------------------------------------------------------
POINTS_WIN = 3
POINTS_DRAW = 1
POINTS_LOSS = 0

# ---------------------------------------------------------------------------
# Bonus point values
# ---------------------------------------------------------------------------
PRESENCE_PER_MATCH = 1
MVP_PER_AWARD = 1

# ---------------------------------------------------------------------------
# Formula
# ---------------------------------------------------------------------------

def effectivity(match_points: int, matches_played: int) -> float:
    """match_points / (matches_played * max points per match)"""
    if matches_played == 0:
        return 0.0
    return match_points / (matches_played * POINTS_WIN)


def total_score(match_points: int, matches_played: int, mvp_count: int, presence: int) -> float:
    eff = effectivity(match_points, matches_played)
    return (match_points * eff) + (mvp_count * MVP_PER_AWARD) + (presence * PRESENCE_PER_MATCH)
