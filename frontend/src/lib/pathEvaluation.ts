import type { PathBigSkillState, PathLevel } from "./api";

const BIG_SKILL_STATE_SCORE: Record<PathBigSkillState, number> = {
    unverified: 0,
    assist_required: 1,
    conditional: 2,
    near_independent: 3,
    stable_independent: 4,
};

export function derivePathLevelFromStates(
    states: Partial<Record<string, PathBigSkillState>> | undefined,
): PathLevel {
    const values = Object.values(states || {}).filter(
        (value): value is PathBigSkillState => typeof value === "string",
    );
    const scored = values.map((value) => BIG_SKILL_STATE_SCORE[value] ?? 0);
    const stableCount = scored.filter((value) => value >= 4).length;
    const nearOrBetterCount = scored.filter((value) => value >= 3).length;
    const conditionalOrBetterCount = scored.filter((value) => value >= 2).length;
    const assistOrBetterCount = scored.filter((value) => value >= 1).length;

    // Conservative promotion rule until a stricter policy bundle is defined.
    if (stableCount >= 4 && nearOrBetterCount >= 6) {
        return "L4";
    }
    if (nearOrBetterCount >= 4 && conditionalOrBetterCount >= 6) {
        return "L3";
    }
    if (conditionalOrBetterCount >= 3 || assistOrBetterCount >= 5) {
        return "L2";
    }
    return "L1";
}
