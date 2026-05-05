import { useEffect, useMemo, useState } from "react";
import styles from "./PathV31Tab.module.css";
import {
    createPathV31MonthlyDistributionProposal,
    createPathV31SiteCloseProposal,
    createPathV31SiteCloseReopenProposal,
    createPathV32SimpleMonthlyDistributionProposal,
    fetchPathV31DayLogs,
    fetchPathV31Experience,
    fetchPathV31SiteCloses,
    previewPathV31MonthlyDistribution,
    previewPathV32SimpleMonthlyDistribution,
    recommendPathV31LeadAssignment,
    type PathTradeFamily,
    type PathV31DayLog,
    type PathV31MonthlyDistributionPreview,
    type PathV31SiteClose,
    type PathV32SimpleMonthlyDistributionPreview,
} from "../../lib/api";

const TRADE_OPTIONS: Array<{ value: PathTradeFamily; label: string }> = [
    { value: "wall_finish", label: "壁装" },
    { value: "floor_finish", label: "床" },
    { value: "substrate_preparation", label: "下地" },
    { value: "decorative_sheet_or_film", label: "シート / フィルム" },
    { value: "common_site_operations", label: "共通作業" },
];

const TABS = [
    { key: "close", label: "現場締め" },
    { key: "monthly", label: "月次分配" },
    { key: "experience", label: "経験 / 主担当" },
] as const;

function todayValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate(),
    ).padStart(2, "0")}`;
}

function currentMonthValue() {
    return todayValue().slice(0, 7);
}

export function PathV31Tab() {
    const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["key"]>("monthly");
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dayLogs, setDayLogs] = useState<PathV31DayLog[]>([]);
    const [siteCloses, setSiteCloses] = useState<PathV31SiteClose[]>([]);
    const [monthlyPreview, setMonthlyPreview] = useState<PathV31MonthlyDistributionPreview | null>(null);
    const [monthlyV32Preview, setMonthlyV32Preview] = useState<PathV32SimpleMonthlyDistributionPreview | null>(null);
    const [experience, setExperience] = useState<Record<string, unknown> | null>(null);
    const [recommendation, setRecommendation] = useState<Record<string, unknown> | null>(null);

    const [siteCloseForm, setSiteCloseForm] = useState({
        site_id: "",
        included_day_log_ids: "",
        recognized_revenue: 0,
        material_cost: 0,
        external_cost: 0,
        direct_cost: 0,
        overhead_allocated: 0,
        known_rework_cost: 0,
        approved_adjustments: 0,
        difficulty_band: "S1" as "S1" | "S2" | "S3",
        share_mode: "auto_points" as "auto_points" | "fixed_template",
        fixed_template_key: "",
        fixed_template_reason_code: "",
    });

    const [monthlyMonth, setMonthlyMonth] = useState(currentMonthValue());
    const [reopenForm, setReopenForm] = useState({
        site_close_id: "",
        reason_code: "",
        note: "",
    });
    const [experienceMemberId, setExperienceMemberId] = useState("");
    const [recommendationForm, setRecommendationForm] = useState({
        date: todayValue(),
        site_id: "",
        trade_family: "wall_finish" as PathTradeFamily,
        difficulty_band: "S1" as "S1" | "S2" | "S3",
        risk_band: "low" as "low" | "medium" | "high",
        candidate_member_ids: "",
        chosen_member_id: "",
        override_reason_code: "",
    });

    const loadBase = async () => {
        const [logsResponse, closesResponse] = await Promise.all([
            fetchPathV31DayLogs({ limit: 40 }),
            fetchPathV31SiteCloses({ limit: 20 }),
        ]);
        setDayLogs(logsResponse.logs);
        setSiteCloses(closesResponse.site_closes);
    };

    useEffect(() => {
        void (async () => {
            try {
                setError(null);
                await loadBase();
                const [preview, v32Preview] = await Promise.all([
                    previewPathV31MonthlyDistribution(currentMonthValue()),
                    previewPathV32SimpleMonthlyDistribution(currentMonthValue()),
                ]);
                setMonthlyPreview(preview);
                setMonthlyV32Preview(v32Preview);
            } catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : "読み込みに失敗しました");
            }
        })();
    }, []);

    const selectableDayLogs = useMemo(
        () =>
            dayLogs.filter(
                (log) =>
                    log.site_id === siteCloseForm.site_id &&
                    !log.locked_by_site_close_id,
            ),
        [dayLogs, siteCloseForm.site_id],
    );

    const selectedDayLogIds = useMemo(
        () =>
            siteCloseForm.included_day_log_ids
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
        [siteCloseForm.included_day_log_ids],
    );

    const setFeedback = (nextStatus: string | null, nextError: string | null) => {
        setStatus(nextStatus);
        setError(nextError);
    };

    const handleFinalizeSiteClose = async () => {
        try {
            setFeedback("現場締め proposal を作成中...", null);
            await createPathV31SiteCloseProposal({
                ...siteCloseForm,
                included_day_log_ids: selectedDayLogIds,
            });
            await loadBase();
            setFeedback("現場締め proposal を作成しました。", null);
        } catch (requestError) {
            setFeedback(null, requestError instanceof Error ? requestError.message : "現場締めに失敗しました");
        }
    };

    const handleReopenSiteClose = async () => {
        try {
            setFeedback("reopen proposal を作成中...", null);
            await createPathV31SiteCloseReopenProposal(reopenForm);
            await loadBase();
            setFeedback("reopen proposal を作成しました。", null);
        } catch (requestError) {
            setFeedback(null, requestError instanceof Error ? requestError.message : "reopen に失敗しました");
        }
    };

    const handleRefreshMonthly = async () => {
        try {
            setFeedback("月次分配を再計算中...", null);
            const [preview, v32Preview] = await Promise.all([
                previewPathV31MonthlyDistribution(monthlyMonth),
                previewPathV32SimpleMonthlyDistribution(monthlyMonth),
            ]);
            setMonthlyPreview(preview);
            setMonthlyV32Preview(v32Preview);
            setFeedback("月次分配 preview を更新しました。", null);
        } catch (requestError) {
            setFeedback(null, requestError instanceof Error ? requestError.message : "preview に失敗しました");
        }
    };

    const handleCreateV32MonthlyProposal = async () => {
        try {
            setFeedback("V3.2 Simple proposal を作成中...", null);
            await createPathV32SimpleMonthlyDistributionProposal(monthlyMonth);
            const preview = await previewPathV32SimpleMonthlyDistribution(monthlyMonth);
            setMonthlyV32Preview(preview);
            setFeedback("V3.2 Simple proposal を作成しました。", null);
        } catch (requestError) {
            setFeedback(null, requestError instanceof Error ? requestError.message : "V3.2 proposal 作成に失敗しました");
        }
    };

    const handleCreateMonthlyProposal = async () => {
        try {
            setFeedback("月次分配 proposal を作成中...", null);
            await createPathV31MonthlyDistributionProposal(monthlyMonth);
            const preview = await previewPathV31MonthlyDistribution(monthlyMonth);
            setMonthlyPreview(preview);
            setFeedback("月次分配 proposal を作成しました。", null);
        } catch (requestError) {
            setFeedback(null, requestError instanceof Error ? requestError.message : "proposal 作成に失敗しました");
        }
    };

    const handleLoadExperience = async () => {
        try {
            setFeedback("経験台帳を読み込み中...", null);
            const response = await fetchPathV31Experience(experienceMemberId);
            setExperience(response as unknown as Record<string, unknown>);
            setFeedback("経験台帳を読み込みました。", null);
        } catch (requestError) {
            setFeedback(null, requestError instanceof Error ? requestError.message : "経験台帳の取得に失敗しました");
        }
    };

    const handleRecommend = async () => {
        try {
            setFeedback("主担当推薦を計算中...", null);
            const response = await recommendPathV31LeadAssignment({
                ...recommendationForm,
                candidate_member_ids: recommendationForm.candidate_member_ids
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                chosen_member_id: recommendationForm.chosen_member_id || null,
                override_reason_code: recommendationForm.override_reason_code || null,
            });
            setRecommendation(response);
            setFeedback("主担当推薦を更新しました。", null);
        } catch (requestError) {
            setFeedback(null, requestError instanceof Error ? requestError.message : "主担当推薦に失敗しました");
        }
    };

    return (
        <div className={styles.root}>
            <div className={styles.tabs}>
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        type="button"
                        className={`${styles.tabButton} ${activeTab === tab.key ? styles.tabButtonActive : ""}`}
                        onClick={() => setActiveTab(tab.key)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {status && <div className={styles.status}>{status}</div>}
            {error && <div className={`${styles.status} ${styles.error}`}>{error}</div>}
            <div className={styles.status}>
                今日の記録は Today 画面の各現場カードから入力してください。
            </div>

            {activeTab === "close" && (
                <section className={styles.card}>
                    <div className={styles.eyebrow}>PATH V3.1</div>
                    <div className={styles.titleRow}>
                        <div>
                            <h2 className={styles.title}>現場締め</h2>
                            <p className={styles.muted}>share_snapshot を凍結し、含まれる日次ログを lock します。</p>
                        </div>
                    </div>
                    <div className={styles.grid}>
                        <label className={styles.field}>
                            <span>現場ID</span>
                            <input className={styles.input} value={siteCloseForm.site_id} onChange={(event) => setSiteCloseForm((current) => ({ ...current, site_id: event.target.value }))} />
                        </label>
                        <label className={styles.field}>
                            <span>含める日次ログID</span>
                            <input className={styles.input} value={siteCloseForm.included_day_log_ids} onChange={(event) => setSiteCloseForm((current) => ({ ...current, included_day_log_ids: event.target.value }))} placeholder="id,id,id" />
                        </label>
                        <label className={styles.field}>
                            <span>share_mode</span>
                            <select className={styles.select} value={siteCloseForm.share_mode} onChange={(event) => setSiteCloseForm((current) => ({ ...current, share_mode: event.target.value as "auto_points" | "fixed_template" }))}>
                                <option value="auto_points">auto_points</option>
                                <option value="fixed_template">fixed_template</option>
                            </select>
                        </label>
                        <label className={styles.field}>
                            <span>difficulty_band</span>
                            <select className={styles.select} value={siteCloseForm.difficulty_band} onChange={(event) => setSiteCloseForm((current) => ({ ...current, difficulty_band: event.target.value as "S1" | "S2" | "S3" }))}>
                                <option value="S1">S1</option>
                                <option value="S2">S2</option>
                                <option value="S3">S3</option>
                            </select>
                        </label>
                        {["recognized_revenue","material_cost","external_cost","direct_cost","overhead_allocated","known_rework_cost","approved_adjustments"].map((key) => (
                            <label key={key} className={styles.field}>
                                <span>{key}</span>
                                <input className={styles.input} type="number" value={siteCloseForm[key as keyof typeof siteCloseForm] as number} onChange={(event) => setSiteCloseForm((current) => ({ ...current, [key]: Number(event.target.value) || 0 }))} />
                            </label>
                        ))}
                        <label className={styles.field}>
                            <span>fixed_template_key</span>
                            <input className={styles.input} value={siteCloseForm.fixed_template_key} onChange={(event) => setSiteCloseForm((current) => ({ ...current, fixed_template_key: event.target.value }))} />
                        </label>
                        <label className={styles.field}>
                            <span>fixed_template_reason_code</span>
                            <input className={styles.input} value={siteCloseForm.fixed_template_reason_code} onChange={(event) => setSiteCloseForm((current) => ({ ...current, fixed_template_reason_code: event.target.value }))} />
                        </label>
                    </div>
                    {selectableDayLogs.length > 0 && (
                        <div className={styles.inlineList}>
                            {selectableDayLogs.map((log) => (
                                <span key={log.id} className={styles.chip}>{log.id.slice(0, 8)} {log.member_id.slice(0, 8)} {log.role_type}</span>
                            ))}
                        </div>
                    )}
                    <div className={styles.actions}>
                        <button type="button" className={styles.button} onClick={handleFinalizeSiteClose}>現場締め proposal 作成</button>
                    </div>

                    <div className={styles.grid}>
                        <label className={styles.field}>
                            <span>reopen site_close_id</span>
                            <input className={styles.input} value={reopenForm.site_close_id} onChange={(event) => setReopenForm((current) => ({ ...current, site_close_id: event.target.value }))} />
                        </label>
                        <label className={styles.field}>
                            <span>reason_code</span>
                            <input className={styles.input} value={reopenForm.reason_code} onChange={(event) => setReopenForm((current) => ({ ...current, reason_code: event.target.value }))} />
                        </label>
                        <label className={styles.field}>
                            <span>note</span>
                            <input className={styles.input} value={reopenForm.note} onChange={(event) => setReopenForm((current) => ({ ...current, note: event.target.value }))} />
                        </label>
                    </div>
                    <div className={styles.actions}>
                        <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={handleReopenSiteClose}>reopen proposal</button>
                    </div>

                    <div className={styles.tableWrap}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>Closed At</th>
                                    <th>Site</th>
                                    <th>Profit</th>
                                    <th>Mode</th>
                                    <th>Rule</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {siteCloses.map((close) => (
                                    <tr key={close.id}>
                                        <td>{new Date(close.closed_at).toLocaleString("ja-JP")}</td>
                                        <td>{close.site_id}</td>
                                        <td>{close.distributable_profit.toLocaleString("ja-JP")}</td>
                                        <td>{close.share_mode}</td>
                                        <td>{close.path_rule_version}</td>
                                        <td>{close.status}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {activeTab === "monthly" && (
                <section className={styles.card}>
                    <div className={styles.eyebrow}>PATH V3.1</div>
                    <div className={styles.titleRow}>
                        <div>
                            <h2 className={styles.title}>月次分配</h2>
                            <p className={styles.muted}>pool は site close の `closed_at` 月で集計されます。</p>
                        </div>
                    </div>
                    <div className={styles.grid}>
                        <label className={styles.field}>
                            <span>month</span>
                            <input className={styles.input} type="month" value={monthlyMonth} onChange={(event) => setMonthlyMonth(event.target.value)} />
                        </label>
                    </div>
                    <div className={styles.actions}>
                        <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={handleRefreshMonthly}>preview 更新</button>
                        <button type="button" className={styles.button} onClick={handleCreateMonthlyProposal}>月次分配 proposal 作成</button>
                        <button type="button" className={styles.button} onClick={handleCreateV32MonthlyProposal}>V3.2 proposal 作成</button>
                    </div>
                    {monthlyV32Preview && (
                        <>
                            <div className={styles.inlineList}>
                                <span className={styles.chip}>V3.2 Simple</span>
                                <span className={styles.chip}>MonthlyPool {monthlyV32Preview.monthly_pool.toLocaleString("ja-JP")}</span>
                                <span className={styles.chip}>対象 {monthlyV32Preview.active_member_count}人</span>
                                <span className={styles.chip}>Weight {monthlyV32Preview.total_weight_num.toLocaleString("ja-JP")}</span>
                                {monthlyV32Preview.warnings.map((warning) => (
                                    <span key={warning} className={styles.chip}>{warning}</span>
                                ))}
                            </div>
                            <p className={styles.muted}>現場利益は現場別ではなく月間チーム成果として合算されています。</p>
                            <div className={styles.tableWrap}>
                                <table className={styles.table}>
                                    <thead>
                                        <tr>
                                            <th>Member</th>
                                            <th>Level</th>
                                            <th>稼働日</th>
                                            <th>稼働係数</th>
                                            <th>Weight</th>
                                            <th>Share</th>
                                            <th>チーム成果分配</th>
                                            <th>補正</th>
                                            <th>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {monthlyV32Preview.members.map((member) => (
                                            <tr key={member.member_id}>
                                                <td>{member.member_name}</td>
                                                <td>{member.level} / {member.level_weight_milli}</td>
                                                <td>{member.confirmed_work_days} / {member.month_total_days}日</td>
                                                <td>{(member.work_presence_bp / 100).toFixed(1)} / 100</td>
                                                <td>{member.monthly_weight_num.toLocaleString("ja-JP")}</td>
                                                <td>{(member.final_share_bp / 100).toFixed(2)}%</td>
                                                <td>{member.rounded_amount.toLocaleString("ja-JP")}</td>
                                                <td>{member.member_correction_amount.toLocaleString("ja-JP")}</td>
                                                <td>{member.total_pay_amount.toLocaleString("ja-JP")}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                    {monthlyPreview && (
                        <>
                            <div className={styles.inlineList}>
                                <span className={styles.chip}>Pool {monthlyPreview.pool_amount.toLocaleString("ja-JP")}</span>
                                <span className={styles.chip}>Floor {monthlyPreview.floor_rate}</span>
                                <span className={styles.chip}>Result {monthlyPreview.result_rate}</span>
                                <span className={styles.chip}>γ {monthlyPreview.nonlinear_exponent}</span>
                                <span className={styles.chip}>Rule {monthlyPreview.path_rule_version}</span>
                            </div>
                            <div className={styles.tableWrap}>
                                <table className={styles.table}>
                                    <thead>
                                        <tr>
                                            <th>Member</th>
                                            <th>Floor Units</th>
                                            <th>Floor</th>
                                            <th>Raw Result</th>
                                            <th>Boosted</th>
                                            <th>Result</th>
                                            <th>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {monthlyPreview.members.map((member) => (
                                            <tr key={member.member_id}>
                                                <td>{member.member_name}</td>
                                                <td>{member.floor_units}</td>
                                                <td>{member.floor_pay.toLocaleString("ja-JP")}</td>
                                                <td>{member.raw_result_weight.toFixed(2)}</td>
                                                <td>{member.boosted_result_weight.toFixed(2)}</td>
                                                <td>{member.result_pay.toLocaleString("ja-JP")}</td>
                                                <td>{member.total_pay.toLocaleString("ja-JP")}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </section>
            )}

            {activeTab === "experience" && (
                <section className={styles.card}>
                    <div className={styles.eyebrow}>PATH V3.1</div>
                    <div className={styles.titleRow}>
                        <div>
                            <h2 className={styles.title}>経験 / 主担当</h2>
                            <p className={styles.muted}>skill ledger は finalized & locked day logs だけから派生します。</p>
                        </div>
                    </div>
                    <div className={styles.grid}>
                        <label className={styles.field}>
                            <span>member_id</span>
                            <input className={styles.input} value={experienceMemberId} onChange={(event) => setExperienceMemberId(event.target.value)} />
                        </label>
                    </div>
                    <div className={styles.actions}>
                        <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={handleLoadExperience}>経験台帳を取得</button>
                    </div>
                    {experience && (
                        <pre className={styles.status}>{JSON.stringify(experience, null, 2)}</pre>
                    )}

                    <div className={styles.grid}>
                        <label className={styles.field}>
                            <span>date</span>
                            <input className={styles.input} type="date" value={recommendationForm.date} onChange={(event) => setRecommendationForm((current) => ({ ...current, date: event.target.value }))} />
                        </label>
                        <label className={styles.field}>
                            <span>site_id</span>
                            <input className={styles.input} value={recommendationForm.site_id} onChange={(event) => setRecommendationForm((current) => ({ ...current, site_id: event.target.value }))} />
                        </label>
                        <label className={styles.field}>
                            <span>trade_family</span>
                            <select className={styles.select} value={recommendationForm.trade_family} onChange={(event) => setRecommendationForm((current) => ({ ...current, trade_family: event.target.value as PathTradeFamily }))}>
                                {TRADE_OPTIONS.map((trade) => (
                                    <option key={trade.value} value={trade.value}>{trade.label}</option>
                                ))}
                            </select>
                        </label>
                        <label className={styles.field}>
                            <span>difficulty_band</span>
                            <select className={styles.select} value={recommendationForm.difficulty_band} onChange={(event) => setRecommendationForm((current) => ({ ...current, difficulty_band: event.target.value as "S1" | "S2" | "S3" }))}>
                                <option value="S1">S1</option>
                                <option value="S2">S2</option>
                                <option value="S3">S3</option>
                            </select>
                        </label>
                        <label className={styles.field}>
                            <span>risk_band</span>
                            <select className={styles.select} value={recommendationForm.risk_band} onChange={(event) => setRecommendationForm((current) => ({ ...current, risk_band: event.target.value as "low" | "medium" | "high" }))}>
                                <option value="low">low</option>
                                <option value="medium">medium</option>
                                <option value="high">high</option>
                            </select>
                        </label>
                        <label className={styles.field}>
                            <span>candidate_member_ids</span>
                            <input className={styles.input} value={recommendationForm.candidate_member_ids} onChange={(event) => setRecommendationForm((current) => ({ ...current, candidate_member_ids: event.target.value }))} placeholder="id,id,id" />
                        </label>
                        <label className={styles.field}>
                            <span>chosen_member_id</span>
                            <input className={styles.input} value={recommendationForm.chosen_member_id} onChange={(event) => setRecommendationForm((current) => ({ ...current, chosen_member_id: event.target.value }))} />
                        </label>
                        <label className={styles.field}>
                            <span>override_reason_code</span>
                            <input className={styles.input} value={recommendationForm.override_reason_code} onChange={(event) => setRecommendationForm((current) => ({ ...current, override_reason_code: event.target.value }))} />
                        </label>
                    </div>
                    <div className={styles.actions}>
                        <button type="button" className={styles.button} onClick={handleRecommend}>主担当推薦</button>
                    </div>
                    {recommendation && (
                        <pre className={styles.status}>{JSON.stringify(recommendation, null, 2)}</pre>
                    )}
                </section>
            )}
        </div>
    );
}
