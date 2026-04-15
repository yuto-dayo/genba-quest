import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Award, Calculator, ClipboardCheck, RefreshCw, Send, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import {
    PATH_BIG_SKILL_KEYS,
    PATH_BIG_SKILL_STATE_OPTIONS,
    PATH_LEVEL_OPTIONS,
    PATH_CERTIFICATION_STATUS_OPTIONS,
    createPathFinalizeProposal,
    createPathRewardProposal,
    createPathSkillProposal,
    fetchLUQORewardCalculations,
    fetchMembers,
    fetchPathAiReviews,
    fetchPathCertifications,
    fetchPathConfirmations,
    fetchPathFinalizations,
    fetchPathForms,
    fetchPathProfiles,
    fetchPathRewardCalculations,
    generatePathAiReview,
    previewPathReward,
    savePathForm,
    type LUQORewardCalculation,
    type Member,
    type PathBigSkillKey,
    type PathBigSkillState,
    type PathCertificationStatus,
    type PathMonthlyEvaluationAiReview,
    type PathMonthlyEvaluationConfirmation,
    type PathMonthlyEvaluationFinalization,
    type PathMonthlyEvaluationForm,
    type PathMonthlyEvaluationFormInput,
    type PathLevel,
    type PathRewardCalculationSnapshot,
    type PathRewardMemberInput,
    type PathRewardPreview,
    type PathRewardProfitInputs,
    type PathSkillCertification,
    type PathSkillProfile,
} from "../../lib/api";
import styles from "./PathTab.module.css";

const BIG_SKILL_LABELS: Record<PathBigSkillKey, string> = {
    cross_work: "クロス施工力",
    putty_foundation: "パテ・下地処理力",
    planning_preparation: "段取り・準備力",
    quality_stability: "品質安定力",
    site_trust: "現場信頼形成力",
    education_support: "教育・支援力",
};

const BIG_SKILL_STATE_LABELS: Record<PathBigSkillState, string> = {
    unverified: "未確認",
    assist_required: "補助あり",
    conditional: "条件付き",
    near_independent: "ほぼ自走",
    stable_independent: "安定自走",
};

const CERTIFICATION_STATUS_LABELS: Record<PathCertificationStatus, string> = {
    candidate: "候補",
    verified: "認定",
    review_required: "要レビュー",
    revoked: "取消",
};

const REWORK_FLAG_LABELS: Record<NonNullable<PathMonthlyEvaluationForm["rework_flag"]>, string> = {
    none: "なし",
    minor: "軽微",
    major: "重大",
};

type RewardMemberDraft = Omit<PathRewardMemberInput, "level"> & {
    level: PathLevel | "";
};

function currentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function displayMemberName(memberId: string, memberMap: Map<string, Member>): string {
    const member = memberMap.get(memberId);
    return member?.full_name || member?.username || `${memberId.slice(0, 8)}...`;
}

function toPlainText(value: Record<string, unknown> | string): string {
    if (typeof value === "string") {
        return value;
    }

    const summary = Object.entries(value)
        .slice(0, 3)
        .map(([key, inner]) => `${key}: ${String(inner)}`);
    return summary.join(" / ");
}

function buildInitialFinalizeStates(
    review?: PathMonthlyEvaluationAiReview,
    finalization?: PathMonthlyEvaluationFinalization,
    profile?: PathSkillProfile,
): Record<PathBigSkillKey, PathBigSkillState> {
    return PATH_BIG_SKILL_KEYS.reduce((acc, key) => {
        const profileValue = profile?.[`${key}_status` as keyof PathSkillProfile];
        acc[key] =
            finalization?.confirmed_big_skill_states?.[key] ||
            review?.candidate_states?.[key] ||
            (typeof profileValue === "string" ? (profileValue as PathBigSkillState) : "unverified");
        return acc;
    }, {} as Record<PathBigSkillKey, PathBigSkillState>);
}

function buildInitialFormInput(
    period: string,
    memberId: string,
    form?: PathMonthlyEvaluationForm,
): PathMonthlyEvaluationFormInput {
    return {
        month: period,
        member_id: memberId,
        selected_big_skill_states: PATH_BIG_SKILL_KEYS.reduce((acc, key) => {
            acc[key] = form?.selected_big_skill_states?.[key] || "unverified";
            return acc;
        }, {} as Record<PathBigSkillKey, PathBigSkillState>),
        selected_roles: form?.selected_roles || [],
        site_ids: form?.site_ids || [],
        photo_flag: form?.photo_flag || false,
        rework_flag: form?.rework_flag || "none",
        comment: form?.comment || "",
    };
}

function joinCsv(values: string[] | undefined): string {
    return (values || []).join(", ");
}

function splitCsv(value: string): string[] {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function buildInitialRewardProfitInputs(): PathRewardProfitInputs {
    return {
        sales: 0,
        outsourcing_cost: 0,
        materials_cost: 0,
        parking_cost: 0,
        transport_cost: 0,
        other_direct_cost: 0,
        common_cost: 0,
        reserve_amount: 0,
    };
}

function buildRewardMemberDraft(
    memberId: string,
    memberMap: Map<string, Member>,
    finalizationMap: Map<string, PathMonthlyEvaluationFinalization>,
    profileMap: Map<string, PathSkillProfile>,
): RewardMemberDraft {
    const member = memberMap.get(memberId);
    const finalization = finalizationMap.get(memberId);
    const profile = profileMap.get(memberId);

    return {
        member_id: memberId,
        name: member?.full_name || member?.username || displayMemberName(memberId, memberMap),
        work_days: finalization?.work_days || 0,
        level: finalization?.current_level || profile?.current_level || "",
        A: finalization?.A ?? 1,
        R: finalization?.R ?? 1,
        Q: finalization?.Q ?? 1,
    };
}

function buildEmptyRewardMember(): RewardMemberDraft {
    return {
        member_id: "",
        name: "",
        work_days: 0,
        level: "",
        A: 1,
        R: 1,
        Q: 1,
    };
}

function formatCurrency(value: number): string {
    return `¥${value.toLocaleString("ja-JP")}`;
}

function formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatSkillLabel(value: string): string {
    return value.replaceAll("_", " ");
}

function toFiniteNumber(value: unknown): number {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

interface PathCalculationMember {
    member_id: string;
    name: string;
    work_days: number;
    level: string;
    A: number;
    R: number;
    Q: number;
    monthly_point_total: number;
    monthly_coefficient: number;
    base_reward: number;
    variable_reward: number;
    total_reward: number;
}

interface PathCalculationRun {
    proposal_id: string;
    month: string;
    finalized_at: string;
    calculation_version: string;
    profit_amount: number;
    base_pool_amount: number;
    variable_pool_amount: number;
    total_amount: number;
    members: PathCalculationMember[];
}

type WorkflowTone = "neutral" | "info" | "warn" | "good";
type MemberWorkflowStage = "missing_form" | "needs_ai" | "needs_finalize" | "needs_reward" | "done";
type WorkflowStepState = "todo" | "doing" | "done";

interface MemberWorkflowSummary {
    stage: MemberWorkflowStage;
    label: string;
    tone: WorkflowTone;
    nextAction: string;
    description: string;
}

interface WorkflowStepCard {
    title: string;
    state: WorkflowStepState;
    helper: string;
}

function buildPathCalculationRuns(calculations: PathRewardCalculationSnapshot[]): PathCalculationRun[] {
    const runMap = new Map<string, PathCalculationRun>();

    for (const snapshot of calculations) {
        const input = snapshot.input_snapshot || {};
        const result = snapshot.result_snapshot || {};
        const existing = runMap.get(snapshot.proposal_id);
        const member: PathCalculationMember = {
            member_id: snapshot.member_id,
            name:
                typeof input.name === "string" && input.name.trim().length > 0
                    ? input.name
                    : `${snapshot.member_id.slice(0, 8)}...`,
            work_days: toFiniteNumber(input.work_days),
            level: typeof input.level === "string" ? input.level : "-",
            A: toFiniteNumber(input.A),
            R: toFiniteNumber(input.R),
            Q: toFiniteNumber(input.Q),
            monthly_point_total: toFiniteNumber(result.monthly_point_total),
            monthly_coefficient: toFiniteNumber(result.monthly_coefficient),
            base_reward: toFiniteNumber(result.base_reward),
            variable_reward: toFiniteNumber(result.variable_reward),
            total_reward: toFiniteNumber(result.total_reward),
        };

        if (!existing) {
            runMap.set(snapshot.proposal_id, {
                proposal_id: snapshot.proposal_id,
                month: snapshot.month,
                finalized_at: snapshot.finalized_at,
                calculation_version: snapshot.calculation_version,
                profit_amount: toFiniteNumber(result.profit_amount),
                base_pool_amount: toFiniteNumber(result.base_pool_amount),
                variable_pool_amount: toFiniteNumber(result.variable_pool_amount),
                total_amount: member.total_reward,
                members: [member],
            });
            continue;
        }

        existing.total_amount += member.total_reward;
        existing.members.push(member);
    }

    return Array.from(runMap.values())
        .map((run) => ({
            ...run,
            members: run.members.sort((a, b) => b.total_reward - a.total_reward),
        }))
        .sort((a, b) => new Date(b.finalized_at).getTime() - new Date(a.finalized_at).getTime());
}

export function PathTab() {
    const shouldReduceMotion = useReducedMotion();
    const [period, setPeriod] = useState(currentMonthValue);
    const [members, setMembers] = useState<Member[]>([]);
    const [forms, setForms] = useState<PathMonthlyEvaluationForm[]>([]);
    const [reviews, setReviews] = useState<PathMonthlyEvaluationAiReview[]>([]);
    const [confirmations, setConfirmations] = useState<PathMonthlyEvaluationConfirmation[]>([]);
    const [finalizations, setFinalizations] = useState<PathMonthlyEvaluationFinalization[]>([]);
    const [profiles, setProfiles] = useState<PathSkillProfile[]>([]);
    const [certifications, setCertifications] = useState<PathSkillCertification[]>([]);
    const [pathCalculations, setPathCalculations] = useState<PathRewardCalculationSnapshot[]>([]);
    const [luqoCalculations, setLuqoCalculations] = useState<LUQORewardCalculation[]>([]);
    const [selectedMemberId, setSelectedMemberId] = useState("");
    const [formInput, setFormInput] = useState<PathMonthlyEvaluationFormInput>(() =>
        buildInitialFormInput(currentMonthValue(), ""),
    );
    const [roleInput, setRoleInput] = useState("");
    const [siteInput, setSiteInput] = useState("");
    const [finalizeStates, setFinalizeStates] = useState<Record<PathBigSkillKey, PathBigSkillState>>(
        () => buildInitialFinalizeStates(),
    );
    const [finalizeLevel, setFinalizeLevel] = useState("");
    const [finalizeWorkDays, setFinalizeWorkDays] = useState(0);
    const [finalizeA, setFinalizeA] = useState(1);
    const [finalizeR, setFinalizeR] = useState(1);
    const [finalizeQ, setFinalizeQ] = useState(1);
    const [finalizeComment, setFinalizeComment] = useState("");
    const [skillKey, setSkillKey] = useState("");
    const [skillCategory, setSkillCategory] = useState("");
    const [skillStatus, setSkillStatus] = useState<PathCertificationStatus>("verified");
    const [skillEvidenceCount, setSkillEvidenceCount] = useState(1);
    const [skillNote, setSkillNote] = useState("");
    const [skillReviewRequired, setSkillReviewRequired] = useState(false);
    const [rewardProfitInputs, setRewardProfitInputs] = useState<PathRewardProfitInputs>(() =>
        buildInitialRewardProfitInputs(),
    );
    const [rewardMembers, setRewardMembers] = useState<RewardMemberDraft[]>(() => [buildEmptyRewardMember()]);
    const [rewardPreview, setRewardPreview] = useState<PathRewardPreview | null>(null);
    const [loading, setLoading] = useState(true);
    const [submittingForm, setSubmittingForm] = useState(false);
    const [submittingFinalize, setSubmittingFinalize] = useState(false);
    const [submittingCertification, setSubmittingCertification] = useState(false);
    const [previewingReward, setPreviewingReward] = useState(false);
    const [submittingReward, setSubmittingReward] = useState(false);
    const [generatingReview, setGeneratingReview] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const [
                membersRes,
                formsRes,
                reviewsRes,
                confirmationsRes,
                finalizationsRes,
                profilesRes,
                certificationsRes,
                pathCalculationsRes,
                luqoCalculationsRes,
            ] = await Promise.all([
                fetchMembers(),
                fetchPathForms({ month: period, limit: 200 }),
                fetchPathAiReviews({ month: period, limit: 200 }),
                fetchPathConfirmations({ month: period, limit: 200 }),
                fetchPathFinalizations({ month: period, limit: 200 }),
                fetchPathProfiles({ limit: 200 }),
                fetchPathCertifications({ limit: 200 }),
                fetchPathRewardCalculations({ month: period, limit: 200 }),
                fetchLUQORewardCalculations({ period }),
            ]);

            setMembers(membersRes);
            setForms(formsRes.forms);
            setReviews(reviewsRes.reviews);
            setConfirmations(confirmationsRes.confirmations);
            setFinalizations(finalizationsRes.finalizations);
            setProfiles(profilesRes.profiles);
            setCertifications(certificationsRes.certifications);
            setPathCalculations(pathCalculationsRes.calculations);
            setLuqoCalculations(luqoCalculationsRes.calculations);

            const candidateIds = Array.from(new Set([
                ...membersRes.map((member) => member.id),
                ...formsRes.forms.map((item) => item.member_id),
                ...reviewsRes.reviews.map((item) => item.member_id),
                ...finalizationsRes.finalizations.map((item) => item.member_id),
                ...profilesRes.profiles.map((item) => item.member_id),
                ...certificationsRes.certifications.map((item) => item.member_id),
            ]));

            setSelectedMemberId((current) =>
                current && candidateIds.includes(current) ? current : candidateIds[0] || "",
            );
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "PATHデータの読み込みに失敗しました");
        } finally {
            setLoading(false);
        }
    }, [period]);

    useEffect(() => {
        void load();
    }, [load]);

    const memberMap = useMemo(
        () => new Map(members.map((member) => [member.id, member])),
        [members],
    );
    const formMap = useMemo(
        () => new Map(forms.map((form) => [form.member_id, form])),
        [forms],
    );
    const reviewMap = useMemo(
        () => new Map(reviews.map((review) => [review.member_id, review])),
        [reviews],
    );
    const finalizationMap = useMemo(
        () => new Map(finalizations.map((finalization) => [finalization.member_id, finalization])),
        [finalizations],
    );
    const profileMap = useMemo(
        () => new Map(profiles.map((profile) => [profile.member_id, profile])),
        [profiles],
    );

    const memberIds = useMemo(
        () =>
            Array.from(
                new Set([
                    ...members.map((member) => member.id),
                    ...forms.map((item) => item.member_id),
                    ...reviews.map((item) => item.member_id),
                    ...finalizations.map((item) => item.member_id),
                    ...profiles.map((item) => item.member_id),
                    ...certifications.map((item) => item.member_id),
                ]),
            ),
        [members, forms, reviews, finalizations, profiles, certifications],
    );
    const rewardCandidateIds = useMemo(
        () =>
            Array.from(
                new Set([
                    ...finalizations.map((item) => item.member_id),
                    ...forms.map((item) => item.member_id),
                    ...reviews.map((item) => item.member_id),
                    ...confirmations.map((item) => item.member_id),
                ]),
            ),
        [finalizations, forms, reviews, confirmations],
    );

    const selectedForm = forms.find((item) => item.member_id === selectedMemberId);
    const selectedReview = reviews.find((item) => item.member_id === selectedMemberId);
    const selectedFinalization = finalizations.find((item) => item.member_id === selectedMemberId);
    const selectedProfile = profiles.find((item) => item.member_id === selectedMemberId);
    const selectedConfirmations = confirmations.filter((item) => item.member_id === selectedMemberId);
    const selectedCertifications = certifications.filter((item) => item.member_id === selectedMemberId);
    const selectedVerifiedCertifications = selectedCertifications.filter((item) => item.status === "verified");
    const selectedReviewCertificationCount = selectedCertifications.filter((item) => item.review_required_flag).length;
    const selectedCertificationHighlights = selectedVerifiedCertifications.slice(0, 3);

    useEffect(() => {
        setFinalizeStates(buildInitialFinalizeStates(selectedReview, selectedFinalization, selectedProfile));
        setFinalizeLevel(selectedFinalization?.current_level || selectedProfile?.current_level || "");
        setFinalizeWorkDays(selectedFinalization?.work_days || 0);
        setFinalizeA(selectedFinalization?.A ?? 1);
        setFinalizeR(selectedFinalization?.R ?? 1);
        setFinalizeQ(selectedFinalization?.Q ?? 1);
        setFinalizeComment(selectedFinalization?.comment || selectedConfirmations[0]?.comment || "");
    }, [selectedMemberId, selectedReview, selectedFinalization, selectedProfile, selectedConfirmations]);

    useEffect(() => {
        const nextForm = buildInitialFormInput(period, selectedMemberId, selectedForm);
        setFormInput(nextForm);
        setRoleInput(joinCsv(nextForm.selected_roles));
        setSiteInput(joinCsv(nextForm.site_ids));
    }, [period, selectedMemberId, selectedForm]);

    useEffect(() => {
        const seedIds =
            rewardCandidateIds.length > 0
                ? rewardCandidateIds
                : selectedMemberId
                  ? [selectedMemberId]
                  : [];

        setRewardMembers((current) => {
            const currentById = new Map(
                current
                    .filter((item) => item.member_id)
                    .map((item) => [item.member_id, item] as const),
            );
            const seededRows = seedIds.map(
                (memberId) =>
                    currentById.get(memberId) ||
                    buildRewardMemberDraft(memberId, memberMap, finalizationMap, profileMap),
            );
            const manualRows = current.filter(
                (item) => item.member_id && !seedIds.includes(item.member_id),
            );

            if (seededRows.length === 0 && manualRows.length === 0) {
                return [buildEmptyRewardMember()];
            }

            return [...seededRows, ...manualRows];
        });
        setRewardPreview(null);
    }, [rewardCandidateIds, selectedMemberId, memberMap, finalizationMap, profileMap]);

    const pathCalculationRuns = useMemo(
        () => buildPathCalculationRuns(pathCalculations),
        [pathCalculations],
    );
    const currentMonthPathRun = useMemo(
        () => pathCalculationRuns.find((run) => run.month === period) || null,
        [pathCalculationRuns, period],
    );
    const currentMonthRewardMemberIds = useMemo(
        () => new Set(currentMonthPathRun?.members.map((member) => member.member_id) || []),
        [currentMonthPathRun],
    );
    const latestPathCalculation = pathCalculationRuns[0] || null;
    const latestLuqoCalculation = luqoCalculations[0] || null;
    const getMemberWorkflow = useCallback(
        (memberId: string): MemberWorkflowSummary => {
            const form = formMap.get(memberId);
            const review = reviewMap.get(memberId);
            const finalization = finalizationMap.get(memberId);
            const rewardDone = currentMonthRewardMemberIds.has(memberId);

            if (rewardDone) {
                return {
                    stage: "done",
                    label: "報酬確認済み",
                    tone: "good",
                    nextAction: "完了",
                    description: "今月の評価と報酬確認は完了しています。",
                };
            }

            if (finalization) {
                return {
                    stage: "needs_reward",
                    label: "評価確定済み",
                    tone: "info",
                    nextAction: "報酬確認",
                    description: "評価は確定済みです。今月の報酬確認に進めます。",
                };
            }

            if (review?.review_required_flag) {
                return {
                    stage: "needs_finalize",
                    label: "確認待ち",
                    tone: "warn",
                    nextAction: "内容確認",
                    description: "AI下書きに未確認ポイントがあります。確認して評価を確定します。",
                };
            }

            if (review) {
                return {
                    stage: "needs_finalize",
                    label: "AI下書き済み",
                    tone: "info",
                    nextAction: "評価確定",
                    description: "AIが下書きを整理済みです。内容を見て今月の評価を確定します。",
                };
            }

            if (form) {
                return {
                    stage: "needs_ai",
                    label: "入力済み",
                    tone: "neutral",
                    nextAction: "AI下書き",
                    description: "今月の入力は保存済みです。AI整理を作ると確認が進めやすくなります。",
                };
            }

            return {
                stage: "missing_form",
                label: "未入力",
                tone: "warn",
                nextAction: "今月の入力",
                description: "まずは今月の作業内容を入力して、評価の土台を作ります。",
            };
        },
        [currentMonthRewardMemberIds, finalizationMap, formMap, reviewMap],
    );
    const queueSummary = useMemo(
        () =>
            memberIds.reduce(
                (acc, memberId) => {
                    const workflow = getMemberWorkflow(memberId);

                    if (workflow.stage === "missing_form") acc.missingForm += 1;
                    if (workflow.stage === "needs_ai") acc.needsAi += 1;
                    if (workflow.stage === "needs_finalize") acc.needsFinalize += 1;
                    if (workflow.stage === "needs_reward") acc.needsReward += 1;
                    if (workflow.stage === "done") acc.done += 1;

                    return acc;
                },
                {
                    missingForm: 0,
                    needsAi: 0,
                    needsFinalize: 0,
                    needsReward: 0,
                    done: 0,
                },
            ),
        [getMemberWorkflow, memberIds],
    );
    const rewardComparisonRows = useMemo(() => {
        if (!latestPathCalculation && !latestLuqoCalculation) {
            return [];
        }

        const pathMemberMap = new Map(
            latestPathCalculation?.members.map((member) => [member.member_id, member] as const) || [],
        );
        const luqoMemberMap = new Map(
            latestLuqoCalculation?.breakdown.map((member) => [member.member_id, member] as const) || [],
        );
        const memberIds = Array.from(new Set([
            ...pathMemberMap.keys(),
            ...luqoMemberMap.keys(),
        ]));

        return memberIds
            .map((memberId) => {
                const pathMember = pathMemberMap.get(memberId);
                const luqoMember = luqoMemberMap.get(memberId);
                const memberName =
                    memberMap.get(memberId)?.full_name ||
                    memberMap.get(memberId)?.username ||
                    pathMember?.name ||
                    luqoMember?.name ||
                    `${memberId.slice(0, 8)}...`;
                const pathAmount = pathMember?.total_reward || 0;
                const luqoAmount = luqoMember?.amount || 0;

                return {
                    member_id: memberId,
                    name: memberName,
                    pathAmount,
                    luqoAmount,
                    delta: pathAmount - luqoAmount,
                };
            })
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    }, [latestLuqoCalculation, latestPathCalculation, memberMap]);
    const comparisonDeltaTotal = useMemo(
        () => rewardComparisonRows.reduce((sum, row) => sum + row.delta, 0),
        [rewardComparisonRows],
    );
    const selectedMemberWorkflow = useMemo(
        () => (selectedMemberId ? getMemberWorkflow(selectedMemberId) : null),
        [getMemberWorkflow, selectedMemberId],
    );
    const selectedWorkflowSteps = useMemo<WorkflowStepCard[]>(() => {
        if (!selectedMemberId) {
            return [];
        }

        const rewardDone = currentMonthRewardMemberIds.has(selectedMemberId);

        return [
            {
                title: "1. 今月の入力",
                state: selectedForm ? "done" : "doing",
                helper: selectedForm
                    ? "保存済み。必要なら内容を見直せます。"
                    : "今月の作業内容をまず残します。",
            },
            {
                title: "2. AI下書き",
                state: selectedReview ? "done" : selectedForm ? "doing" : "todo",
                helper: selectedReview
                    ? "AIが候補を整理済みです。"
                    : selectedForm
                      ? "入力後にAIで確認用の下書きを作れます。"
                      : "今月の入力を保存すると進められます。",
            },
            {
                title: "3. 評価を確定",
                state: selectedFinalization ? "done" : selectedForm || selectedReview ? "doing" : "todo",
                helper: selectedFinalization
                    ? "今月の評価は確定済みです。"
                    : "AI候補と現場確認を見て確定します。",
            },
            {
                title: "4. 報酬を確認",
                state: rewardDone ? "done" : selectedFinalization ? "doing" : "todo",
                helper: rewardDone
                    ? "今月の報酬確認まで完了しています。"
                    : selectedFinalization
                      ? "評価確定後の値で試算と申請を行います。"
                      : "評価確定後に進めます。",
            },
        ];
    }, [
        currentMonthRewardMemberIds,
        selectedFinalization,
        selectedForm,
        selectedMemberId,
        selectedReview,
    ]);
    const motionProps = shouldReduceMotion
        ? { initial: false as const, animate: { opacity: 1 } }
        : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

    const updateRewardMember = useCallback(
        (index: number, updater: (current: RewardMemberDraft) => RewardMemberDraft) => {
            setRewardPreview(null);
            setRewardMembers((current) =>
                current.map((item, itemIndex) => (itemIndex === index ? updater(item) : item)),
            );
        },
        [],
    );

    const addRewardMember = useCallback(() => {
        setRewardPreview(null);
        setRewardMembers((current) => [...current, buildEmptyRewardMember()]);
    }, []);

    const removeRewardMember = useCallback((index: number) => {
        setRewardPreview(null);
        setRewardMembers((current) => {
            const next = current.filter((_, itemIndex) => itemIndex !== index);
            return next.length > 0 ? next : [buildEmptyRewardMember()];
        });
    }, []);

    const buildRewardRequest = useCallback(() => {
        const activeMembers = rewardMembers.filter(
            (item) =>
                item.member_id ||
                item.name.trim().length > 0 ||
                item.work_days > 0 ||
                item.level ||
                item.A !== 1 ||
                item.R !== 1 ||
                item.Q !== 1,
        );

        if (activeMembers.length === 0) {
            throw new Error("報酬計算の対象メンバーを追加してください");
        }

        const seenIds = new Set<string>();
        const normalizedMembers = activeMembers.map((item, index) => {
            if (!item.member_id) {
                throw new Error(`メンバー${index + 1}のIDを選択してください`);
            }
            if (seenIds.has(item.member_id)) {
                throw new Error("同じメンバーが重複しています");
            }
            seenIds.add(item.member_id);
            if (!item.name.trim()) {
                throw new Error(`メンバー${index + 1}の名前を入力してください`);
            }
            if (!item.level) {
                throw new Error(`メンバー${index + 1}のLevelを選択してください`);
            }

            return {
                member_id: item.member_id,
                name: item.name.trim(),
                work_days: Number(item.work_days),
                level: item.level as PathLevel,
                A: Number(item.A),
                R: Number(item.R),
                Q: Number(item.Q),
            };
        });

        return {
            month: period,
            profit_inputs: rewardProfitInputs,
            members: normalizedMembers,
        };
    }, [period, rewardMembers, rewardProfitInputs]);

    const handleFinalizeSubmit = async () => {
        if (!selectedMemberId) {
            setError("対象メンバーを選択してください");
            return;
        }

        setSubmittingFinalize(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await createPathFinalizeProposal({
                month: period,
                member_id: selectedMemberId,
                confirmed_states: finalizeStates,
                work_days: finalizeWorkDays,
                A: finalizeA,
                R: finalizeR,
                Q: finalizeQ,
                current_level: finalizeLevel ? (finalizeLevel as typeof PATH_LEVEL_OPTIONS[number]) : null,
                comment: finalizeComment.trim() || undefined,
            });

            setSuccess(`評価確定の申請を作成しました: ${result.proposal.id.slice(0, 8)}...`);
            await load();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "評価確定の申請作成に失敗しました");
        } finally {
            setSubmittingFinalize(false);
        }
    };

    const handleFormSubmit = async () => {
        if (!selectedMemberId) {
            setError("対象メンバーを選択してください");
            return;
        }

        setSubmittingForm(true);
        setError(null);
        setSuccess(null);

        try {
            await savePathForm({
                ...formInput,
                month: period,
                member_id: selectedMemberId,
                selected_roles: splitCsv(roleInput),
                site_ids: splitCsv(siteInput),
            });

            setSuccess(`月末フォームを保存しました: ${displayMemberName(selectedMemberId, memberMap)}`);
            await load();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "月末フォームの保存に失敗しました");
        } finally {
            setSubmittingForm(false);
        }
    };

    const handleCertificationSubmit = async () => {
        if (!selectedMemberId || !skillKey.trim() || !skillCategory.trim()) {
            setError("対象メンバー・技能キー・カテゴリを入力してください");
            return;
        }

        setSubmittingCertification(true);
        setError(null);
        setSuccess(null);

        try {
            const action = skillStatus === "revoked" ? "revoke" : "achieve";
            const result = await createPathSkillProposal({
                action,
                member_id: selectedMemberId,
                skill_key: skillKey.trim(),
                category: skillCategory.trim(),
                status: skillStatus,
                evidence_count: skillEvidenceCount,
                note: skillNote.trim() || undefined,
                review_required_flag: skillReviewRequired,
            });

            setSuccess(`技能認定の申請を作成しました: ${result.proposal.id.slice(0, 8)}...`);
            setSkillKey("");
            setSkillCategory("");
            setSkillStatus("verified");
            setSkillEvidenceCount(1);
            setSkillNote("");
            setSkillReviewRequired(false);
            await load();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "技能認定の申請作成に失敗しました");
        } finally {
            setSubmittingCertification(false);
        }
    };

    const handleRewardPreview = async () => {
        setPreviewingReward(true);
        setError(null);
        setSuccess(null);

        try {
            const preview = await previewPathReward(buildRewardRequest());
            setRewardPreview(preview);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "PATH報酬プレビューの取得に失敗しました");
        } finally {
            setPreviewingReward(false);
        }
    };

    const handleRewardProposalSubmit = async () => {
        setSubmittingReward(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await createPathRewardProposal(buildRewardRequest());
            setRewardPreview(result.preview);
            setSuccess(`今月の報酬申請を作成しました: ${result.proposal.id.slice(0, 8)}...`);
            await load();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "今月の報酬申請作成に失敗しました");
        } finally {
            setSubmittingReward(false);
        }
    };

    const handleAiReviewGenerate = async () => {
        if (!selectedMemberId) {
            setError("対象メンバーを選択してください");
            return;
        }
        if (!selectedForm) {
            setError("AI整理の前に月末フォームを保存してください");
            return;
        }

        setGeneratingReview(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await generatePathAiReview({
                month: period,
                member_id: selectedMemberId,
            });
            setSuccess(`AIの下書きを保存しました (${result.provider}): ${displayMemberName(selectedMemberId, memberMap)}`);
            await load();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "AI下書きの作成に失敗しました");
        } finally {
            setGeneratingReview(false);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.toolbar}>
                <div>
                    <h3 className={styles.sectionTitle}>今月の評価</h3>
                    <p className={styles.sectionDescription}>
                        今月の入力、AI下書き、評価確定、報酬確認を順に進めます。詳細なプロフィールや技能認定は下の詳細セクションで扱います。
                    </p>
                </div>
                <div className={styles.toolbarActions}>
                    <input
                        className={styles.monthInput}
                        type="month"
                        value={period}
                        onChange={(event) => setPeriod(event.target.value)}
                    />
                    <button className={styles.ghostButton} onClick={() => void load()} disabled={loading}>
                        <RefreshCw size={14} />
                    </button>
                </div>
            </div>

            {error && <div className={styles.error}>{error}</div>}
            {success && <div className={styles.success}>{success}</div>}

            <div className={styles.summaryGrid}>
                <div className={styles.summaryCard}>
                    <ClipboardCheck size={16} />
                    <div>
                        <strong>{queueSummary.missingForm}</strong>
                        <span>今月の入力待ち</span>
                    </div>
                </div>
                <div className={styles.summaryCard}>
                    <Sparkles size={16} />
                    <div>
                        <strong>{queueSummary.needsAi}</strong>
                        <span>AI下書き待ち</span>
                    </div>
                </div>
                <div className={styles.summaryCard}>
                    <Send size={16} />
                    <div>
                        <strong>{queueSummary.needsFinalize}</strong>
                        <span>評価確定待ち</span>
                    </div>
                </div>
                <div className={styles.summaryCard}>
                    <Award size={16} />
                    <div>
                        <strong>{queueSummary.needsReward}</strong>
                        <span>報酬確認待ち</span>
                    </div>
                </div>
            </div>

            <div className={styles.layout}>
                <aside className={styles.memberRail}>
                    <div className={styles.memberRailHeader}>今月の対象メンバー</div>
                    {loading && <div className={styles.emptyState}>読み込み中...</div>}
                    {!loading && memberIds.length === 0 && (
                        <div className={styles.emptyState}>PATH データがまだありません。</div>
                    )}
                    {memberIds.map((memberId) => {
                        const workflow = getMemberWorkflow(memberId);

                        return (
                            <button
                                key={memberId}
                                className={`${styles.memberButton} ${selectedMemberId === memberId ? styles.memberButtonActive : ""}`}
                                onClick={() => setSelectedMemberId(memberId)}
                            >
                                <strong>{displayMemberName(memberId, memberMap)}</strong>
                                <span>{memberId.slice(0, 8)}...</span>
                                <div className={styles.memberMeta}>
                                    <span className={`${styles.statusBadge} ${styles[`status${workflow.tone[0].toUpperCase()}${workflow.tone.slice(1)}`]}`}>
                                        {workflow.label}
                                    </span>
                                </div>
                                <p className={styles.memberActionHint}>次: {workflow.nextAction}</p>
                            </button>
                        );
                    })}
                </aside>

                <section className={styles.workspace}>
                    {!selectedMemberId && !loading && (
                        <div className={styles.emptyState}>左からメンバーを選ぶと、今月の評価を始められます。</div>
                    )}

                    {selectedMemberId && (
                        <>
                            <motion.div className={styles.card} {...motionProps}>
                                <div className={styles.cardHeader}>
                                    <div>
                                        <h4>{displayMemberName(selectedMemberId, memberMap)}</h4>
                                        <p>メンバーID: {selectedMemberId}</p>
                                    </div>
                                    <div className={styles.headerActionCluster}>
                                        {selectedProfile?.current_level && (
                                            <span className={styles.levelBadge}>Level {selectedProfile.current_level}</span>
                                        )}
                                        {selectedMemberWorkflow && (
                                            <span className={`${styles.statusBadge} ${styles[`status${selectedMemberWorkflow.tone[0].toUpperCase()}${selectedMemberWorkflow.tone.slice(1)}`]}`}>
                                                {selectedMemberWorkflow.label}
                                            </span>
                                        )}
                                        <button
                                            className={styles.ghostButton}
                                            type="button"
                                            onClick={() => void handleAiReviewGenerate()}
                                            disabled={generatingReview || !selectedForm}
                                            title={selectedForm ? "フォームと現在のprofileからAI整理を生成" : "月末フォームが必要です"}
                                        >
                                            <Sparkles size={14} />
                                            {generatingReview
                                                ? "生成中..."
                                                : selectedReview
                                                  ? "AI下書きを更新"
                                                  : "AI下書きを作る"}
                                        </button>
                                    </div>
                                </div>

                                {selectedMemberWorkflow && (
                                    <div className={styles.workflowCallout}>
                                        <div>
                                            <span className={styles.infoLabel}>次にやること</span>
                                            <strong>{selectedMemberWorkflow.nextAction}</strong>
                                        </div>
                                        <p>{selectedMemberWorkflow.description}</p>
                                    </div>
                                )}

                                <div className={styles.profilePeek}>
                                    <div className={styles.profilePeekMeta}>
                                        <span className={styles.infoLabel}>プロフィールは settings へ</span>
                                        <strong>
                                            {selectedProfile?.current_level
                                                ? `現在 Level ${selectedProfile.current_level}`
                                                : "Level は未設定"}
                                        </strong>
                                        <p>
                                            認定済み技能 {selectedVerifiedCertifications.length} 件
                                            {" / "}
                                            要レビュー {selectedReviewCertificationCount} 件
                                            {" / "}
                                            6項目の現在値と認定履歴は settings に集約しています
                                        </p>
                                    </div>
                                    <Link to="/settings" className={styles.inlineLinkButton}>
                                        マイプロフィール
                                    </Link>
                                </div>

                                <div className={styles.workflowStepGrid}>
                                    {selectedWorkflowSteps.map((step) => (
                                        <div
                                            key={step.title}
                                            className={`${styles.workflowStepCard} ${styles[`workflowStep${step.state[0].toUpperCase()}${step.state.slice(1)}`]}`}
                                        >
                                            <span className={styles.workflowStepState}>
                                                {step.state === "done"
                                                    ? "完了"
                                                    : step.state === "doing"
                                                      ? "進行中"
                                                      : "待ち"}
                                            </span>
                                            <strong>{step.title}</strong>
                                            <p>{step.helper}</p>
                                        </div>
                                    ))}
                                </div>

                                {selectedReview ? (
                                    <>
                                        <p className={styles.narrative}>{selectedReview.monthly_summary}</p>
                                        <div className={styles.badgeRow}>
                                            {selectedReview.review_required_flag && (
                                                <span className={`${styles.badge} ${styles.badgeWarm}`}>要レビュー</span>
                                            )}
                                            {selectedReview.promotion_candidate_flag && (
                                                <span className={`${styles.badge} ${styles.badgeGood}`}>昇格候補</span>
                                            )}
                                            {selectedReview.candidate_skill_tags.map((tag) => (
                                                <span key={tag} className={styles.badge}>{tag}</span>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <p className={styles.mutedText}>
                                        AIの下書きはまだありません。今月の入力を保存すると、確認用の下書きを作れます。
                                    </p>
                                )}

                                {selectedForm && (
                                    <div className={styles.infoGrid}>
                                        <div>
                                            <span className={styles.infoLabel}>役割</span>
                                            <strong>{selectedForm.selected_roles.join(" / ") || "-"}</strong>
                                        </div>
                                        <div>
                                            <span className={styles.infoLabel}>現場ID</span>
                                            <strong>{selectedForm.site_ids.join(", ") || "-"}</strong>
                                        </div>
                                        <div>
                                            <span className={styles.infoLabel}>写真提出</span>
                                            <strong>{selectedForm.photo_flag ? "あり" : "なし"}</strong>
                                        </div>
                                        <div>
                                            <span className={styles.infoLabel}>手直し</span>
                                            <strong>{selectedForm.rework_flag}</strong>
                                        </div>
                                    </div>
                                )}
                            </motion.div>

                            <div className={styles.card}>
                                <div className={styles.cardHeader}>
                                    <div>
                                        <h4>1. 今月の入力</h4>
                                        <p>今月の作業内容を残します。ここで保存した内容をもとに、AI下書きと評価確定を進めます。</p>
                                    </div>
                                    {selectedForm?.submitted_at && (
                                        <span className={styles.metaBadge}>
                                            更新 {new Date(selectedForm.submitted_at).toLocaleDateString("ja-JP")}
                                        </span>
                                    )}
                                </div>

                                <div className={styles.selectGrid}>
                                    {PATH_BIG_SKILL_KEYS.map((key) => (
                                        <label key={`form-${key}`} className={styles.field}>
                                            <span>{BIG_SKILL_LABELS[key]}</span>
                                            <select
                                                className={styles.select}
                                                value={formInput.selected_big_skill_states?.[key] || "unverified"}
                                                onChange={(event) =>
                                                    setFormInput((current) => ({
                                                        ...current,
                                                        selected_big_skill_states: {
                                                            ...current.selected_big_skill_states,
                                                            [key]: event.target.value as PathBigSkillState,
                                                        },
                                                    }))
                                                }
                                            >
                                                {PATH_BIG_SKILL_STATE_OPTIONS.map((option) => (
                                                    <option key={option} value={option}>
                                                        {BIG_SKILL_STATE_LABELS[option]}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    ))}
                                </div>

                                <div className={styles.inputGrid}>
                                    <label className={styles.field}>
                                        <span>担当ロール</span>
                                        <input
                                            className={styles.input}
                                            value={roleInput}
                                            onChange={(event) => setRoleInput(event.target.value)}
                                            placeholder="主担当, 段取り, 応援"
                                        />
                                    </label>
                                    <label className={styles.field}>
                                        <span>現場ID</span>
                                        <input
                                            className={styles.input}
                                            value={siteInput}
                                            onChange={(event) => setSiteInput(event.target.value)}
                                            placeholder="site-001, site-002"
                                        />
                                    </label>
                                </div>

                                <div className={styles.inputGridTwo}>
                                    <label className={styles.checkboxCard}>
                                        <input
                                            type="checkbox"
                                            checked={Boolean(formInput.photo_flag)}
                                            onChange={(event) =>
                                                setFormInput((current) => ({
                                                    ...current,
                                                    photo_flag: event.target.checked,
                                                }))
                                            }
                                        />
                                        <span>写真を提出した</span>
                                    </label>

                                    <label className={styles.field}>
                                        <span>手直しフラグ</span>
                                        <select
                                            className={styles.select}
                                            value={formInput.rework_flag || "none"}
                                            onChange={(event) =>
                                                setFormInput((current) => ({
                                                    ...current,
                                                    rework_flag: event.target.value as NonNullable<PathMonthlyEvaluationForm["rework_flag"]>,
                                                }))
                                            }
                                        >
                                            {Object.entries(REWORK_FLAG_LABELS).map(([value, label]) => (
                                                <option key={value} value={value}>
                                                    {label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>

                                <label className={styles.field}>
                                    <span>月末コメント</span>
                                    <textarea
                                        className={styles.textarea}
                                        value={formInput.comment || ""}
                                        onChange={(event) =>
                                            setFormInput((current) => ({
                                                ...current,
                                                comment: event.target.value,
                                            }))
                                        }
                                        placeholder="今月できたこと、未確認のこと、次月に見てほしい点"
                                    />
                                </label>

                                <div className={styles.actionRow}>
                                    <button
                                        className={styles.primaryButton}
                                        onClick={() => void handleFormSubmit()}
                                        disabled={submittingForm}
                                    >
                                        <ClipboardCheck size={14} />
                                        {submittingForm ? "保存中..." : "月末フォームを保存"}
                                    </button>
                                </div>
                            </div>

                            <div className={styles.card}>
                                <div className={styles.cardHeader}>
                                    <div>
                                        <h4>3. 評価を確定する</h4>
                                        <p>AI下書きと現場確認を見て、今月の評価を確定します。</p>
                                    </div>
                                    <span className={styles.metaBadge}>主作業</span>
                                </div>
                                <div className={styles.selectGrid}>
                                    {PATH_BIG_SKILL_KEYS.map((key) => (
                                        <label key={key} className={styles.field}>
                                            <span>{BIG_SKILL_LABELS[key]}</span>
                                            <select
                                                className={styles.select}
                                                value={finalizeStates[key]}
                                                onChange={(event) =>
                                                    setFinalizeStates((current) => ({
                                                        ...current,
                                                        [key]: event.target.value as PathBigSkillState,
                                                    }))
                                                }
                                            >
                                                {PATH_BIG_SKILL_STATE_OPTIONS.map((option) => (
                                                    <option key={option} value={option}>
                                                        {BIG_SKILL_STATE_LABELS[option]}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    ))}
                                </div>

                                <div className={styles.inputGrid}>
                                    <label className={styles.field}>
                                        <span>反映 Level</span>
                                        <select
                                            className={styles.select}
                                            value={finalizeLevel}
                                            onChange={(event) => setFinalizeLevel(event.target.value)}
                                        >
                                            <option value="">変更なし</option>
                                            {PATH_LEVEL_OPTIONS.map((level) => (
                                                <option key={level} value={level}>
                                                    {level}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>

                                <div className={styles.rewardMemberGrid}>
                                    <label className={styles.field}>
                                        <span>確定稼働日数</span>
                                        <input
                                            className={styles.input}
                                            type="number"
                                            min={0}
                                            value={finalizeWorkDays}
                                            onChange={(event) => setFinalizeWorkDays(Number(event.target.value) || 0)}
                                        />
                                    </label>
                                    <label className={styles.field}>
                                        <span>A</span>
                                        <select
                                            className={styles.select}
                                            value={finalizeA}
                                            onChange={(event) => setFinalizeA(Number(event.target.value))}
                                        >
                                            {[0, 1, 2].map((score) => (
                                                <option key={`finalize-A-${score}`} value={score}>
                                                    {score}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className={styles.field}>
                                        <span>R</span>
                                        <select
                                            className={styles.select}
                                            value={finalizeR}
                                            onChange={(event) => setFinalizeR(Number(event.target.value))}
                                        >
                                            {[0, 1, 2].map((score) => (
                                                <option key={`finalize-R-${score}`} value={score}>
                                                    {score}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className={styles.field}>
                                        <span>Q</span>
                                        <select
                                            className={styles.select}
                                            value={finalizeQ}
                                            onChange={(event) => setFinalizeQ(Number(event.target.value))}
                                        >
                                            {[0, 1, 2].map((score) => (
                                                <option key={`finalize-Q-${score}`} value={score}>
                                                    {score}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>

                                <label className={styles.field}>
                                    <span>レビューコメント</span>
                                    <textarea
                                        className={styles.textarea}
                                        value={finalizeComment}
                                        onChange={(event) => setFinalizeComment(event.target.value)}
                                        placeholder="例: 品質安定は near_independent で確認。教育支援は次月継続確認。"
                                    />
                                </label>

                                <div className={styles.actionRow}>
                                    <button
                                        className={styles.primaryButton}
                                        onClick={() => void handleFinalizeSubmit()}
                                        disabled={submittingFinalize}
                                    >
                                        <Send size={14} />
                                        {submittingFinalize ? "送信中..." : "評価を確定する"}
                                    </button>
                                </div>
                            </div>

                            <div className={styles.card}>
                                <div className={styles.cardHeader}>
                                    <div>
                                        <h4>4. 今月の報酬を確認する</h4>
                                        <p>
                                            評価確定後の値をもとに、今月の配分を試算して報酬申請へ進めます。
                                        </p>
                                    </div>
                                    <span className={styles.metaBadge}>最終確認</span>
                                </div>

                                <div className={styles.profitGrid}>
                                    <label className={styles.field}>
                                        <span>売上</span>
                                        <input
                                            className={styles.input}
                                            type="number"
                                            min={0}
                                            value={rewardProfitInputs.sales}
                                            onChange={(event) => {
                                                setRewardPreview(null);
                                                setRewardProfitInputs((current) => ({
                                                    ...current,
                                                    sales: Number(event.target.value) || 0,
                                                }));
                                            }}
                                        />
                                    </label>
                                    <label className={styles.field}>
                                        <span>外注費</span>
                                        <input
                                            className={styles.input}
                                            type="number"
                                            min={0}
                                            value={rewardProfitInputs.outsourcing_cost}
                                            onChange={(event) => {
                                                setRewardPreview(null);
                                                setRewardProfitInputs((current) => ({
                                                    ...current,
                                                    outsourcing_cost: Number(event.target.value) || 0,
                                                }));
                                            }}
                                        />
                                    </label>
                                    <label className={styles.field}>
                                        <span>材料費</span>
                                        <input
                                            className={styles.input}
                                            type="number"
                                            min={0}
                                            value={rewardProfitInputs.materials_cost}
                                            onChange={(event) => {
                                                setRewardPreview(null);
                                                setRewardProfitInputs((current) => ({
                                                    ...current,
                                                    materials_cost: Number(event.target.value) || 0,
                                                }));
                                            }}
                                        />
                                    </label>
                                    <label className={styles.field}>
                                        <span>駐車場代</span>
                                        <input
                                            className={styles.input}
                                            type="number"
                                            min={0}
                                            value={rewardProfitInputs.parking_cost}
                                            onChange={(event) => {
                                                setRewardPreview(null);
                                                setRewardProfitInputs((current) => ({
                                                    ...current,
                                                    parking_cost: Number(event.target.value) || 0,
                                                }));
                                            }}
                                        />
                                    </label>
                                    <label className={styles.field}>
                                        <span>交通費</span>
                                        <input
                                            className={styles.input}
                                            type="number"
                                            min={0}
                                            value={rewardProfitInputs.transport_cost}
                                            onChange={(event) => {
                                                setRewardPreview(null);
                                                setRewardProfitInputs((current) => ({
                                                    ...current,
                                                    transport_cost: Number(event.target.value) || 0,
                                                }));
                                            }}
                                        />
                                    </label>
                                    <label className={styles.field}>
                                        <span>その他直接費</span>
                                        <input
                                            className={styles.input}
                                            type="number"
                                            min={0}
                                            value={rewardProfitInputs.other_direct_cost}
                                            onChange={(event) => {
                                                setRewardPreview(null);
                                                setRewardProfitInputs((current) => ({
                                                    ...current,
                                                    other_direct_cost: Number(event.target.value) || 0,
                                                }));
                                            }}
                                        />
                                    </label>
                                    <label className={styles.field}>
                                        <span>共通原価</span>
                                        <input
                                            className={styles.input}
                                            type="number"
                                            min={0}
                                            value={rewardProfitInputs.common_cost}
                                            onChange={(event) => {
                                                setRewardPreview(null);
                                                setRewardProfitInputs((current) => ({
                                                    ...current,
                                                    common_cost: Number(event.target.value) || 0,
                                                }));
                                            }}
                                        />
                                    </label>
                                    <label className={styles.field}>
                                        <span>積立</span>
                                        <input
                                            className={styles.input}
                                            type="number"
                                            min={0}
                                            value={rewardProfitInputs.reserve_amount}
                                            onChange={(event) => {
                                                setRewardPreview(null);
                                                setRewardProfitInputs((current) => ({
                                                    ...current,
                                                    reserve_amount: Number(event.target.value) || 0,
                                                }));
                                            }}
                                        />
                                    </label>
                                </div>

                                <div className={styles.rewardHint}>
                                    稼働日数は手入力、A/R/Q は未確定時に中立値 1/1/1 を初期値にしています。
                                </div>

                                <div className={styles.rewardMemberList}>
                                    {rewardMembers.map((item, index) => (
                                        <div key={`${item.member_id || "new"}-${index}`} className={styles.rewardMemberCard}>
                                            <div className={styles.rewardMemberHeader}>
                                                <strong>対象 {index + 1}</strong>
                                                <button
                                                    className={styles.inlineGhostButton}
                                                    type="button"
                                                    onClick={() => removeRewardMember(index)}
                                                    disabled={rewardMembers.length === 1}
                                                >
                                                    削除
                                                </button>
                                            </div>

                                            <div className={styles.rewardMemberGrid}>
                                                <label className={styles.field}>
                                                    <span>メンバー</span>
                                                    <select
                                                        className={styles.select}
                                                        value={item.member_id}
                                                        onChange={(event) =>
                                                            updateRewardMember(index, () =>
                                                                event.target.value
                                                                    ? buildRewardMemberDraft(
                                                                          event.target.value,
                                                                          memberMap,
                                                                          finalizationMap,
                                                                          profileMap,
                                                                      )
                                                                    : buildEmptyRewardMember(),
                                                            )
                                                        }
                                                    >
                                                        <option value="">選択してください</option>
                                                        {memberIds.map((memberId) => (
                                                            <option key={memberId} value={memberId}>
                                                                {displayMemberName(memberId, memberMap)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>

                                                <label className={styles.field}>
                                                    <span>表示名</span>
                                                    <input
                                                        className={styles.input}
                                                        value={item.name}
                                                        onChange={(event) =>
                                                            updateRewardMember(index, (current) => ({
                                                                ...current,
                                                                name: event.target.value,
                                                            }))
                                                        }
                                                        placeholder="山田 太郎"
                                                    />
                                                </label>

                                                <label className={styles.field}>
                                                    <span>稼働日数</span>
                                                    <input
                                                        className={styles.input}
                                                        type="number"
                                                        min={0}
                                                        value={item.work_days}
                                                        onChange={(event) =>
                                                            updateRewardMember(index, (current) => ({
                                                                ...current,
                                                                work_days: Number(event.target.value) || 0,
                                                            }))
                                                        }
                                                    />
                                                </label>

                                                <label className={styles.field}>
                                                    <span>Level</span>
                                                    <select
                                                        className={styles.select}
                                                        value={item.level}
                                                        onChange={(event) =>
                                                            updateRewardMember(index, (current) => ({
                                                                ...current,
                                                                level: event.target.value as PathLevel | "",
                                                            }))
                                                        }
                                                    >
                                                        <option value="">選択してください</option>
                                                        {PATH_LEVEL_OPTIONS.map((level) => (
                                                            <option key={`${item.member_id}-${level}`} value={level}>
                                                                {level}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>

                                                <label className={styles.field}>
                                                    <span>A</span>
                                                    <select
                                                        className={styles.select}
                                                        value={item.A}
                                                        onChange={(event) =>
                                                            updateRewardMember(index, (current) => ({
                                                                ...current,
                                                                A: Number(event.target.value),
                                                            }))
                                                        }
                                                    >
                                                        {[0, 1, 2].map((score) => (
                                                            <option key={`A-${score}`} value={score}>
                                                                {score}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>

                                                <label className={styles.field}>
                                                    <span>R</span>
                                                    <select
                                                        className={styles.select}
                                                        value={item.R}
                                                        onChange={(event) =>
                                                            updateRewardMember(index, (current) => ({
                                                                ...current,
                                                                R: Number(event.target.value),
                                                            }))
                                                        }
                                                    >
                                                        {[0, 1, 2].map((score) => (
                                                            <option key={`R-${score}`} value={score}>
                                                                {score}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>

                                                <label className={styles.field}>
                                                    <span>Q</span>
                                                    <select
                                                        className={styles.select}
                                                        value={item.Q}
                                                        onChange={(event) =>
                                                            updateRewardMember(index, (current) => ({
                                                                ...current,
                                                                Q: Number(event.target.value),
                                                            }))
                                                        }
                                                    >
                                                        {[0, 1, 2].map((score) => (
                                                            <option key={`Q-${score}`} value={score}>
                                                                {score}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className={styles.rewardActions}>
                                    <button className={styles.ghostButton} type="button" onClick={addRewardMember}>
                                        <Calculator size={14} />
                                        メンバー行を追加
                                    </button>
                                    <div className={styles.actionRowCompact}>
                                        <button
                                            className={styles.ghostButton}
                                            type="button"
                                            onClick={() => void handleRewardPreview()}
                                            disabled={previewingReward}
                                        >
                                            <Calculator size={14} />
                                            {previewingReward ? "計算中..." : "報酬を試算する"}
                                        </button>
                                        <button
                                            className={styles.primaryButton}
                                            type="button"
                                            onClick={() => void handleRewardProposalSubmit()}
                                            disabled={submittingReward}
                                        >
                                            <Send size={14} />
                                            {submittingReward ? "送信中..." : "報酬申請を作成する"}
                                        </button>
                                    </div>
                                </div>

                                {rewardPreview && (
                                    <motion.div className={styles.rewardPreview} {...motionProps}>
                                        <div className={styles.rewardSummaryGrid}>
                                            <div className={styles.rewardSummaryCard}>
                                                <span>利益</span>
                                                <strong>{formatCurrency(rewardPreview.profit_amount)}</strong>
                                            </div>
                                            <div className={styles.rewardSummaryCard}>
                                                <span>固定配分</span>
                                                <strong>{formatCurrency(rewardPreview.base_pool_amount)}</strong>
                                            </div>
                                            <div className={styles.rewardSummaryCard}>
                                                <span>変動配分</span>
                                                <strong>{formatCurrency(rewardPreview.variable_pool_amount)}</strong>
                                            </div>
                                            <div className={styles.rewardSummaryCard}>
                                                <span>合計</span>
                                                <strong>{formatCurrency(rewardPreview.total_amount)}</strong>
                                            </div>
                                        </div>

                                        <div className={styles.rewardTableWrap}>
                                            <table className={styles.rewardTable}>
                                                <thead>
                                                    <tr>
                                                        <th>メンバー</th>
                                                        <th>日数</th>
                                                        <th>Level</th>
                                                        <th>A/R/Q</th>
                                                        <th>月次pt</th>
                                                        <th>係数</th>
                                                        <th>固定</th>
                                                        <th>変動</th>
                                                        <th>支給額</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {rewardPreview.members.map((item) => (
                                                        <tr key={item.member_id}>
                                                            <td>{item.name}</td>
                                                            <td>{item.work_days}</td>
                                                            <td>{item.level}</td>
                                                            <td>{`${item.A}/${item.R}/${item.Q}`}</td>
                                                            <td>{item.monthly_point_total}</td>
                                                            <td>{item.monthly_coefficient.toFixed(1)}</td>
                                                            <td>{formatCurrency(item.base_reward)}</td>
                                                            <td>{formatCurrency(item.variable_reward)}</td>
                                                            <td className={styles.amountCell}>
                                                                {formatCurrency(item.total_reward)}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </motion.div>
                                )}
                            </div>

                            <details className={styles.advancedSection}>
                                <summary className={styles.advancedSummary}>
                                    <div className={styles.advancedSummaryCopy}>
                                        <span className={styles.infoLabel}>詳細</span>
                                        <strong>プロフィールと確認メモ</strong>
                                    </div>
                                    <span className={styles.metaBadge}>任意</span>
                                </summary>
                                <div className={styles.advancedBody}>
                                    <div className={styles.card}>
                                        <h4 className={styles.cardTitle}>確認メモ</h4>
                                        {selectedConfirmations.length === 0 && (
                                            <p className={styles.mutedText}>まだ確認メモはありません。</p>
                                        )}
                                        <div className={styles.logList}>
                                            {selectedConfirmations.slice(0, 6).map((item) => (
                                                <div key={item.id} className={styles.logItem}>
                                                    <div>
                                                        <strong>{item.target_key}</strong>
                                                        <span>{item.confirmation_status}</span>
                                                    </div>
                                                    <p>{item.comment || "コメントなし"}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {selectedReview?.unknown_points?.length ? (
                                        <div className={styles.card}>
                                            <h4 className={styles.cardTitle}>未確認ポイント</h4>
                                            <ul className={styles.bulletList}>
                                                {selectedReview.unknown_points.map((item, index) => (
                                                    <li key={`${selectedMemberId}-unknown-${index}`}>{toPlainText(item)}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    ) : null}
                                </div>
                            </details>

                            <details className={styles.advancedSection}>
                                <summary className={styles.advancedSummary}>
                                    <div className={styles.advancedSummaryCopy}>
                                        <span className={styles.infoLabel}>詳細</span>
                                        <strong>技能認定とLUQO比較</strong>
                                    </div>
                                    <span className={styles.metaBadge}>管理用</span>
                                </summary>
                                <div className={styles.advancedBody}>
                                    <div className={styles.card}>
                                        <div className={styles.cardHeader}>
                                            <div>
                                                <h4>LUQOとの差分確認</h4>
                                                <p>同月の最新 PATH と LUQO の結果を並べて、差分を確認します。</p>
                                            </div>
                                            <span className={styles.metaBadge}>
                                                {latestPathCalculation && latestLuqoCalculation ? "比較可能" : "比較待ち"}
                                            </span>
                                        </div>

                                        <div className={styles.comparisonMetaRow}>
                                            <div className={styles.comparisonMetaCard}>
                                                <span>PATH 最新</span>
                                                {latestPathCalculation ? (
                                                    <strong>
                                                        {formatDateTime(latestPathCalculation.finalized_at)} /{" "}
                                                        {latestPathCalculation.proposal_id.slice(0, 8)}
                                                    </strong>
                                                ) : (
                                                    <strong>未確定</strong>
                                                )}
                                            </div>
                                            <div className={styles.comparisonMetaCard}>
                                                <span>LUQO 最新</span>
                                                {latestLuqoCalculation ? (
                                                    <strong>
                                                        {formatDateTime(latestLuqoCalculation.created_at)} /{" "}
                                                        {(latestLuqoCalculation.proposal_id || "manual").slice(0, 8)}
                                                    </strong>
                                                ) : (
                                                    <strong>未確定</strong>
                                                )}
                                            </div>
                                            <div className={styles.comparisonMetaCard}>
                                                <span>比較対象月</span>
                                                <strong>{period}</strong>
                                            </div>
                                        </div>

                                        <div className={styles.comparisonSummaryGrid}>
                                            <div className={styles.comparisonSummaryCard}>
                                                <span>PATH 合計</span>
                                                <strong>{formatCurrency(latestPathCalculation?.total_amount || 0)}</strong>
                                            </div>
                                            <div className={styles.comparisonSummaryCard}>
                                                <span>LUQO 合計</span>
                                                <strong>{formatCurrency(latestLuqoCalculation?.distributable || 0)}</strong>
                                            </div>
                                            <div className={styles.comparisonSummaryCard}>
                                                <span>差分</span>
                                                <strong
                                                    className={
                                                        comparisonDeltaTotal > 0
                                                            ? styles.positiveDelta
                                                            : comparisonDeltaTotal < 0
                                                              ? styles.negativeDelta
                                                              : ""
                                                    }
                                                >
                                                    {formatCurrency(comparisonDeltaTotal)}
                                                </strong>
                                            </div>
                                        </div>

                                        {rewardComparisonRows.length === 0 ? (
                                            <div className={styles.emptyCompareState}>
                                                PATH snapshot または LUQO 報酬確定がまだないため、比較は保留です。
                                            </div>
                                        ) : (
                                            <div className={styles.comparisonTableWrap}>
                                                <table className={styles.comparisonTable}>
                                                    <thead>
                                                        <tr>
                                                            <th>メンバー</th>
                                                            <th>PATH</th>
                                                            <th>LUQO</th>
                                                            <th>差分</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {rewardComparisonRows.map((row) => (
                                                            <tr key={row.member_id}>
                                                                <td>{row.name}</td>
                                                                <td>{formatCurrency(row.pathAmount)}</td>
                                                                <td>{formatCurrency(row.luqoAmount)}</td>
                                                                <td
                                                                    className={
                                                                        row.delta > 0
                                                                            ? styles.positiveDelta
                                                                            : row.delta < 0
                                                                              ? styles.negativeDelta
                                                                              : ""
                                                                    }
                                                                >
                                                                    {formatCurrency(row.delta)}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>

                                    <div className={styles.doubleColumn}>
                                        <div className={styles.card}>
                                            <h4 className={styles.cardTitle}>詳細技能の認定</h4>
                                            <div className={styles.inputGrid}>
                                                <label className={styles.field}>
                                                    <span>技能キー</span>
                                                    <input
                                                        className={styles.input}
                                                        value={skillKey}
                                                        onChange={(event) => setSkillKey(event.target.value)}
                                                        placeholder="joint_finish"
                                                    />
                                                </label>
                                                <label className={styles.field}>
                                                    <span>カテゴリ</span>
                                                    <input
                                                        className={styles.input}
                                                        value={skillCategory}
                                                        onChange={(event) => setSkillCategory(event.target.value)}
                                                        placeholder="finish"
                                                    />
                                                </label>
                                                <label className={styles.field}>
                                                    <span>状態</span>
                                                    <select
                                                        className={styles.select}
                                                        value={skillStatus}
                                                        onChange={(event) => setSkillStatus(event.target.value as PathCertificationStatus)}
                                                    >
                                                        {PATH_CERTIFICATION_STATUS_OPTIONS.map((option) => (
                                                            <option key={option} value={option}>
                                                                {CERTIFICATION_STATUS_LABELS[option]}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label className={styles.field}>
                                                    <span>根拠件数</span>
                                                    <input
                                                        className={styles.input}
                                                        type="number"
                                                        min={0}
                                                        value={skillEvidenceCount}
                                                        onChange={(event) => setSkillEvidenceCount(Number(event.target.value))}
                                                    />
                                                </label>
                                            </div>

                                            <label className={styles.field}>
                                                <span>メモ</span>
                                                <textarea
                                                    className={styles.textarea}
                                                    value={skillNote}
                                                    onChange={(event) => setSkillNote(event.target.value)}
                                                    placeholder="認定根拠・差し戻し理由"
                                                />
                                            </label>

                                            <label className={styles.checkbox}>
                                                <input
                                                    type="checkbox"
                                                    checked={skillReviewRequired}
                                                    onChange={(event) => setSkillReviewRequired(event.target.checked)}
                                                />
                                                要レビューのまま保持する
                                            </label>

                                            <div className={styles.actionRow}>
                                                <button
                                                    className={styles.primaryButton}
                                                    onClick={() => void handleCertificationSubmit()}
                                                    disabled={submittingCertification}
                                                >
                                                    <Award size={14} />
                                                    {submittingCertification ? "送信中..." : "技能認定を申請する"}
                                                </button>
                                            </div>
                                        </div>

                                        <div className={styles.card}>
                                            <h4 className={styles.cardTitle}>認定履歴は設定で確認</h4>
                                            <p className={styles.mutedText}>
                                                最近の認定や 6つの主評価項目は、本人プロフィールに寄せています。
                                            </p>
                                            <div className={styles.profileTransferGrid}>
                                                <div className={styles.profileTransferStat}>
                                                    <span>認定済み</span>
                                                    <strong>{selectedVerifiedCertifications.length}件</strong>
                                                </div>
                                                <div className={styles.profileTransferStat}>
                                                    <span>要レビュー</span>
                                                    <strong>{selectedReviewCertificationCount}件</strong>
                                                </div>
                                            </div>
                                            {selectedCertificationHighlights.length > 0 && (
                                                <div className={styles.badgeRow}>
                                                    {selectedCertificationHighlights.map((item) => (
                                                        <span key={item.id} className={styles.badge}>
                                                            {formatSkillLabel(item.skill_key)}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            <p className={styles.profileTransferHint}>
                                                参照は `/settings` に集約し、PATH では今月の評価作業だけを進めます。
                                            </p>
                                            <Link to="/settings" className={styles.inlineLinkButton}>
                                                設定で確認する
                                            </Link>
                                        </div>
                                    </div>
                                </div>
                            </details>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}
