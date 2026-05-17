import { useEffect, useMemo, useState } from "react";
import { Edit3, History, Loader2, Save, ShieldCheck } from "lucide-react";
import {
    fetchTaxAccountMappings,
    updateTaxAccountMapping,
    type AccountMasterOption,
    type TaxAccountCategory,
    type TaxAccountMapping,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import styles from "./TaxMappingPanel.module.css";

type DraftState = {
    tax_account_code: string;
    tax_account_name: string;
    category: TaxAccountCategory;
    applicable_proposal_types: string;
    effective_from: string;
};

const CATEGORY_LABELS: Record<TaxAccountCategory, string> = {
    income: "収益",
    expense: "費用",
    asset: "資産",
    liability: "負債",
    equity: "純資産",
};

function todayDateOnly(): string {
    return new Date().toISOString().slice(0, 10);
}

function toTaxCategory(account: AccountMasterOption | undefined): TaxAccountCategory {
    if (!account) return "expense";
    return account.category === "revenue" ? "income" : account.category;
}

function toDraft(mapping: TaxAccountMapping): DraftState {
    return {
        tax_account_code: mapping.tax_account_code,
        tax_account_name: mapping.tax_account_name,
        category: mapping.category,
        applicable_proposal_types: mapping.applicable_proposal_types.join(", "),
        effective_from: todayDateOnly(),
    };
}

function formatDate(value: string | null): string {
    if (!value) return "継続中";
    return value;
}

interface TaxMappingPanelProps {
    isAdmin: boolean;
}

export function TaxMappingPanel({ isAdmin }: TaxMappingPanelProps) {
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [mappings, setMappings] = useState<TaxAccountMapping[]>([]);
    const [history, setHistory] = useState<TaxAccountMapping[]>([]);
    const [accounts, setAccounts] = useState<AccountMasterOption[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [historyLabel, setHistoryLabel] = useState<string | null>(null);
    const [draft, setDraft] = useState<DraftState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchTaxAccountMappings();
            setMappings(data.mappings);
            setHistory(data.history);
            setAccounts(data.accounts);
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isAdmin) {
            void load();
        }
    }, [isAdmin]);

    const historyRows = useMemo(
        () => history.filter((row) => row.display_label === historyLabel),
        [history, historyLabel],
    );

    const startEdit = (mapping: TaxAccountMapping) => {
        setEditingId(mapping.id);
        setDraft(toDraft(mapping));
        setError(null);
        setMessage(null);
    };

    const handleAccountCodeChange = (code: string) => {
        const account = accounts.find((candidate) => candidate.code === code);
        setDraft((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                tax_account_code: code,
                tax_account_name: account?.name ?? prev.tax_account_name,
                category: toTaxCategory(account),
            };
        });
    };

    const save = async (mapping: TaxAccountMapping) => {
        if (!draft) return;

        const applicableProposalTypes = draft.applicable_proposal_types
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);

        if (applicableProposalTypes.length === 0) {
            setError("適用範囲を1つ以上入れてください。");
            return;
        }

        setSavingId(mapping.id);
        setError(null);
        setMessage(null);
        try {
            await updateTaxAccountMapping(mapping.id, {
                tax_account_code: draft.tax_account_code,
                tax_account_name: draft.tax_account_name,
                category: draft.category,
                applicable_proposal_types: applicableProposalTypes,
                effective_from: draft.effective_from,
            });
            setEditingId(null);
            setDraft(null);
            setMessage(`${mapping.display_label} の対応を更新しました。`);
            await load();
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setSavingId(null);
        }
    };

    if (!isAdmin) {
        return null;
    }

    if (loading) {
        return (
            <div className={styles.centerState} role="status">
                <Loader2 size={16} className={styles.spinner} />
                確認中...
            </div>
        );
    }

    return (
        <div className={styles.panel}>
            <div className={styles.trustBanner}>
                <ShieldCheck size={18} />
                <div>
                    <strong>表示語と帳簿科目を分けて管理</strong>
                    <span>「手当」などの画面表示は残し、帳簿には法定科目コードだけを記録します。</span>
                </div>
            </div>

            {error && <p className={styles.errorMessage}>{error}</p>}
            {message && <p className={styles.successMessage}>{message}</p>}

            <div className={styles.mappingList}>
                {mappings.map((mapping) => {
                    const isEditing = editingId === mapping.id && draft;
                    const rowHistoryCount = history.filter((row) => row.display_label === mapping.display_label).length;
                    return (
                        <section className={styles.mappingRow} key={mapping.id}>
                            <div className={styles.mappingMain}>
                                <span className={styles.displayLabel}>{mapping.display_label}</span>
                                <span className={styles.accountCode}>{mapping.tax_account_code}</span>
                                <strong>{mapping.tax_account_name}</strong>
                                <span className={styles.categoryChip}>{CATEGORY_LABELS[mapping.category]}</span>
                            </div>
                            <div className={styles.scopeLine}>
                                <span>{mapping.applicable_proposal_types.join(" / ")}</span>
                                <span>{mapping.effective_from} から</span>
                            </div>

                            {isEditing && (
                                <div className={styles.editGrid}>
                                    <label>
                                        <span>科目コード</span>
                                        <select
                                            value={draft.tax_account_code}
                                            onChange={(event) => handleAccountCodeChange(event.target.value)}
                                        >
                                            {accounts.map((account) => (
                                                <option key={account.code} value={account.code}>
                                                    {account.code} {account.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>
                                        <span>科目名</span>
                                        <input
                                            value={draft.tax_account_name}
                                            onChange={(event) =>
                                                setDraft((prev) =>
                                                    prev ? { ...prev, tax_account_name: event.target.value } : prev,
                                                )
                                            }
                                        />
                                    </label>
                                    <label>
                                        <span>分類</span>
                                        <select
                                            value={draft.category}
                                            onChange={(event) =>
                                                setDraft((prev) =>
                                                    prev
                                                        ? { ...prev, category: event.target.value as TaxAccountCategory }
                                                        : prev,
                                                )
                                            }
                                        >
                                            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                                                <option key={value} value={value}>
                                                    {label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>
                                        <span>適用範囲</span>
                                        <input
                                            value={draft.applicable_proposal_types}
                                            onChange={(event) =>
                                                setDraft((prev) =>
                                                    prev
                                                        ? { ...prev, applicable_proposal_types: event.target.value }
                                                        : prev,
                                                )
                                            }
                                        />
                                    </label>
                                    <label>
                                        <span>開始日</span>
                                        <input
                                            type="date"
                                            value={draft.effective_from}
                                            onChange={(event) =>
                                                setDraft((prev) =>
                                                    prev ? { ...prev, effective_from: event.target.value } : prev,
                                                )
                                            }
                                        />
                                    </label>
                                </div>
                            )}

                            <div className={styles.rowActions}>
                                <button
                                    type="button"
                                    className={styles.secondaryAction}
                                    onClick={() =>
                                        setHistoryLabel(
                                            historyLabel === mapping.display_label ? null : mapping.display_label,
                                        )
                                    }
                                >
                                    <History size={14} />
                                    履歴 {rowHistoryCount}
                                </button>
                                {isEditing ? (
                                    <>
                                        <button
                                            type="button"
                                            className={styles.secondaryAction}
                                            onClick={() => {
                                                setEditingId(null);
                                                setDraft(null);
                                            }}
                                        >
                                            取消
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.primaryAction}
                                            onClick={() => void save(mapping)}
                                            disabled={savingId === mapping.id}
                                            aria-busy={savingId === mapping.id}
                                        >
                                            {savingId === mapping.id ? (
                                                <Loader2 size={14} className={styles.spinner} />
                                            ) : (
                                                <Save size={14} />
                                            )}
                                            保存
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        className={styles.primaryAction}
                                        onClick={() => startEdit(mapping)}
                                    >
                                        <Edit3 size={14} />
                                        編集
                                    </button>
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>

            {historyLabel && (
                <section className={styles.historyPanel}>
                    <div className={styles.historyHeader}>
                        <History size={16} />
                        <strong>{historyLabel} の履歴</strong>
                    </div>
                    <div className={styles.historyRows}>
                        {historyRows.map((row) => (
                            <div key={row.id} className={styles.historyRow}>
                                <span>{row.tax_account_code}</span>
                                <strong>{row.tax_account_name}</strong>
                                <span>{row.effective_from} - {formatDate(row.effective_until)}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
