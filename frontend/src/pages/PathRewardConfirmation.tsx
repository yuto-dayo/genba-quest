import { type ChangeEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RewardConfirmationExperience } from "../components/luqo/rewardConfirmation/RewardConfirmationExperience";
import {
    DEV_AUTH_USER_OPTIONS,
    getDevAuthUserKey,
    isDevAuthUiEnabled,
    setDevAuthUserKey,
    type DevAuthUserKey,
} from "../lib/devAuth";
import styles from "./PathRewardConfirmation.module.css";

export default function PathRewardConfirmationPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [devUserKey, setDevUserKeyState] = useState<DevAuthUserKey | null>(() => getDevAuthUserKey());
    const period = searchParams.get("period");
    const siteId = searchParams.get("site");
    const memberId = searchParams.get("member");

    useEffect(() => {
        const next = new URLSearchParams(searchParams);
        next.delete("reward");
        if (next.toString() !== searchParams.toString()) {
            setSearchParams(next, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const handleDevUserChange = (event: ChangeEvent<HTMLSelectElement>) => {
        const nextUserKey = event.target.value as DevAuthUserKey;
        setDevAuthUserKey(nextUserKey);
        setDevUserKeyState(nextUserKey);
        window.location.reload();
    };

    return (
        <div className={styles.container}>
            {isDevAuthUiEnabled() && devUserKey && (
                <div className={styles.devAuthBar}>
                    <span className={styles.devAuthLabel}>開発用ユーザー</span>
                    <select
                        className={styles.devAuthSelect}
                        value={devUserKey}
                        onChange={handleDevUserChange}
                        aria-label="開発用ユーザー"
                    >
                        {DEV_AUTH_USER_OPTIONS.map((option) => (
                            <option key={option.key} value={option.key}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </div>
            )}
            <RewardConfirmationExperience
                initialPeriod={period}
                focusSiteId={siteId}
                focusMemberId={memberId}
            />
        </div>
    );
}
