import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, Loader2, Scale } from "lucide-react";
import {
    fetchMemberTaxClassification,
    type Member,
    type MemberContractType,
    type MemberTaxClassification,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import { ClassificationEditModal } from "./ClassificationEditModal";
import styles from "./ClassificationPanel.module.css";

type ClassificationByMember = Record<string, {
    active: MemberTaxClassification | null;
    history: MemberTaxClassification[];
}>;

function contractLabel(type: MemberContractType | null | undefined): string {
    if (type === "subcontract") return "外注";
    if (type === "employee_like") return "給与寄り";
    return "未判定";
}

function contractTone(type: MemberContractType | null | undefined): string {
    if (type === "subcontract") return styles.statusGood;
    if (type === "employee_like") return styles.statusRisk;
    return styles.statusMuted;
}

interface ClassificationPanelProps {
    members: Member[];
}

export function ClassificationPanel({ members }: ClassificationPanelProps) {
    const [classifications, setClassifications] = useState<ClassificationByMember>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedMember, setSelectedMember] = useState<Member | null>(null);

    const loadClassifications = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const entries = await Promise.all(
                members.map(async (member) => {
                    const result = await fetchMemberTaxClassification(member.id);
                    return [member.id, result] as const;
                }),
            );
            setClassifications(Object.fromEntries(entries));
        } catch (loadError: unknown) {
            setError(getErrorMessage(loadError));
        } finally {
            setLoading(false);
        }
    }, [members]);

    useEffect(() => {
        if (members.length > 0) {
            void loadClassifications();
        } else {
            setClassifications({});
        }
    }, [loadClassifications, members.length]);

    const selectedData = selectedMember ? classifications[selectedMember.id] : null;
    const counts = useMemo(() => {
        return members.reduce(
            (acc, member) => {
                const type = classifications[member.id]?.active?.contract_type ?? "undetermined";
                acc[type] += 1;
                return acc;
            },
            { subcontract: 0, employee_like: 0, undetermined: 0 },
        );
    }, [classifications, members]);

    return (
        <div className={styles.panel}>
            <header className={styles.header}>
                <div>
                    <p className={styles.eyebrow}>Tax</p>
                    <h3>契約区分管理</h3>
                    <p>5項目チェックで外注/給与寄りの根拠を残します。</p>
                </div>
                <Scale size={22} />
            </header>

            <div className={styles.summary}>
                <span>外注 {counts.subcontract}</span>
                <span>給与寄り {counts.employee_like}</span>
                <span>未判定 {counts.undetermined}</span>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            {loading ? (
                <div className={styles.emptyState}>
                    <Loader2 size={16} className={styles.spinner} />
                    確認中...
                </div>
            ) : members.length === 0 ? (
                <div className={styles.emptyState}>メンバーがいません</div>
            ) : (
                <div className={styles.memberList}>
                    {members.map((member) => {
                        const active = classifications[member.id]?.active ?? null;
                        const label = contractLabel(active?.contract_type);
                        const risky = active?.contract_type === "employee_like";
                        return (
                            <button
                                key={member.id}
                                type="button"
                                className={styles.memberRow}
                                onClick={() => setSelectedMember(member)}
                            >
                                <span>
                                    <strong>{member.display_name || member.full_name || member.username || "未設定"}</strong>
                                    <small>{active ? `${active.effective_from} から` : "未判定"}</small>
                                </span>
                                <span className={`${styles.statusChip} ${contractTone(active?.contract_type)}`}>
                                    {risky ? <AlertTriangle size={14} /> : <BadgeCheck size={14} />}
                                    {label}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            {selectedMember && (
                <ClassificationEditModal
                    member={selectedMember}
                    active={selectedData?.active ?? null}
                    history={selectedData?.history ?? []}
                    onClose={() => setSelectedMember(null)}
                    onSubmitted={() => void loadClassifications()}
                />
            )}
        </div>
    );
}
