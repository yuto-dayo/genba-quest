import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import type { CreateProposalInput } from "../services/ProposalService";
import type { ActorRef, ProposalType } from "../services/PolicyEngine";

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
const TARGET_EXPENSE_PROPOSALS = Number(process.env.SEED_TARGET_EXPENSE_PROPOSALS ?? 8);
const TARGET_ASSIGNMENT_PROPOSALS = Number(process.env.SEED_TARGET_ASSIGNMENT_PROPOSALS ?? 5);

const FALLBACK_SITE_ID = "33333333-3333-4333-8333-333333333333";
const FALLBACK_WORKER_IDS = [
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
];
const FALLBACK_APPROVER_IDS = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "66666666-6666-4666-8666-666666666666",
];

const EXPENSE_AMOUNTS = [1800, 3200, 4800, 7600, 12800, 24500, 35800, 52000];
const EXPENSE_CATEGORIES = ["material", "tool", "travel", "food", "other"] as const;

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface SeedSite {
    id: string;
    name: string | null;
}

interface SeedProfile {
    id: string;
    full_name: string | null;
    username: string | null;
}

interface ProposalSeedSummary {
    expenseCreated: number;
    assignmentCreated: number;
}

type ProposalServiceInstance = import("../services/ProposalService").ProposalService;

function isMissingProposalSchemaError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
        message.includes("public.proposals") ||
        message.includes("table 'proposals'") ||
        message.includes("Could not find the table 'proposals'")
    );
}

async function seed() {
    console.log("🌱 シードデータを投入中...\n");

    // クライアント
    const clients = [
        { name: "ABC建設株式会社", contact_person: "田中太郎", email: "tanaka@abc-kensetsu.co.jp" },
        { name: "山田工務店", contact_person: "山田花子", email: "yamada@yamada-komu.co.jp" },
        { name: "東京ハウジング", contact_person: "鈴木一郎", email: "suzuki@tokyo-housing.co.jp" },
    ];

    // 既存データ削除
    await supabase.from("sites").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("clients").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const { data: insertedClients, error: clientError } = await supabase
        .from("clients")
        .insert(clients)
        .select();

    if (clientError) {
        console.error("❌ クライアント挿入エラー:", clientError.message);
    } else {
        console.log(`✅ クライアント: ${insertedClients?.length}件`);
    }

    // 現場
    const sites = [
        {
            name: "渋谷タワー新築工事",
            address: "東京都渋谷区神南1-2-3",
            area_sqm: 1500,
            work_types: ["床", "クロス", "外壁"],
            estimated_hours: 240,
            actual_hours: 180,
            revenue: 2500000,
            status: "in_progress",
            client_id: insertedClients?.[0]?.id,
        },
        {
            name: "新宿オフィスリノベ",
            address: "東京都新宿区西新宿2-8-1",
            area_sqm: 800,
            work_types: ["床", "クロス"],
            estimated_hours: 120,
            actual_hours: 110,
            revenue: 1200000,
            status: "completed",
            client_id: insertedClients?.[1]?.id,
            completed_at: new Date().toISOString(),
        },
        {
            name: "品川マンション改修",
            address: "東京都品川区東品川4-12-6",
            area_sqm: 2000,
            work_types: ["外壁", "防水"],
            estimated_hours: 300,
            actual_hours: 50,
            revenue: 3500000,
            status: "in_progress",
            client_id: insertedClients?.[2]?.id,
        },
        {
            name: "目黒戸建て内装",
            address: "東京都目黒区自由が丘1-5-10",
            area_sqm: 150,
            work_types: ["クロス", "床"],
            estimated_hours: 40,
            actual_hours: 42,
            revenue: 450000,
            status: "completed",
            client_id: insertedClients?.[0]?.id,
            completed_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
            name: "池袋商業施設",
            address: "東京都豊島区東池袋3-1-1",
            area_sqm: 3000,
            work_types: ["床", "クロス", "外壁", "防水"],
            estimated_hours: 500,
            actual_hours: 0,
            revenue: 5000000,
            status: "in_progress",
            client_id: insertedClients?.[1]?.id,
        },
    ];

    const { data: insertedSites, error: siteError } = await supabase
        .from("sites")
        .insert(sites)
        .select();

    if (siteError) {
        console.error("❌ 現場挿入エラー:", siteError.message);
    } else {
        console.log(`✅ 現場: ${insertedSites?.length}件`);
    }

    // 開発用ユーザーをauth.usersに作成（存在しない場合）
    const devUsers = [
        { email: "tanaka@example.com", password: "password123", full_name: "田中太郎", username: "tanaka" },
        { email: "yamada@example.com", password: "password123", full_name: "山田花子", username: "yamada" },
        { email: "suzuki@example.com", password: "password123", full_name: "鈴木一郎", username: "suzuki" },
        { email: "sato@example.com", password: "password123", full_name: "佐藤次郎", username: "sato" },
    ];

    const createdUserIds: string[] = [];

    for (const user of devUsers) {
        // ユーザー作成
        const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
            email: user.email,
            password: user.password,
            email_confirm: true,
        });

        if (authError) {
            if (authError.message.includes("already been registered")) {
                // 既存ユーザーを取得
                const { data: existingUsers } = await supabase.auth.admin.listUsers();
                const existing = existingUsers?.users?.find(u => u.email === user.email);
                if (existing) {
                    createdUserIds.push(existing.id);
                }
            } else {
                console.error(`❌ ユーザー作成エラー (${user.email}):`, authError.message);
            }
            continue;
        }

        if (authUser?.user) {
            createdUserIds.push(authUser.user.id);
        }
    }

    // プロフィール作成
    const profiles = devUsers.map((user, index) => ({
        id: createdUserIds[index],
        full_name: user.full_name,
        username: user.username,
        stamina: [85, 45, 70, 25][index],
        holiday_days: [8, 12, 5, 15][index],
        holiday_target: 120,
        current_site_id: index < 2 ? insertedSites?.[index]?.id : null,
    })).filter(p => p.id);

    const { error: profileError } = await supabase
        .from("profiles")
        .upsert(profiles, { onConflict: "id" });

    if (profileError) {
        console.error("❌ プロフィール挿入エラー:", profileError.message);
    } else {
        console.log(`✅ プロフィール: ${profiles.length}件`);
    }

    const availableSites = await loadSites();
    const availableProfiles = await loadProfiles();

    try {
        const proposalSummary = await seedPhaseA0Proposals(availableSites, availableProfiles);
        console.log(
            `✅ Proposalログ: expense.create +${proposalSummary.expenseCreated}件 / assignment.create +${proposalSummary.assignmentCreated}件`
        );
    } catch (error) {
        if (isMissingProposalSchemaError(error)) {
            console.warn(
                "⚠️ proposals テーブル未適用のため Proposalログ投入をスキップしました。server/sql/011_proposals.sql と server/sql/012_policies.sql を適用してください。"
            );
        } else {
            throw error;
        }
    }

    console.log("\n🎉 シード完了！");
}

function buildHumanActor(profile: SeedProfile | undefined, fallbackId: string, fallbackName: string): ActorRef {
    if (!profile) {
        return {
            type: "human",
            id: fallbackId,
            name: fallbackName,
        };
    }

    return {
        type: "human",
        id: profile.id,
        name: profile.full_name || profile.username || fallbackName,
    };
}

function formatDateDaysAgo(daysAgo: number): string {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString().slice(0, 10);
}

async function loadSites(): Promise<SeedSite[]> {
    const { data, error } = await supabase
        .from("sites")
        .select("id, name");

    if (error) {
        throw new Error(`Failed to load sites for proposal seed: ${error.message}`);
    }

    return ((data || []) as SeedSite[]).filter((site) => typeof site.id === "string" && site.id.length > 0);
}

async function loadProfiles(): Promise<SeedProfile[]> {
    const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, username");

    if (error) {
        throw new Error(`Failed to load profiles for proposal seed: ${error.message}`);
    }

    return ((data || []) as SeedProfile[]).filter((profile) => typeof profile.id === "string" && profile.id.length > 0);
}

async function countProposalsByType(type: ProposalType): Promise<number> {
    const { count, error } = await supabase
        .from("proposals")
        .select("id", { count: "exact" })
        .limit(1)
        .eq("org_id", DEFAULT_ORG_ID)
        .eq("type", type);

    if (error) {
        throw new Error(`Failed to count ${type}: ${error.message}`);
    }

    return count || 0;
}

async function createAndExecuteProposal(
    proposalService: ProposalServiceInstance,
    input: CreateProposalInput,
    approvers: ActorRef[],
    executor: ActorRef
): Promise<void> {
    const submitted = await proposalService.createAndSubmit(input);
    let proposal = submitted.proposal;

    let approverIndex = 0;
    while (proposal.status === "pending" && approverIndex < approvers.length) {
        const approver = approvers[approverIndex];
        approverIndex += 1;

        try {
            const approved = await proposalService.approve(
                proposal.id,
                approver,
                "seed auto approval"
            );
            proposal = approved.proposal;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (
                message === "AI_SELF_APPROVAL_PROHIBITED" ||
                message === "AI_APPROVAL_NOT_ALLOWED_BY_POLICY" ||
                message === "ALREADY_APPROVED_BY_THIS_ACTOR"
            ) {
                continue;
            }
            throw error;
        }
    }

    if (proposal.status === "pending") {
        throw new Error(`Failed to approve seeded proposal: ${proposal.id}`);
    }

    if (proposal.status === "approved") {
        await proposalService.execute(proposal.id, executor);
    }
}

async function seedPhaseA0Proposals(
    sites: SeedSite[],
    profiles: SeedProfile[]
): Promise<ProposalSeedSummary> {
    const { ProposalService } = await import("../services/ProposalService");
    const proposalService = new ProposalService(DEFAULT_ORG_ID);

    const existingExpenseCount = await countProposalsByType("expense.create");
    const existingAssignmentCount = await countProposalsByType("assignment.create");

    const expenseToCreate = Math.max(TARGET_EXPENSE_PROPOSALS - existingExpenseCount, 0);
    const assignmentToCreate = Math.max(TARGET_ASSIGNMENT_PROPOSALS - existingAssignmentCount, 0);

    if (expenseToCreate === 0 && assignmentToCreate === 0) {
        console.log(
            `✅ Proposalログは目標件数を満たしています（expense.create ${TARGET_EXPENSE_PROPOSALS}件 / assignment.create ${TARGET_ASSIGNMENT_PROPOSALS}件）`
        );
        return { expenseCreated: 0, assignmentCreated: 0 };
    }

    const humanActors = [
        buildHumanActor(profiles[0], FALLBACK_APPROVER_IDS[0], "Seed Human 1"),
        buildHumanActor(profiles[1], FALLBACK_APPROVER_IDS[1], "Seed Human 2"),
        buildHumanActor(profiles[2], FALLBACK_APPROVER_IDS[2], "Seed Human 3"),
    ];

    const aiActor: ActorRef = {
        type: "ai",
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Sherpa Seed",
    };

    const executor: ActorRef = {
        type: "system",
        id: "99999999-9999-4999-8999-999999999999",
        name: "System Seed Executor",
    };

    const siteIds = sites.length > 0 ? sites.map((site) => site.id) : [FALLBACK_SITE_ID];
    const workerIds = profiles.length > 0 ? profiles.map((profile) => profile.id) : FALLBACK_WORKER_IDS;

    let createdExpense = 0;
    let createdAssignment = 0;

    for (let i = 0; i < expenseToCreate; i += 1) {
        const amount = EXPENSE_AMOUNTS[i % EXPENSE_AMOUNTS.length];
        const category = EXPENSE_CATEGORIES[i % EXPENSE_CATEGORIES.length];
        const siteId = siteIds[i % siteIds.length];
        const actor = humanActors[i % humanActors.length];

        const payload: Record<string, unknown> = {
            amount,
            amount_total: amount,
            category,
            site_id: siteId,
            recorded_date: formatDateDaysAgo(i),
            currency: "JPY",
            description: `シード経費 ${i + 1} (${category})`,
        };

        const input: CreateProposalInput = {
            org_id: DEFAULT_ORG_ID,
            type: "expense.create",
            payload,
            description: `シード経費登録 ¥${amount.toLocaleString()}`,
            created_by: actor,
        };

        await createAndExecuteProposal(proposalService, input, humanActors, executor);
        createdExpense += 1;
    }

    for (let i = 0; i < assignmentToCreate; i += 1) {
        const siteId = siteIds[i % siteIds.length];
        const primaryWorkerId = workerIds[i % workerIds.length];
        const secondaryWorkerId = workerIds[(i + 1) % workerIds.length];
        const assignmentWorkers = i % 2 === 0
            ? Array.from(new Set([primaryWorkerId, secondaryWorkerId]))
            : [primaryWorkerId];
        const creator = i % 3 === 0 ? aiActor : humanActors[i % humanActors.length];

        const payload: Record<string, unknown> = {
            site_id: siteId,
            worker_ids: assignmentWorkers,
            assigned_date: formatDateDaysAgo(i),
            note: `シードアサイン ${i + 1}`,
        };

        const input: CreateProposalInput = {
            org_id: DEFAULT_ORG_ID,
            type: "assignment.create",
            payload,
            description: `シードアサイン作成 (${assignmentWorkers.length}人)`,
            created_by: creator,
        };

        await createAndExecuteProposal(proposalService, input, humanActors, executor);
        createdAssignment += 1;
    }

    return {
        expenseCreated: createdExpense,
        assignmentCreated: createdAssignment,
    };
}

seed().catch(console.error);
