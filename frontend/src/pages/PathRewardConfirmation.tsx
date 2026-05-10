import { type ChangeEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RewardConfirmationExperience } from "../components/luqo/rewardConfirmation/RewardConfirmationExperience";
import { PathV33MonthFinalize } from "../components/PathV33MonthFinalize";
import { PathV33PersonalDashboard } from "../components/PathV33PersonalDashboard";
import { PathV33TeamFeedView } from "../components/PathV33TeamFeed";
import { supabase } from "../lib/supabase";
import {
    DEV_AUTH_USER_OPTIONS,
    getDevAuthUserKey,
    isDevAuthUiEnabled,
    setDevAuthUserKey,
    type DevAuthUserKey,
} from "../lib/devAuth";
import styles from "./PathRewardConfirmation.module.css";

type TabKey = "personal" | "team" | "finalize" | "reward";

const TAB_LABEL: Record<TabKey, string> = {
    personal: "個人",
    team: "チーム",
    finalize: "月確定",
    reward: "報酬確認",
};

function currentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function isTabKey(value: string | null): value is TabKey {
    return value === "personal" || value === "team" || value === "finalize" || value === "reward";
}

export default function PathRewardConfirmationPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [devUserKey, setDevUserKeyState] = useState<DevAuthUserKey | null>(() => getDevAuthUserKey());
    const [memberId, setMemberId] = useState<string>("");
    const period = searchParams.get("period");
    const siteId = searchParams.get("site");
    const memberQuery = searchParams.get("member");
    const tabParam = searchParams.get("tab");
    const activeTab: TabKey = isTabKey(tabParam) ? tabParam : "personal";
    const month = currentMonth();

    useEffect(() => {
        const next = new URLSearchParams(searchParams);
        if (next.has("reward")) {
            next.delete("reward");
            setSearchParams(next, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        let cancelled = false;
        void supabase.auth.getSession().then(({ data }) => {
            if (!cancelled) {
                setMemberId(data.session?.user.id ?? "");
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const handleDevUserChange = (event: ChangeEvent<HTMLSelectElement>) => {
        const nextUserKey = event.target.value as DevAuthUserKey;
        setDevAuthUserKey(nextUserKey);
        setDevUserKeyState(nextUserKey);
        window.location.reload();
    };

    const devUserFilter = isDevAuthUiEnabled() && devUserKey ? (
        <select
            className={styles.devAuthSelect}
            value={devUserKey}
            onChange={handleDevUserChange}
            aria-label="開発用ユーザーを選択"
        >
            {DEV_AUTH_USER_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                    {option.label}
                </option>
            ))}
        </select>
    ) : null;

    function switchTab(next: TabKey) {
        const params = new URLSearchParams(searchParams);
        if (next === "personal") {
            params.delete("tab");
        } else {
            params.set("tab", next);
        }
        setSearchParams(params, { replace: true });
    }

    return (
        <div className={styles.container}>
            <nav className={styles.tabRow} role="tablist" aria-label="PATH レベル表示">
                {(["personal", "team", "finalize", "reward"] as TabKey[]).map((key) => (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === key}
                        className={`${styles.tabButton} ${activeTab === key ? styles.tabActive : ""}`}
                        onClick={() => switchTab(key)}
                    >
                        {TAB_LABEL[key]}
                    </button>
                ))}
                {devUserFilter && <div className={styles.tabRowSpacer}>{devUserFilter}</div>}
            </nav>

            {activeTab === "personal" && memberId && (
                <PathV33PersonalDashboard memberId={memberId} month={month} />
            )}
            {activeTab === "personal" && !memberId && (
                <p className={styles.muted}>ログイン情報を読み込み中...</p>
            )}

            {activeTab === "team" && <PathV33TeamFeedView month={month} />}

            {activeTab === "finalize" && <PathV33MonthFinalize month={month} />}

            {activeTab === "reward" && (
                <RewardConfirmationExperience
                    initialPeriod={period}
                    focusSiteId={siteId}
                    focusMemberId={memberQuery}
                    metaAction={null}
                />
            )}
        </div>
    );
}
