import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
    Building2,
    ChevronRight,
    HardHat,
    Loader2,
    Mail,
  PlusCircle,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommunicationRecordSheet } from "./components/CommunicationRecordSheet";
import { Communications } from "./pages/Communications";
import { Calendar } from "./pages/Calendar";
import LUQOPage from "./pages/LUQO";
import { Money } from "./pages/Money";
import { Settings } from "./pages/Settings";
import { Sites } from "./pages/Sites";
import { Today } from "./pages/Today";
import { FloatingActionButton } from "./components/FloatingActionButton";
import { MonthlyEvaluationModal } from "./components/today/MonthlyEvaluationModal";
import {
  bootstrapFirstOrg,
  bootstrapOrg,
  fetchAppEntryState,
  fetchPathAiReviews,
  fetchPathForms,
  type AppEntryMembershipRecord,
  type AppEntryPendingInvite,
  type AppEntryStateRecord,
} from "./lib/api";
import { supabase } from "./lib/supabase";
import { useActiveOrgStore, type ActiveOrgOption } from "./stores/activeOrg";
import "./styles/genba-quest.css";
import styles from "./App.module.css";

const MONTHLY_EVALUATION_START_DAY = 25;

const NAV_ITEMS = [
  { path: "/", label: "今日" },
  { path: "/calendar", label: "スケジュール" },
  { path: "/sites", label: "現場" },
  { path: "/communications", label: "連絡" },
  { path: "/money", label: "お金" },
  { path: "/luqo", label: "今月の評価" },
  { path: "/settings", label: "設定" },
] as const;

type ClientEntryState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready_client" }
  | AppEntryStateRecord;

function isMonthlyEvaluationWindow(date: Date) {
  return date.getDate() >= MONTHLY_EVALUATION_START_DAY;
}

function formatMonthLabel(date: Date) {
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, "0")}月`;
}

function formatMonthValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildActiveOrgOptions(memberships: AppEntryMembershipRecord[]): ActiveOrgOption[] {
  return memberships.map((membership) => ({
    org: {
      id: membership.org_id,
      name: membership.org_name,
    },
    membership: {
      org_id: membership.org_id,
      role: membership.role,
    },
  }));
}

function Navigation({
  bellEnabled,
  bellNeedsAttention,
  bellBadgeLabel,
  monthlyEvaluationPreviewMode,
  bellLabel,
  orgOptions,
  activeOrgId,
  orgLabel,
  orgTone,
  onChangeOrg,
  onOpenBell,
}: {
  bellEnabled: boolean;
  bellNeedsAttention: boolean;
  bellBadgeLabel: string | null;
  monthlyEvaluationPreviewMode: boolean;
  bellLabel: string;
  orgOptions: ActiveOrgOption[];
  activeOrgId: string | null;
  orgLabel: string;
  orgTone: "default" | "warning";
  onChangeOrg: (orgId: string) => void;
  onOpenBell: () => void;
}) {
  const location = useLocation();
  const chipRailRef = useRef<HTMLDivElement | null>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);
  const canSwitchOrg = orgOptions.length > 1;

  const syncChipRailState = useCallback(() => {
    const node = chipRailRef.current;
    if (!node) {
      setShowLeftFade(false);
      setShowRightFade(false);
      return;
    }

    const maxScrollLeft = Math.max(node.scrollWidth - node.clientWidth, 0);
    setShowLeftFade(node.scrollLeft > 4);
    setShowRightFade(node.scrollLeft < maxScrollLeft - 4);
  }, []);

  useEffect(() => {
    const node = chipRailRef.current;
    if (!node) {
      return;
    }

    const frameId = window.requestAnimationFrame(syncChipRailState);
    const handleScroll = () => syncChipRailState();
    const resizeObserver = new ResizeObserver(() => syncChipRailState());

    node.addEventListener("scroll", handleScroll, { passive: true });
    resizeObserver.observe(node);

    return () => {
      window.cancelAnimationFrame(frameId);
      node.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, [syncChipRailState]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(syncChipRailState);
    const activeChip = chipRailRef.current?.querySelector("[data-route-active='true']");
    if (
      activeChip instanceof HTMLElement &&
      typeof activeChip.scrollIntoView === "function"
    ) {
      activeChip.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [location.pathname, bellEnabled, syncChipRailState]);

  return (
    <header className={styles.header}>
      <div className={styles.headerTop}>
        <Link to="/" className={styles.logo}>
          <HardHat size={22} className={styles.logoIcon} />
          GENBA QUEST
        </Link>
        <div
          className={`${styles.orgBadge} ${
            orgTone === "warning" ? styles.orgBadgeWarning : ""
          }`}
          aria-live="polite"
        >
          <span className={styles.orgBadgeEyebrow}>
            {canSwitchOrg ? "表示中の組織 / 切替" : "表示中の組織"}
          </span>
          {canSwitchOrg ? (
            <label className={styles.orgSelectWrap}>
              {orgTone === "warning" ? <TriangleAlert size={14} /> : <Building2 size={14} />}
              <select
                className={styles.orgSelect}
                value={activeOrgId || ""}
                onChange={(event) => onChangeOrg(event.target.value)}
                aria-label="表示中の組織"
              >
                {orgOptions.map((option) => (
                  <option key={option.org.id} value={option.org.id}>
                    {option.org.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className={styles.orgBadgeValue}>
              {orgTone === "warning" ? <TriangleAlert size={14} /> : <Building2 size={14} />}
              {orgLabel}
            </span>
          )}
        </div>
      </div>

      <div
        className={`${styles.chipViewport} ${showLeftFade ? styles.chipViewportLeft : ""} ${
          showRightFade ? styles.chipViewportRight : ""
        }`}
      >
        <nav ref={chipRailRef} className={styles.chipRail} aria-label="画面切り替え">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`${styles.navChip} ${isActive ? styles.navChipActive : ""}`}
                data-route-active={isActive ? "true" : "false"}
                aria-current={isActive ? "page" : undefined}
              >
                <span className={styles.navChipSurface}>
                  <span className={styles.navChipLabel}>{item.label}</span>
                </span>
              </Link>
            );
          })}

          {bellEnabled && (
            <button
              type="button"
              className={`${styles.navChip} ${styles.navChipAction} ${
                bellNeedsAttention ? styles.navChipActionPending : ""
              }`}
              onClick={onOpenBell}
              aria-label={bellLabel}
              title={monthlyEvaluationPreviewMode ? `${bellLabel}をプレビュー` : bellLabel}
            >
              <span className={styles.navChipSurface}>
                <span className={styles.navChipLabel}>確認</span>
                {bellBadgeLabel && <span className={styles.navChipBadge}>{bellBadgeLabel}</span>}
              </span>
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}

function InviteHelpModal({
  viewerEmail,
  onClose,
}: {
  viewerEmail: string | null;
  onClose: () => void;
}) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalCard} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className={styles.modalCloseButton} onClick={onClose} aria-label="閉じる">
          <X size={18} />
        </button>
        <div className={styles.modalBody}>
          <span className={styles.entryIconBadge}>
            <Mail size={18} />
          </span>
          <h2>招待で参加</h2>
          <p>
            管理者に招待を依頼してください。招待を受けたメールアドレスでログインすると、参加情報を確認できます。
          </p>
          {viewerEmail && <p className={styles.modalHint}>現在のログインメール: {viewerEmail}</p>}
        </div>
      </div>
    </div>
  );
}

function EntryLayout({
  badge,
  title,
  description,
  children,
}: {
  badge: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.entryShell}>
      <div className={styles.entryCard}>
        <div className={styles.entryHeader}>
          <Link to="/" className={styles.entryLogo}>
            <HardHat size={22} className={styles.logoIcon} />
            GENBA QUEST
          </Link>
          <span className={styles.entryBadge}>{badge}</span>
        </div>
        <div className={styles.entryBody}>
          <h1>{title}</h1>
          <p>{description}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function SystemBootstrapGate({
  bootstrapName,
  bootstrapSlug,
  bootstrapBusy,
  bootstrapError,
  onBootstrapNameChange,
  onBootstrapSlugChange,
  onBootstrapSubmit,
}: {
  bootstrapName: string;
  bootstrapSlug: string;
  bootstrapBusy: boolean;
  bootstrapError: string | null;
  onBootstrapNameChange: (value: string) => void;
  onBootstrapSlugChange: (value: string) => void;
  onBootstrapSubmit: () => void;
}) {
  return (
    <EntryLayout
      badge="初期化"
      title="最初の組織を作成"
      description="このシステムにはまだ組織がありません。最初の組織を作成して利用を開始してください。"
    >
      <div className={styles.entryActions}>
        <div className={styles.bootstrapCard}>
          <div className={styles.bootstrapCardHeader}>
            <span className={styles.entryIconBadge}>
              <PlusCircle size={18} />
            </span>
            <div>
              <h2>組織を作成</h2>
              <p>最初の組織を作成すると、このアカウントが admin として所属します。</p>
            </div>
          </div>

          <label className={styles.entryField}>
            <span>組織名</span>
            <input
              className={styles.entryInput}
              value={bootstrapName}
              onChange={(event) => onBootstrapNameChange(event.target.value)}
              placeholder="例: GENBA 本部"
            />
          </label>

          <label className={styles.entryField}>
            <span>slug（任意）</span>
            <input
              className={styles.entryInput}
              value={bootstrapSlug}
              onChange={(event) => onBootstrapSlugChange(event.target.value)}
              placeholder="例: genba-hq"
            />
          </label>

          {bootstrapError && <p className={styles.entryError}>{bootstrapError}</p>}

          <button
            type="button"
            className={`${styles.primaryButton} ${bootstrapBusy ? styles.primaryButtonBusy : ""}`}
            onClick={onBootstrapSubmit}
            disabled={bootstrapBusy}
            aria-busy={bootstrapBusy}
          >
            {bootstrapBusy ? <Loader2 size={16} className={styles.spinnerIcon} /> : <PlusCircle size={16} />}
            組織を作成
          </button>
        </div>
      </div>
    </EntryLayout>
  );
}

function BootstrapCard({
  title,
  description,
  bootstrapName,
  bootstrapSlug,
  bootstrapBusy,
  bootstrapError,
  onBootstrapNameChange,
  onBootstrapSlugChange,
  onBootstrapSubmit,
}: {
  title: string;
  description: string;
  bootstrapName: string;
  bootstrapSlug: string;
  bootstrapBusy: boolean;
  bootstrapError: string | null;
  onBootstrapNameChange: (value: string) => void;
  onBootstrapSlugChange: (value: string) => void;
  onBootstrapSubmit: () => void;
}) {
  return (
    <div className={styles.bootstrapCard}>
      <div className={styles.bootstrapCardHeader}>
        <span className={styles.entryIconBadge}>
          <PlusCircle size={18} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <label className={styles.entryField}>
        <span>組織名</span>
        <input
          className={styles.entryInput}
          value={bootstrapName}
          onChange={(event) => onBootstrapNameChange(event.target.value)}
          placeholder="例: GENBA 本部"
        />
      </label>

      <label className={styles.entryField}>
        <span>slug（任意）</span>
        <input
          className={styles.entryInput}
          value={bootstrapSlug}
          onChange={(event) => onBootstrapSlugChange(event.target.value)}
          placeholder="例: genba-hq"
        />
      </label>

      {bootstrapError && <p className={styles.entryError}>{bootstrapError}</p>}

      <button
        type="button"
        className={`${styles.primaryButton} ${bootstrapBusy ? styles.primaryButtonBusy : ""}`}
        onClick={onBootstrapSubmit}
        disabled={bootstrapBusy}
        aria-busy={bootstrapBusy}
      >
        {bootstrapBusy ? <Loader2 size={16} className={styles.spinnerIcon} /> : <PlusCircle size={16} />}
        組織を作成
      </button>
    </div>
  );
}

function OnboardingGate({
  viewerEmail,
  bootstrapAllowed,
  bootstrapName,
  bootstrapSlug,
  bootstrapBusy,
  bootstrapError,
  onOpenInviteHelp,
  onBootstrapNameChange,
  onBootstrapSlugChange,
  onBootstrapSubmit,
}: {
  viewerEmail: string | null;
  bootstrapAllowed: boolean;
  bootstrapName: string;
  bootstrapSlug: string;
  bootstrapBusy: boolean;
  bootstrapError: string | null;
  onOpenInviteHelp: () => void;
  onBootstrapNameChange: (value: string) => void;
  onBootstrapSlugChange: (value: string) => void;
  onBootstrapSubmit: () => void;
}) {
  const title = bootstrapAllowed ? "参加方法を選択" : "招待を受けて参加";
  const description = bootstrapAllowed
    ? "管理者からの招待で参加するか、新しい組織を作成して始められます。"
    : "このアカウントは、まだどの組織にも参加していません。参加するには、管理者からの招待を受けてください。";

  return (
    <EntryLayout
      badge="未所属"
      title={title}
      description={description}
    >
      <div className={styles.entryActions}>
        <button type="button" className={styles.secondaryButton} onClick={onOpenInviteHelp}>
          <Mail size={16} />
          招待で参加
        </button>

        <div className={styles.entryInfoCard}>
          <h2>管理者に招待を依頼</h2>
          <p>招待はメールアドレス単位で届きます。招待を受けたメールアドレスでログインしてください。</p>
          {viewerEmail && <p className={styles.entryInfoMeta}>現在のログインメール: {viewerEmail}</p>}
        </div>

        {bootstrapAllowed && (
          <BootstrapCard
            title="新しい組織を作成"
            description="管理者メールとして許可されているため、この場で新しい組織を作成できます。"
            bootstrapName={bootstrapName}
            bootstrapSlug={bootstrapSlug}
            bootstrapBusy={bootstrapBusy}
            bootstrapError={bootstrapError}
            onBootstrapNameChange={onBootstrapNameChange}
            onBootstrapSlugChange={onBootstrapSlugChange}
            onBootstrapSubmit={onBootstrapSubmit}
          />
        )}
      </div>
    </EntryLayout>
  );
}

function InviteActionGate({
  viewerEmail,
  pendingInvites,
  bootstrapAllowed,
  bootstrapName,
  bootstrapSlug,
  bootstrapBusy,
  bootstrapError,
  onBootstrapNameChange,
  onBootstrapSlugChange,
  onBootstrapSubmit,
}: {
  viewerEmail: string | null;
  pendingInvites: AppEntryPendingInvite[];
  bootstrapAllowed: boolean;
  bootstrapName: string;
  bootstrapSlug: string;
  bootstrapBusy: boolean;
  bootstrapError: string | null;
  onBootstrapNameChange: (value: string) => void;
  onBootstrapSlugChange: (value: string) => void;
  onBootstrapSubmit: () => void;
}) {
  const description = bootstrapAllowed
    ? "参加する組織を確認してください。必要なら新しい組織を作成して始めることもできます。"
    : "参加する組織を確認してください。招待を受けたメールアドレスでログインすると、参加情報を確認できます。";

  return (
    <EntryLayout
      badge="招待待ち"
      title="招待されている組織があります"
      description={description}
    >
      <div className={styles.entryList}>
        {pendingInvites.map((invite) => (
          <article key={invite.invite_id} className={styles.entryListCard}>
            <div>
              <strong>{invite.org_name}</strong>
              <p>{invite.role} として招待されています</p>
            </div>
            <ChevronRight size={18} className={styles.entryListIcon} />
          </article>
        ))}
      </div>
      <div className={styles.entryInfoCard}>
        <h2>参加について</h2>
        <p>招待を受けたメールアドレスでログインしてください。現在のアカウントでは参加情報を確認できません。</p>
        {viewerEmail && <p className={styles.entryInfoMeta}>現在のログインメール: {viewerEmail}</p>}
      </div>
      {bootstrapAllowed && (
        <BootstrapCard
          title="別の組織を作成"
          description="招待待ちでも、管理者メールなら新しい組織を作成して始められます。"
          bootstrapName={bootstrapName}
          bootstrapSlug={bootstrapSlug}
          bootstrapBusy={bootstrapBusy}
          bootstrapError={bootstrapError}
          onBootstrapNameChange={onBootstrapNameChange}
          onBootstrapSlugChange={onBootstrapSlugChange}
          onBootstrapSubmit={onBootstrapSubmit}
        />
      )}
    </EntryLayout>
  );
}

function OrgSelectionGate({
  memberships,
  onSelectOrg,
}: {
  memberships: AppEntryMembershipRecord[];
  onSelectOrg: (orgId: string) => void;
}) {
  return (
    <EntryLayout
      badge="組織選択"
      title="開く組織を選択してください"
      description="このアカウントは複数の組織に所属しています。今回表示する組織を選択してください。"
    >
      <div className={styles.entryList}>
        {memberships.map((membership) => (
          <button
            key={membership.org_id}
            type="button"
            className={styles.entrySelectButton}
            onClick={() => onSelectOrg(membership.org_id)}
          >
            <div>
              <strong>{membership.org_name}</strong>
              <p>{membership.role} として参加中</p>
            </div>
            <ChevronRight size={18} className={styles.entryListIcon} />
          </button>
        ))}
      </div>
    </EntryLayout>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [communicationSheetOpen, setCommunicationSheetOpen] = useState(false);
  const [showMonthlyEvaluationModal, setShowMonthlyEvaluationModal] = useState(false);
  const [monthlyEvaluationSubmitted, setMonthlyEvaluationSubmitted] = useState(false);
  const [monthlyEvaluationStatusLoading, setMonthlyEvaluationStatusLoading] = useState(false);
  const [reviewAlertCount, setReviewAlertCount] = useState(0);
  const [reviewAlertMemberId, setReviewAlertMemberId] = useState<string | null>(null);
  const [entryState, setEntryState] = useState<ClientEntryState>({ state: "loading" });
  const [showInviteHelp, setShowInviteHelp] = useState(false);
  const [bootstrapName, setBootstrapName] = useState("");
  const [bootstrapSlug, setBootstrapSlug] = useState("");
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const activeOrgId = useActiveOrgStore((state) => state.activeOrgId);
  const orgOptions = useActiveOrgStore((state) => state.options);
  const setOrgOptions = useActiveOrgStore((state) => state.setOptions);
  const setActiveOrgId = useActiveOrgStore((state) => state.setActiveOrgId);
  const clearActiveOrg = useActiveOrgStore((state) => state.clear);
  const monthlyEvaluationPreviewMode =
    new URLSearchParams(location.search).get("month_end_form_preview") === "1";
  const monthlyEvaluationDate = new Date();
  const monthlyEvaluationEnabled =
    monthlyEvaluationPreviewMode || isMonthlyEvaluationWindow(monthlyEvaluationDate);
  const monthlyEvaluationMonthLabel = formatMonthLabel(monthlyEvaluationDate);
  const monthlyEvaluationMonthValue = formatMonthValue(monthlyEvaluationDate);
  const activeOrg = orgOptions.find((option) => option.org.id === activeOrgId) || null;
  const appReady = entryState.state === "ready_client";
  const orgLabel = activeOrg?.org.name || "組織未選択";
  const orgTone = activeOrg ? "default" : "warning";

  const resolveEntryState = useCallback(async () => {
    setBootstrapError(null);

    try {
      const nextState = await fetchAppEntryState();

      if (nextState.state === "ready") {
        const options = buildActiveOrgOptions(nextState.memberships);
        setOrgOptions(options);
        setActiveOrgId(nextState.active_org.org_id);
        setEntryState({ state: "ready_client" });
        return;
      }

      if (nextState.state === "needs_org_selection") {
        const options = buildActiveOrgOptions(nextState.memberships);
        setOrgOptions(options);
        const storedActiveOrgId = useActiveOrgStore.getState().activeOrgId;

        if (
          storedActiveOrgId &&
          nextState.memberships.some((membership) => membership.org_id === storedActiveOrgId)
        ) {
          setActiveOrgId(storedActiveOrgId);
          setEntryState({ state: "ready_client" });
          return;
        }

        setActiveOrgId(null);
        setEntryState(nextState);
        return;
      }

      clearActiveOrg();
      setEntryState(nextState);
    } catch (error) {
      clearActiveOrg();
      setEntryState({
        state: "error",
        message: error instanceof Error ? error.message : "APP_ENTRY_LOAD_FAILED",
      });
    }
  }, [clearActiveOrg, setActiveOrgId, setOrgOptions]);

  useEffect(() => {
    void resolveEntryState();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void resolveEntryState();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [resolveEntryState]);

  const loadMonthlyEvaluationStatus = useCallback(async () => {
    if (!appReady || !activeOrgId) {
      setMonthlyEvaluationSubmitted(false);
      return;
    }

    if (!monthlyEvaluationEnabled) {
      setMonthlyEvaluationSubmitted(false);
      return;
    }

    try {
      setMonthlyEvaluationStatusLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const currentUserId = session?.user?.id || "";

      if (!currentUserId) {
        setMonthlyEvaluationSubmitted(false);
        return;
      }

      const { forms } = await fetchPathForms({
        month: monthlyEvaluationMonthValue,
        member_id: currentUserId,
        limit: 1,
      });

      setMonthlyEvaluationSubmitted(forms.length > 0);
    } catch (error) {
      console.error("Failed to load monthly evaluation status:", error);
      setMonthlyEvaluationSubmitted(false);
    } finally {
      setMonthlyEvaluationStatusLoading(false);
    }
  }, [activeOrgId, appReady, monthlyEvaluationEnabled, monthlyEvaluationMonthValue]);

  const loadReviewAlerts = useCallback(async () => {
    if (!appReady || !activeOrgId) {
      setReviewAlertCount(0);
      setReviewAlertMemberId(null);
      return;
    }

    try {
      const { reviews } = await fetchPathAiReviews({
        month: monthlyEvaluationMonthValue,
        review_required_flag: true,
        limit: 50,
      });
      setReviewAlertCount(reviews.length);
      setReviewAlertMemberId(reviews[0]?.member_id || null);
    } catch (error) {
      console.error("Failed to load review alerts:", error);
      setReviewAlertCount(0);
      setReviewAlertMemberId(null);
    }
  }, [activeOrgId, appReady, monthlyEvaluationMonthValue]);

  useEffect(() => {
    void loadMonthlyEvaluationStatus();
  }, [loadMonthlyEvaluationStatus]);

  useEffect(() => {
    void loadReviewAlerts();
  }, [loadReviewAlerts]);

  const monthlyEvaluationPending =
    appReady &&
    Boolean(activeOrgId) &&
    monthlyEvaluationEnabled &&
    !monthlyEvaluationStatusLoading &&
    !monthlyEvaluationSubmitted;
  const bellEnabled = appReady && Boolean(activeOrgId) && (monthlyEvaluationEnabled || reviewAlertCount > 0);
  const bellNeedsAttention = monthlyEvaluationPending || reviewAlertCount > 0;
  const bellBadgeLabel = reviewAlertCount > 0 ? String(reviewAlertCount) : bellNeedsAttention ? "!" : null;
  const bellLabel = monthlyEvaluationPending
    ? `${monthlyEvaluationMonthLabel}の月末フォームが未入力です`
    : reviewAlertCount > 0
      ? `レビュー確認が${reviewAlertCount}件あります`
      : `${monthlyEvaluationMonthLabel}の確認ベルを開く`;

  const openBell = useCallback(() => {
    if (!activeOrgId) {
      return;
    }

    if (reviewAlertCount > 0) {
      const searchParams = new URLSearchParams();
      searchParams.set("review_inbox", "1");
      if (reviewAlertMemberId) {
        searchParams.set("member", reviewAlertMemberId);
      }
      navigate(`/luqo?${searchParams.toString()}`);
      return;
    }

    setShowMonthlyEvaluationModal(true);
  }, [activeOrgId, navigate, reviewAlertCount, reviewAlertMemberId]);

  const formatBootstrapError = useCallback((code: string) => {
    if (code === "SYSTEM_BOOTSTRAP_ALREADY_COMPLETED") {
      return "このシステムの初期化はすでに完了しています。再読み込みしてください。";
    }

    if (code === "SYSTEM_BOOTSTRAP_NAME_REQUIRED") {
      return "組織名を入力してください。";
    }

    if (code === "SYSTEM_BOOTSTRAP_SLUG_CONFLICT") {
      return "その slug はすでに使われています。別の slug を指定してください。";
    }

    if (code === "ORG_BOOTSTRAP_FORBIDDEN") {
      return "この環境では管理者のみ組織を作成できます。";
    }

    if (code === "ORG_BOOTSTRAP_NAME_REQUIRED") {
      return "組織名を入力してください。";
    }

    if (code === "ORG_BOOTSTRAP_SLUG_CONFLICT") {
      return "その slug はすでに使われています。別の slug を指定してください。";
    }

    if (code === "ORG_BOOTSTRAP_NOT_IN_ONBOARDING") {
      return "すでに所属している組織があります。別の組織を作成する前に切り替え状態を確認してください。";
    }

    return code;
  }, []);

  const handleBootstrapSubmit = useCallback(async () => {
    try {
      setBootstrapBusy(true);
      setBootstrapError(null);
      const bootstrapAction =
        entryState.state === "needs_system_bootstrap" ? bootstrapFirstOrg : bootstrapOrg;
      const result = await bootstrapAction({
        name: bootstrapName,
        slug: bootstrapSlug || null,
      });

      const nextOptions: ActiveOrgOption[] = [
        {
          org: {
            id: result.active_org.id,
            name: result.active_org.name,
            slug: result.active_org.slug,
            status: result.active_org.status,
          },
          membership: {
            org_id: result.membership.org_id,
            user_id: result.membership.user_id,
            role: result.membership.role,
            status: result.membership.status,
          },
        },
      ];

      setOrgOptions(nextOptions);
      setActiveOrgId(result.active_org.id);
      setEntryState({ state: "ready_client" });
    } catch (error) {
      setBootstrapError(
        formatBootstrapError(error instanceof Error ? error.message : "SYSTEM_BOOTSTRAP_FAILED"),
      );
    } finally {
      setBootstrapBusy(false);
    }
  }, [bootstrapName, bootstrapSlug, entryState.state, formatBootstrapError, setActiveOrgId, setOrgOptions]);

  const handleSelectOrg = useCallback((orgId: string) => {
    setActiveOrgId(orgId);
    setEntryState({ state: "ready_client" });
  }, [setActiveOrgId]);

  const renderEntryGate = () => {
    if (entryState.state === "loading") {
      return (
        <EntryLayout badge="起動中" title="組織を確認しています" description="所属情報と入口状態を読み込んでいます。">
          <div className={styles.entryLoading}>
            <Loader2 size={20} className={styles.spinnerIcon} />
            <span>少しだけお待ちください</span>
          </div>
        </EntryLayout>
      );
    }

    if (entryState.state === "error") {
      return (
        <EntryLayout badge="エラー" title="入口を確認できませんでした" description="時間を置いて再読み込みするか、管理者にお問い合わせください。">
          <p className={styles.entryError}>{entryState.message}</p>
          <button type="button" className={styles.primaryButton} onClick={() => void resolveEntryState()}>
            再読み込み
          </button>
        </EntryLayout>
      );
    }

    if (entryState.state === "needs_onboarding") {
      return (
        <OnboardingGate
          viewerEmail={entryState.viewer_email}
          bootstrapAllowed={entryState.bootstrap_allowed}
          bootstrapName={bootstrapName}
          bootstrapSlug={bootstrapSlug}
          bootstrapBusy={bootstrapBusy}
          bootstrapError={bootstrapError}
          onOpenInviteHelp={() => setShowInviteHelp(true)}
          onBootstrapNameChange={setBootstrapName}
          onBootstrapSlugChange={setBootstrapSlug}
          onBootstrapSubmit={() => void handleBootstrapSubmit()}
        />
      );
    }

    if (entryState.state === "needs_system_bootstrap") {
      return (
        <SystemBootstrapGate
          bootstrapName={bootstrapName}
          bootstrapSlug={bootstrapSlug}
          bootstrapBusy={bootstrapBusy}
          bootstrapError={bootstrapError}
          onBootstrapNameChange={setBootstrapName}
          onBootstrapSlugChange={setBootstrapSlug}
          onBootstrapSubmit={() => void handleBootstrapSubmit()}
        />
      );
    }

    if (entryState.state === "needs_invite_action") {
      return (
        <InviteActionGate
          viewerEmail={entryState.viewer_email}
          pendingInvites={entryState.pending_invites}
          bootstrapAllowed={entryState.bootstrap_allowed}
          bootstrapName={bootstrapName}
          bootstrapSlug={bootstrapSlug}
          bootstrapBusy={bootstrapBusy}
          bootstrapError={bootstrapError}
          onBootstrapNameChange={setBootstrapName}
          onBootstrapSlugChange={setBootstrapSlug}
          onBootstrapSubmit={() => void handleBootstrapSubmit()}
        />
      );
    }

    if (entryState.state === "needs_org_selection") {
      return (
        <OrgSelectionGate
          memberships={entryState.memberships}
          onSelectOrg={handleSelectOrg}
        />
      );
    }

    return null;
  };

  return (
    <>
      {appReady ? (
        <div className={styles.app}>
          <Navigation
            bellEnabled={bellEnabled}
            bellNeedsAttention={bellNeedsAttention}
            bellBadgeLabel={bellBadgeLabel}
            monthlyEvaluationPreviewMode={monthlyEvaluationPreviewMode}
            bellLabel={bellLabel}
            orgOptions={orgOptions}
            activeOrgId={activeOrgId}
            orgLabel={orgLabel}
            orgTone={orgTone}
            onChangeOrg={(orgId) => setActiveOrgId(orgId)}
            onOpenBell={openBell}
          />
          <main className={styles.main}>
            <div key={activeOrgId || "no-org"}>
              <Routes>
                <Route path="/" element={<Today />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/sites" element={<Sites />} />
                <Route path="/money" element={<Money />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/communications" element={<Communications />} />
                <Route path="/luqo" element={<LUQOPage />} />
              </Routes>
            </div>
          </main>

          {showMonthlyEvaluationModal && (
            <MonthlyEvaluationModal
              onClose={() => setShowMonthlyEvaluationModal(false)}
              onSaved={() => {
                setMonthlyEvaluationSubmitted(true);
                setShowMonthlyEvaluationModal(false);
              }}
            />
          )}

          {location.pathname === "/" && (
            <FloatingActionButton
              behavior="draggable"
              items={[
                {
                  id: "communication-record",
                  label: "連絡を記録",
                  icon: <Mail size={20} />,
                  onClick: () => setCommunicationSheetOpen(true),
                },
              ]}
            />
          )}
          {location.pathname === "/" && (
            <CommunicationRecordSheet
              open={communicationSheetOpen}
              onClose={() => setCommunicationSheetOpen(false)}
              initialTargetKind="new_topic"
            />
          )}
        </div>
      ) : (
        renderEntryGate()
      )}

      {showInviteHelp && (
        <InviteHelpModal
          viewerEmail={entryState.state === "needs_onboarding" ? entryState.viewer_email : null}
          onClose={() => setShowInviteHelp(false)}
        />
      )}
    </>
  );
}

export default App;
