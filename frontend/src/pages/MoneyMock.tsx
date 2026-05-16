/* ============================================================
   MoneyMock — visual reference for Money redesign (PR #0)
   ------------------------------------------------------------
   This page is mock-only. Hardcoded data, no API calls, no
   store hooks. It establishes the visual + interaction spec
   for PR #3-#15 implementation by Codex 5.5.

   Mounted at /money-mock (dev-only). NOT linked from
   production navigation. Remove route in App.tsx after the
   redesign lands and Codex stabilizes the production Money.

   Authoring rules:
   - All CSS values via tokens (frontend/src/styles/genba-quest.css)
   - tabular-nums for every currency figure
   - Min tap target 48px (--md-sys-tap-target-min)
   - Color never the sole signal — every status has text + dot
   - "Don't write notes inside the UI; show state, not prose"
   ============================================================ */

import { useState, useCallback, useMemo } from "react";
import styles from "./MoneyMock.module.css";

// ---------- Types ----------
type RewardStatus = "請求書を出す" | "発行済" | "未発行" | "支払済" | "試算中";
type ExpenseStatus = "精算待ち" | "確認中" | "なし" | "振込済";
type InvoiceStatus = "下書き" | "発行中" | "入金待ち" | "入金済み" | "期限超過";

interface MemberReward {
  id: string;
  nickname: string;
  amount: number;
  level: string;
  status: RewardStatus;
  isSelf: boolean;
}

interface MemberExpense {
  id: string;
  nickname: string;
  amount: number;
  count: number;
  status: ExpenseStatus;
  isSelf: boolean;
}

interface CustomerInvoice {
  id: string;
  partner: string;
  amount: number;
  dueDate: string;
  daysUntilDue: number;
  status: InvoiceStatus;
}

// ---------- Mock data ----------
const MOCK_REWARDS: MemberReward[] = [
  { id: "self", nickname: "自分", amount: 245000, level: "L3", status: "請求書を出す", isSelf: true },
  { id: "take", nickname: "タケ", amount: 210000, level: "L3", status: "発行済", isSelf: false },
  { id: "yama", nickname: "ヤマ", amount: 180000, level: "L2", status: "未発行", isSelf: false },
  { id: "masa", nickname: "マサ", amount: 220000, level: "L3", status: "支払済", isSelf: false },
  { id: "naru", nickname: "ナル", amount: 195000, level: "L2", status: "発行済", isSelf: false },
];

const MOCK_REWARDS_BEFORE_CLOSE: MemberReward[] = MOCK_REWARDS.map((r) => ({
  ...r,
  status: "試算中" as RewardStatus,
}));

const MOCK_EXPENSES: MemberExpense[] = [
  { id: "self", nickname: "自分", amount: 45200, count: 3, status: "精算待ち", isSelf: true },
  { id: "take", nickname: "タケ", amount: 12000, count: 1, status: "確認中", isSelf: false },
  { id: "yama", nickname: "ヤマ", amount: 0, count: 0, status: "なし", isSelf: false },
  { id: "masa", nickname: "マサ", amount: 8500, count: 2, status: "精算待ち", isSelf: false },
];

const MOCK_INVOICES: CustomerInvoice[] = [
  { id: "i1", partner: "株式会社A邸内装", amount: 350000, dueDate: "5/12", daysUntilDue: -3, status: "期限超過" },
  { id: "i2", partner: "B工務店", amount: 120000, dueDate: "5/18", daysUntilDue: 3, status: "入金待ち" },
  { id: "i3", partner: "Cリフォーム", amount: 480000, dueDate: "5/20", daysUntilDue: 5, status: "発行中" },
  { id: "i4", partner: "Dハウジング", amount: 250000, dueDate: "5/22", daysUntilDue: 7, status: "下書き" },
  { id: "i5", partner: "E建築", amount: 180000, dueDate: "5/28", daysUntilDue: 13, status: "発行中" },
];

const MOCK_SPARKLINE = [
  { value: 0.42, label: "12月" },
  { value: 0.55, label: "1月" },
  { value: 0.61, label: "2月" },
  { value: 0.50, label: "3月" },
  { value: 0.78, label: "4月" },
  { value: 0.95, label: "5月" },
];

// ---------- Utilities ----------
const fmtYen = (n: number) =>
  new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(n);

const fmtYenShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `¥${Math.round(n / 1000).toLocaleString()}k`;
  return fmtYen(n);
};

// ---------- Modal types ----------
type ModalKind =
  | null
  | { kind: "ownReward" }
  | { kind: "otherReward"; memberId: string }
  | { kind: "monthClose" }
  | { kind: "fabSheet" }
  | { kind: "invoicePay"; invoiceId: string };

// ============================================================
// MAIN PAGE
// ============================================================
export default function MoneyMock() {
  const [monthState, setMonthState] = useState<"before" | "after">("after");
  const [activeTab, setActiveTab] = useState<"transactions" | "invoices">("invoices");
  const [modal, setModal] = useState<ModalKind>(null);
  const [shieldOpen, setShieldOpen] = useState(false);

  const rewards = monthState === "after" ? MOCK_REWARDS : MOCK_REWARDS_BEFORE_CLOSE;

  const closeModal = useCallback(() => setModal(null), []);

  return (
    <div className={styles.page}>
      <DevPanel
        monthState={monthState}
        onMonthStateChange={setMonthState}
        onOpenModal={(kind) => setModal({ kind } as ModalKind)}
      />

      <Header monthState={monthState} />

      {/* ① 報酬 */}
      <RewardSection
        rewards={rewards}
        shieldOpen={shieldOpen}
        onShieldToggle={() => setShieldOpen((v) => !v)}
        onSelfTap={() => setModal({ kind: "ownReward" })}
        onOtherTap={(id) => setModal({ kind: "otherReward", memberId: id })}
      />

      {/* ② 立替 */}
      <ExpenseSection
        expenses={MOCK_EXPENSES}
        onSelfTap={() => setModal({ kind: "ownReward" })} /* expense detail uses same modal in mock */
        onOtherTap={(id) => setModal({ kind: "otherReward", memberId: id })}
      />

      {/* ③ 会社 */}
      <CompanySection />

      {/* Tabs */}
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      {activeTab === "invoices" ? (
        <InvoiceTab onInvoiceTap={(id) => setModal({ kind: "invoicePay", invoiceId: id })} />
      ) : (
        <TransactionsTab />
      )}

      {/* FAB */}
      <button
        className={styles.fab}
        aria-label="作成メニューを開く"
        onClick={() => setModal({ kind: "fabSheet" })}
      >
        <span className={styles.fabIcon}>＋</span>
        <span>追加</span>
      </button>

      {/* Modals */}
      {modal?.kind === "ownReward" && (
        <OwnRewardModal monthState={monthState} onClose={closeModal} />
      )}
      {modal?.kind === "otherReward" && (
        <OtherRewardModal
          memberId={modal.memberId}
          isObjectionWindow={monthState === "after"}
          onClose={closeModal}
        />
      )}
      {modal?.kind === "monthClose" && <MonthCloseModal onClose={closeModal} />}
      {modal?.kind === "fabSheet" && <FabSheet onClose={closeModal} />}
      {modal?.kind === "invoicePay" && (
        <InvoicePayModal invoiceId={modal.invoiceId} onClose={closeModal} />
      )}
    </div>
  );
}

// ============================================================
// DEV PANEL (mock-only)
// ============================================================
function DevPanel({
  monthState,
  onMonthStateChange,
  onOpenModal,
}: {
  monthState: "before" | "after";
  onMonthStateChange: (s: "before" | "after") => void;
  onOpenModal: (kind: "monthClose" | "fabSheet") => void;
}) {
  return (
    <div className={styles.devPanel}>
      <span className={styles.devLabel}>DEV MOCK</span>
      <button
        className={`${styles.devToggle} ${monthState === "before" ? styles.devToggleActive : ""}`}
        onClick={() => onMonthStateChange("before")}
      >
        確定前
      </button>
      <button
        className={`${styles.devToggle} ${monthState === "after" ? styles.devToggleActive : ""}`}
        onClick={() => onMonthStateChange("after")}
      >
        確定済み
      </button>
      <button className={styles.devToggle} onClick={() => onOpenModal("monthClose")}>
        月確定モーダル
      </button>
      <button className={styles.devToggle} onClick={() => onOpenModal("fabSheet")}>
        FABシート
      </button>
    </div>
  );
}

// ============================================================
// HEADER
// ============================================================
function Header({ monthState }: { monthState: "before" | "after" }) {
  return (
    <header className={styles.header}>
      <div className={styles.monthGroup}>
        <button className={styles.monthNav} aria-label="前の月">‹</button>
        <span className={styles.monthLabel}>5月</span>
        <button className={styles.monthNav} aria-label="次の月">›</button>
        <span
          className={`${styles.monthState} ${monthState === "after" ? styles.monthStateClosed : ""}`}
          aria-live="polite"
        >
          {monthState === "after" ? "確定済み" : "確定前"}
        </span>
      </div>
      <button className={styles.settingsBtn} aria-label="設定">⚙</button>
    </header>
  );
}

// ============================================================
// SECTION ① 報酬
// ============================================================
function RewardSection({
  rewards,
  shieldOpen,
  onShieldToggle,
  onSelfTap,
  onOtherTap,
}: {
  rewards: MemberReward[];
  shieldOpen: boolean;
  onShieldToggle: () => void;
  onSelfTap: () => void;
  onOtherTap: (memberId: string) => void;
}) {
  const orderedRewards = useMemo(() => {
    const self = rewards.find((r) => r.isSelf);
    const others = rewards.filter((r) => !r.isSelf);
    return self ? [self, ...others] : rewards;
  }, [rewards]);

  return (
    <section className={styles.section} aria-labelledby="section-reward">
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle} id="section-reward">報酬</h2>
        <div style={{ position: "relative" }}>
          <button
            className={styles.shieldBtn}
            aria-label="プライバシーについて"
            aria-expanded={shieldOpen}
            onClick={onShieldToggle}
          >
            🛡️
          </button>
          {shieldOpen && <ShieldPopover />}
        </div>
      </div>

      <div className={styles.carousel} role="list">
        {orderedRewards.map((r) => (
          <MemberCardReward
            key={r.id}
            reward={r}
            onTap={() => (r.isSelf ? onSelfTap() : onOtherTap(r.id))}
          />
        ))}
        <SeeAllCard onClick={() => onOtherTap("all")} />
      </div>
    </section>
  );
}

function MemberCardReward({
  reward,
  onTap,
}: {
  reward: MemberReward;
  onTap: () => void;
}) {
  const statusClass =
    reward.status === "請求書を出す" || reward.status === "未発行"
      ? styles.cardStatusPending
      : reward.status === "発行済" || reward.status === "試算中"
      ? styles.cardStatusDraft
      : styles.cardStatusCompleted;

  return (
    <button
      type="button"
      className={`${styles.card} ${reward.isSelf ? styles.cardSelf : ""}`}
      onClick={onTap}
      role="listitem"
      aria-label={`${reward.nickname}の報酬 ${fmtYen(reward.amount)} ${reward.status}`}
    >
      <span className={styles.cardName}>
        {reward.nickname} · {reward.level}
      </span>
      <span className={styles.cardAmount}>{fmtYenShort(reward.amount)}</span>
      {reward.isSelf && reward.status === "請求書を出す" ? (
        <span
          className={styles.cardCta}
          onClick={(e) => {
            e.stopPropagation();
            onTap();
          }}
          role="presentation"
        >
          請求書を出す
        </span>
      ) : (
        <span className={`${styles.cardStatus} ${statusClass}`}>{reward.status}</span>
      )}
    </button>
  );
}

// ============================================================
// SECTION ② 立替
// ============================================================
function ExpenseSection({
  expenses,
  onSelfTap,
  onOtherTap,
}: {
  expenses: MemberExpense[];
  onSelfTap: () => void;
  onOtherTap: (memberId: string) => void;
}) {
  const ordered = useMemo(() => {
    const self = expenses.find((e) => e.isSelf);
    const others = expenses.filter((e) => !e.isSelf);
    return self ? [self, ...others] : expenses;
  }, [expenses]);

  return (
    <section className={styles.section} aria-labelledby="section-expense">
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle} id="section-expense">立替</h2>
      </div>

      <div className={styles.carousel} role="list">
        {ordered.map((e) => (
          <MemberCardExpense
            key={e.id}
            expense={e}
            onTap={() => (e.isSelf ? onSelfTap() : onOtherTap(e.id))}
          />
        ))}
        <SeeAllCard onClick={() => onOtherTap("all")} />
      </div>
    </section>
  );
}

function MemberCardExpense({
  expense,
  onTap,
}: {
  expense: MemberExpense;
  onTap: () => void;
}) {
  const statusClass =
    expense.status === "精算待ち"
      ? styles.cardStatusPending
      : expense.status === "確認中"
      ? styles.cardStatusDraft
      : expense.status === "なし"
      ? styles.cardStatusCompleted
      : styles.cardStatusCompleted;

  return (
    <button
      type="button"
      className={`${styles.card} ${expense.isSelf ? styles.cardSelf : ""}`}
      onClick={onTap}
      role="listitem"
      aria-label={`${expense.nickname}の立替 ${fmtYen(expense.amount)} ${expense.status}`}
    >
      <span className={styles.cardName}>
        {expense.nickname}
        {expense.count > 0 ? ` · ${expense.count}件` : ""}
      </span>
      <span className={styles.cardAmount}>{fmtYenShort(expense.amount)}</span>
      <span className={`${styles.cardStatus} ${statusClass}`}>{expense.status}</span>
    </button>
  );
}

// ============================================================
// Shared: See-all card / Shield popover
// ============================================================
function SeeAllCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.cardSeeAll} onClick={onClick}>
      <span className={styles.cardSeeAllIcon}>→</span>
      <span>全員を見る</span>
    </button>
  );
}

function ShieldPopover() {
  return (
    <div role="dialog" className={styles.shieldPopover}>
      <span className={styles.shieldPopoverTitle}>プライバシー</span>
      <div>
        <strong>見えるもの</strong>
        <ul className={styles.shieldPopoverList}>
          <li>報酬額</li>
          <li>立替額</li>
          <li>請求状態</li>
        </ul>
      </div>
      <div>
        <strong>見えないもの</strong>
        <ul className={styles.shieldPopoverList}>
          <li>振込先</li>
          <li>本名</li>
          <li>T番号</li>
          <li>請求書本文</li>
        </ul>
      </div>
    </div>
  );
}

// ============================================================
// SECTION ③ 会社
// ============================================================
function CompanySection() {
  const profit = 1_240_000;
  const sales = 3_200_000;
  const expenses = 1_960_000;
  const pendingInvoices = 3;
  const overdueInvoices = 1;

  return (
    <section className={styles.section} aria-labelledby="section-company">
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle} id="section-company">会社</h2>
      </div>
      <article className={styles.companyCard}>
        <div className={styles.companyHeader}>
          <span className={styles.companyLabel}>5月</span>
          <span className={styles.companyProfit}>+{fmtYenShort(profit)}</span>
        </div>
        <div className={styles.companyBreakdown}>
          <span>売上 {fmtYenShort(sales)}</span>
          <span>経費 {fmtYenShort(expenses)}</span>
        </div>
        <div className={styles.companyChips}>
          <div className={styles.sparkline} aria-hidden="true">
            {MOCK_SPARKLINE.map((b, i) => (
              <span
                key={b.label}
                className={`${styles.sparkBar} ${i === MOCK_SPARKLINE.length - 1 ? styles.sparkBarLast : ""}`}
                style={{ height: `${b.value * 100}%` }}
              />
            ))}
          </div>
          <button className={styles.alertChip}>
            <span>遅延</span>
            <strong>{overdueInvoices}</strong>
          </button>
          <button className={`${styles.alertChip} ${styles.alertChipPending}`}>
            <span>未請求</span>
            <strong>{pendingInvoices}</strong>
          </button>
        </div>
      </article>
    </section>
  );
}

// ============================================================
// TABS
// ============================================================
function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: "transactions" | "invoices";
  onTabChange: (t: "transactions" | "invoices") => void;
}) {
  return (
    <div className={styles.tabs} role="tablist">
      <button
        role="tab"
        aria-selected={activeTab === "transactions"}
        className={`${styles.tab} ${activeTab === "transactions" ? styles.tabActive : ""}`}
        onClick={() => onTabChange("transactions")}
      >
        取引
      </button>
      <button
        role="tab"
        aria-selected={activeTab === "invoices"}
        className={`${styles.tab} ${activeTab === "invoices" ? styles.tabActive : ""}`}
        onClick={() => onTabChange("invoices")}
      >
        取引先・請求書<span className={styles.tabBadge}>1</span>
      </button>
    </div>
  );
}

function TransactionsTab() {
  return (
    <div className={styles.tabBody}>
      <p style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
        取引一覧（既存 Money.tsx の transactions タブを再利用予定）
      </p>
    </div>
  );
}

function InvoiceTab({ onInvoiceTap }: { onInvoiceTap: (id: string) => void }) {
  const [filter, setFilter] = useState<"all" | "overdue" | "this_week" | "draft">("overdue");

  const counts = {
    overdue: MOCK_INVOICES.filter((i) => i.status === "期限超過").length,
    this_week: MOCK_INVOICES.filter((i) => i.daysUntilDue >= 0 && i.daysUntilDue <= 7).length,
    draft: MOCK_INVOICES.filter((i) => i.status === "下書き").length,
  };

  const filtered = MOCK_INVOICES.filter((i) => {
    if (filter === "all") return true;
    if (filter === "overdue") return i.status === "期限超過";
    if (filter === "this_week") return i.daysUntilDue >= 0 && i.daysUntilDue <= 7;
    if (filter === "draft") return i.status === "下書き";
    return true;
  });

  return (
    <div className={styles.tabBody}>
      <div className={styles.invoiceFilterRow}>
        <FilterChip active={filter === "overdue"} onClick={() => setFilter("overdue")}>
          期限超過<span className={styles.filterChipBadge}>{counts.overdue}</span>
        </FilterChip>
        <FilterChip active={filter === "this_week"} onClick={() => setFilter("this_week")}>
          今週入金予定<span className={styles.filterChipBadge}>{counts.this_week}</span>
        </FilterChip>
        <FilterChip active={filter === "draft"} onClick={() => setFilter("draft")}>
          下書き<span className={styles.filterChipBadge}>{counts.draft}</span>
        </FilterChip>
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          全部
        </FilterChip>
      </div>

      {filtered.map((inv) => (
        <button
          key={inv.id}
          type="button"
          className={`${styles.partnerCard} ${inv.status === "期限超過" ? styles.partnerCardOverdue : ""}`}
          onClick={() => onInvoiceTap(inv.id)}
        >
          <span className={styles.partnerName}>{inv.partner}</span>
          <span className={styles.partnerAmount}>{fmtYen(inv.amount)}</span>
          <span className={styles.partnerInvoiceLine}>
            {inv.dueDate} 期限 ・ {inv.status}
          </span>
          {inv.status === "期限超過" && (
            <span className={styles.partnerOverdueBadge}>{Math.abs(inv.daysUntilDue)}日超過</span>
          )}
        </button>
      ))}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`${styles.filterChip} ${active ? styles.filterChipActive : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ============================================================
// MODALS
// ============================================================
function ModalShell({
  title,
  onClose,
  children,
  actions,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <button className={styles.modalClose} onClick={onClose} aria-label="閉じる">✕</button>
        </header>
        <div className={styles.modalBody}>{children}</div>
        {actions && <div className={styles.modalActions}>{actions}</div>}
      </div>
    </div>
  );
}

function OwnRewardModal({
  monthState,
  onClose,
}: {
  monthState: "before" | "after";
  onClose: () => void;
}) {
  const isFinalized = monthState === "after";
  const [invoiceState, setInvoiceState] = useState<"none" | "issued" | "paid">("none");

  let actions: React.ReactNode = null;
  if (!isFinalized) {
    actions = <button className={styles.btnSecondary} onClick={onClose}>閉じる</button>;
  } else if (invoiceState === "none") {
    actions = (
      <>
        <button className={styles.btnSecondary} onClick={onClose}>閉じる</button>
        <button className={styles.btnPrimary} onClick={() => setInvoiceState("issued")}>請求書を出す</button>
      </>
    );
  } else if (invoiceState === "issued") {
    actions = (
      <>
        <button className={styles.btnSecondary} onClick={() => setInvoiceState("none")}>取り消す</button>
        <button className={styles.btnPrimary} onClick={onClose}>閉じる</button>
      </>
    );
  } else {
    actions = <button className={styles.btnPrimary} onClick={onClose}>閉じる</button>;
  }

  return (
    <ModalShell title="5月分の報酬" onClose={onClose} actions={actions}>
      <div className={styles.rewardMetric}>
        <span className={styles.rewardMetricLabel}>あなたの報酬</span>
        <span className={styles.rewardMetricValue}>{fmtYen(245000)}</span>
      </div>

      <section>
        <h4 style={{ font: "var(--md-sys-typescale-label-large)", marginBottom: "var(--md-sys-spacing-sm)" }}>
          計算根拠
        </h4>
        <div className={styles.rewardBreakdown}>
          <div className={styles.rewardRow}>
            <span className={styles.rewardRowLabel}>レベル</span>
            <span className={styles.rewardRowValue}>L3</span>
          </div>
          <div className={styles.rewardRow}>
            <span className={styles.rewardRowLabel}>出勤日数</span>
            <span className={styles.rewardRowValue}>18日</span>
          </div>
          <div className={styles.rewardRow}>
            <span className={styles.rewardRowLabel}>基本給</span>
            <span className={styles.rewardRowValue}>{fmtYen(216000)}</span>
          </div>
          <div className={styles.rewardRow}>
            <span className={styles.rewardRowLabel}>加算</span>
            <span className={styles.rewardRowValue}>+{fmtYen(29000)}</span>
          </div>
        </div>
      </section>

      <section>
        <h4 style={{ font: "var(--md-sys-typescale-label-large)", marginBottom: "var(--md-sys-spacing-sm)" }}>
          請求書
        </h4>
        {!isFinalized && (
          <div className={`${styles.invoiceStateBox} ${styles.invoiceStateBoxDraft}`}>
            <span>⏳</span>
            <span>月確定後に発行できます</span>
          </div>
        )}
        {isFinalized && invoiceState === "none" && (
          <div className={`${styles.invoiceStateBox} ${styles.invoiceStateBoxDraft}`}>
            <span>📄</span>
            <span>未発行 — 下のボタンから請求書を出してください</span>
          </div>
        )}
        {isFinalized && invoiceState === "issued" && (
          <div className={`${styles.invoiceStateBox} ${styles.invoiceStateBoxDraft}`}>
            <span>📨</span>
            <span>発行中 — 経理担当が振込を準備しています</span>
          </div>
        )}
        {isFinalized && invoiceState === "paid" && (
          <div className={styles.invoiceStateBox}>
            <span>✓</span>
            <span>5/15 振込完了</span>
          </div>
        )}
      </section>
    </ModalShell>
  );
}

function OtherRewardModal({
  memberId,
  isObjectionWindow,
  onClose,
}: {
  memberId: string;
  isObjectionWindow: boolean;
  onClose: () => void;
}) {
  const member = MOCK_REWARDS.find((r) => r.id === memberId);
  const title = member ? `${member.nickname}さんの報酬` : "メンバー一覧";

  if (memberId === "all") {
    return (
      <ModalShell title="チーム全員" onClose={onClose}>
        <p style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
          ※ 全員の報酬と立替を一覧表示するモーダル(ここはCodexがリスト実装する)
        </p>
        {MOCK_REWARDS.map((r) => (
          <div key={r.id} className={styles.rewardRow}>
            <span className={styles.rewardRowLabel}>{r.nickname}（{r.level}）</span>
            <span className={styles.rewardRowValue}>{fmtYen(r.amount)}</span>
          </div>
        ))}
      </ModalShell>
    );
  }

  return (
    <ModalShell
      title={title}
      onClose={onClose}
      actions={
        <>
          <button className={styles.btnSecondary} onClick={onClose}>閉じる</button>
          {isObjectionWindow && (
            <button className={styles.btnSecondary}>異議を申し立てる</button>
          )}
        </>
      }
    >
      <div className={styles.rewardMetric}>
        <span className={styles.rewardMetricLabel}>{member?.nickname}さんの報酬</span>
        <span className={styles.rewardMetricValue}>{member ? fmtYen(member.amount) : "-"}</span>
      </div>
      <p style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
        計算根拠と過去の異議履歴がここに並ぶ。請求書情報は本人のみ閲覧可。
      </p>
    </ModalShell>
  );
}

function MonthCloseModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell
      title="5月分を確定します"
      onClose={onClose}
      actions={
        <>
          <button className={styles.btnSecondary} onClick={onClose}>戻る</button>
          <button className={styles.btnPrimary} onClick={onClose}>5月分を確定</button>
        </>
      }
    >
      <p className={styles.monthCloseNotice}>
        確定すると、全員の報酬額が固定され、請求書を発行できるようになります。確定後の修正には別途異議申立が必要です。
      </p>
      <div className={styles.monthCloseSummary}>
        <div className={styles.monthCloseRow}>
          <span>対象メンバー</span>
          <strong>5人</strong>
        </div>
        <div className={styles.monthCloseRow}>
          <span>総報酬額</span>
          <strong>{fmtYen(1_050_000)}</strong>
        </div>
        <div className={styles.monthCloseRow}>
          <span>異議申立</span>
          <strong>0件</strong>
        </div>
      </div>
    </ModalShell>
  );
}

function FabSheet({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell title="何を追加しますか？" onClose={onClose}>
      <button className={styles.fabSheetItem} onClick={onClose}>
        <span className={styles.fabSheetIcon}>💰</span>
        <div>
          <div>経費・立替を記録</div>
          <div style={{ font: "var(--md-sys-typescale-body-small)", color: "var(--md-sys-color-on-surface-variant)" }}>
            立替/会社払いはモーダル内で選択
          </div>
        </div>
      </button>
      <button className={styles.fabSheetItem} onClick={onClose}>
        <span className={styles.fabSheetIcon}>📄</span>
        <div>
          <div>請求書を発行</div>
          <div style={{ font: "var(--md-sys-typescale-body-small)", color: "var(--md-sys-color-on-surface-variant)" }}>
            顧客向け
          </div>
        </div>
      </button>
      <button className={styles.fabSheetItem} onClick={onClose}>
        <span className={styles.fabSheetIcon}>💵</span>
        <div>
          <div>売上を記録</div>
          <div style={{ font: "var(--md-sys-typescale-body-small)", color: "var(--md-sys-color-on-surface-variant)" }}>
            手入力
          </div>
        </div>
      </button>
    </ModalShell>
  );
}

function InvoicePayModal({
  invoiceId,
  onClose,
}: {
  invoiceId: string;
  onClose: () => void;
}) {
  const invoice = MOCK_INVOICES.find((i) => i.id === invoiceId);
  if (!invoice) return null;

  return (
    <ModalShell
      title="請求書の支払い"
      onClose={onClose}
      actions={
        <>
          <button className={styles.btnSecondary} onClick={onClose}>閉じる</button>
          <button className={styles.btnPrimary} onClick={onClose}>支払い済みにする</button>
        </>
      }
    >
      <div className={styles.rewardMetric}>
        <span className={styles.rewardMetricLabel}>{invoice.partner}</span>
        <span className={styles.rewardMetricValue}>{fmtYen(invoice.amount)}</span>
      </div>
      <div className={styles.rewardBreakdown}>
        <div className={styles.rewardRow}>
          <span className={styles.rewardRowLabel}>期限</span>
          <span className={styles.rewardRowValue}>{invoice.dueDate}</span>
        </div>
        <div className={styles.rewardRow}>
          <span className={styles.rewardRowLabel}>状態</span>
          <span className={styles.rewardRowValue}>{invoice.status}</span>
        </div>
      </div>
      <p style={{ color: "var(--md-sys-color-on-surface-variant)", font: "var(--md-sys-typescale-body-small)" }}>
        ※ メンバー請求書の場合、ベル通知でランダム割当された経理担当のみが時限的に振込先・本名を閲覧可能。
      </p>
    </ModalShell>
  );
}
