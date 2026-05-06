import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Building2,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  HardHat,
  Home,
  LogIn,
  LogOut,
  Loader2,
  Mail,
  MapPinned,
  MessageSquareText,
  PlusCircle,
  Route as RouteIcon,
  Settings2,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type Session } from "@supabase/supabase-js";
import { CommunicationRecordSheet } from "./components/CommunicationRecordSheet";
import { Communications } from "./pages/Communications";
import { Calendar } from "./pages/Calendar";
import PathRewardConfirmationPage from "./pages/PathRewardConfirmation";
import { Money } from "./pages/Money";
import { Settings } from "./pages/Settings";
import { Sites } from "./pages/Sites";
import { Today } from "./pages/Today";
import { FloatingActionButton } from "./components/FloatingActionButton";
import { MonthlyEvaluationModal } from "./components/today/MonthlyEvaluationModal";
import {
  bootstrapFirstOrg,
  fetchAppEntryState,
  fetchPathAiReviews,
  fetchPathForms,
  type AppEntryMembershipRecord,
  type AppEntryPendingInvite,
  type AppEntryStateRecord,
} from "./lib/api";
import {
  clearDevAuthSession,
  getDevAuthUserOption,
  isDevAuthSessionActive,
  isDevAuthUiEnabled,
  setDevAuthSessionActive,
} from "./lib/devAuth";
import { supabase } from "./lib/supabase";
import { useActiveOrgStore, type ActiveOrgOption } from "./stores/activeOrg";
import "./styles/genba-quest.css";
import styles from "./App.module.css";

const MONTHLY_EVALUATION_START_DAY = 25;
const AUTH_RESEND_COOLDOWN_SECONDS = 60;

const NAV_ITEMS: ReadonlyArray<{ path: string; label: string; icon: LucideIcon }> = [
  { path: "/", label: "今日", icon: Home },
  { path: "/calendar", label: "予定", icon: CalendarDays },
  { path: "/sites", label: "現場", icon: MapPinned },
  { path: "/communications", label: "連絡", icon: MessageSquareText },
  { path: "/money", label: "お金", icon: CircleDollarSign },
  { path: "/path", label: "PATH", icon: RouteIcon },
  { path: "/settings", label: "設定", icon: Settings2 },
] as const;

type ClientEntryState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready_client" }
  | AppEntryStateRecord;

type AuthRequestMode = "login" | "signup";

function buildDevAuthSession(): Session | null {
  const devUser = getDevAuthUserOption();

  if (!devUser) {
    return null;
  }

  return {
    access_token: "dev-auth-token",
    refresh_token: "dev-auth-token",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: {
      id: devUser.id,
      aud: "authenticated",
      role: "authenticated",
      email: devUser.email,
      app_metadata: {
        provider: "dev",
        providers: ["dev"],
        role: devUser.role,
      },
      user_metadata: {
        name: devUser.label,
      },
      identities: [],
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    },
  } as Session;
}

function getAuthErrorMessage(error: unknown, mode: AuthRequestMode): string {
  const fallback =
    mode === "login"
      ? "再ログイン用リンクを送信できませんでした。"
      : "初回登録用リンクを送信できませんでした。";

  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim();
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("too many") ||
    normalizedMessage.includes("429")
  ) {
    return "メール送信の上限に達しました。しばらく待ってから再度お試しください。";
  }

  if (
    mode === "login" &&
    (normalizedMessage.includes("signup") ||
      normalizedMessage.includes("signups") ||
      normalizedMessage.includes("user not found"))
  ) {
    return "このメールアドレスはまだ登録されていません。招待済みの場合は「初回登録」で進めてください。";
  }

  return message || fallback;
}

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
  viewerEmail,
  signOutBusy,
  onChangeOrg,
  onOpenBell,
  onSignOut,
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
  viewerEmail: string | null;
  signOutBusy: boolean;
  onChangeOrg: (orgId: string) => void;
  onOpenBell: () => void;
  onSignOut: () => void;
}) {
  const location = useLocation();
  const activePath = location.pathname === "/luqo" ? "/path" : location.pathname;
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
        <Link to="/" className={styles.logo} aria-label="GENBA QUEST ホーム">
          <span className={styles.logoMark} aria-hidden="true">
            <HardHat size={18} className={styles.logoIcon} />
          </span>
          <span className={styles.logoCopy}>
            <span className={styles.logoKicker}>現場OS</span>
            <span className={styles.logoText}>GENBA QUEST</span>
          </span>
        </Link>
        <div className={styles.headerActions}>
          {viewerEmail && <span className={styles.viewerBadge}>{viewerEmail}</span>}
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
          <button
            type="button"
            className={styles.signOutButton}
            onClick={onSignOut}
            disabled={signOutBusy}
            aria-label={viewerEmail ? `${viewerEmail} からログアウト` : "ログアウト"}
            title={viewerEmail ? `${viewerEmail} からログアウト` : "ログアウト"}
          >
            {signOutBusy ? <Loader2 size={16} className={styles.spinnerIcon} /> : <LogOut size={16} />}
            <span className={styles.signOutButtonText}>ログアウト</span>
          </button>
        </div>
      </div>

      <div
        className={`${styles.chipViewport} ${showLeftFade ? styles.chipViewportLeft : ""} ${
          showRightFade ? styles.chipViewportRight : ""
        }`}
      >
        <nav ref={chipRailRef} className={styles.chipRail} aria-label="画面切り替え">
          {NAV_ITEMS.map((item) => {
            const isActive = activePath === item.path;
            const NavIcon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`${styles.navChip} ${isActive ? styles.navChipActive : ""}`}
                data-route-active={isActive ? "true" : "false"}
                aria-current={isActive ? "page" : undefined}
              >
                <span className={styles.navChipSurface}>
                  <NavIcon size={16} className={styles.navChipIcon} aria-hidden="true" />
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
                <Bell size={16} className={styles.navChipIcon} aria-hidden="true" />
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
  children?: ReactNode;
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

function AuthGate({ onUseDevAuth }: { onUseDevAuth?: () => void }) {
  const [email, setEmail] = useState("");
  const [busyMode, setBusyMode] = useState<AuthRequestMode | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const normalizedEmail = email.trim().toLowerCase();
  const cooldownRemaining = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - nowMs) / 1000))
    : 0;
  const actionDisabled = Boolean(busyMode) || !normalizedEmail || cooldownRemaining > 0;

  useEffect(() => {
    if (!cooldownUntil) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [cooldownUntil]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await requestLoginLink("login");
  };

  const requestLoginLink = async (mode: AuthRequestMode) => {
    if (!normalizedEmail) {
      setError("メールアドレスを入力してください。");
      return;
    }

    if (cooldownRemaining > 0) {
      setError(`${cooldownRemaining}秒後に再送できます。`);
      return;
    }

    try {
      setBusyMode(mode);
      setError(null);
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: window.location.origin,
          shouldCreateUser: mode === "signup",
        },
      });

      if (signInError) {
        throw signInError;
      }

      setSentTo(normalizedEmail);
      setCooldownUntil(Date.now() + AUTH_RESEND_COOLDOWN_SECONDS * 1000);
      setNowMs(Date.now());
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError, mode));

      if (
        submitError instanceof Error &&
        submitError.message.toLowerCase().includes("rate limit")
      ) {
        setCooldownUntil(Date.now() + AUTH_RESEND_COOLDOWN_SECONDS * 1000);
        setNowMs(Date.now());
      }
    } finally {
      setBusyMode(null);
    }
  };

  return (
    <EntryLayout
      badge="ログイン"
      title="メールでログイン"
      description="現場データはログイン後に読み込みます。招待済み、または管理者として許可されたメールアドレスを入力してください。"
    >
      <form className={styles.authForm} onSubmit={handleSubmit}>
        <label className={styles.entryField}>
          <span>メールアドレス</span>
          <input
            className={styles.entryInput}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
              setSentTo(null);
            }}
            placeholder="you@example.com"
            required
          />
        </label>

        {sentTo && (
          <p className={styles.entrySuccess} aria-live="polite">
            {sentTo} にログインリンクを送りました。メールから開くと続きに進めます。
          </p>
        )}
        {cooldownRemaining > 0 && (
          <p className={styles.entryInfoMeta} aria-live="polite">
            次の送信まで {cooldownRemaining} 秒
          </p>
        )}
        {error && <p className={styles.entryError}>{error}</p>}

        <div className={styles.authActions}>
          <button
            type="submit"
            className={`${styles.primaryButton} ${busyMode === "login" ? styles.primaryButtonBusy : ""}`}
            disabled={actionDisabled}
            aria-busy={busyMode === "login"}
          >
            {busyMode === "login" ? <Loader2 size={16} className={styles.spinnerIcon} /> : <LogIn size={16} />}
            再ログインリンクを送る
          </button>
          <button
            type="button"
            className={`${styles.secondaryButton} ${busyMode === "signup" ? styles.primaryButtonBusy : ""}`}
            disabled={actionDisabled}
            aria-busy={busyMode === "signup"}
            onClick={() => void requestLoginLink("signup")}
          >
            {busyMode === "signup" ? <Loader2 size={16} className={styles.spinnerIcon} /> : <Mail size={16} />}
            初回登録リンクを送る
          </button>
        </div>
        {onUseDevAuth && (
          <button type="button" className={styles.secondaryButton} onClick={onUseDevAuth}>
            開発用ユーザーで入る
          </button>
        )}
      </form>
    </EntryLayout>
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

function OnboardingGate({
  viewerEmail,
  onOpenInviteHelp,
}: {
  viewerEmail: string | null;
  onOpenInviteHelp: () => void;
}) {
  return (
    <EntryLayout
      badge="未所属"
      title="招待を受けて参加"
      description="このアカウントは、まだどの組織にも参加していません。参加するには、管理者からの招待を受けてください。"
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
      </div>
    </EntryLayout>
  );
}

function InviteActionGate({
  viewerEmail,
  pendingInvites,
}: {
  viewerEmail: string | null;
  pendingInvites: AppEntryPendingInvite[];
}) {
  return (
    <EntryLayout
      badge="招待待ち"
      title="招待されている組織があります"
      description="招待内容を確認しています。参加できない場合は、管理者に参加設定の確認を依頼してください。"
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
        <p>このメールで招待を確認できました。参加できない場合は、管理者に参加設定の確認を依頼してください。</p>
        {viewerEmail && <p className={styles.entryInfoMeta}>現在のログインメール: {viewerEmail}</p>}
      </div>
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
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signOutBusy, setSignOutBusy] = useState(false);
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
  const viewerEmail = authSession?.user.email || null;

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

  const handleSignedOut = useCallback(() => {
    clearActiveOrg();
    setEntryState({ state: "loading" });
    setBootstrapError(null);
    setShowInviteHelp(false);
    setCommunicationSheetOpen(false);
    setShowMonthlyEvaluationModal(false);
    setMonthlyEvaluationSubmitted(false);
    setReviewAlertCount(0);
    setReviewAlertMemberId(null);
  }, [clearActiveOrg]);

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) {
        return;
      }

      setAuthSession(session);
      setAuthLoading(false);

      if (session) {
        clearDevAuthSession();
        void resolveEntryState();
        return;
      }

      if (isDevAuthSessionActive()) {
        setAuthSession(buildDevAuthSession());
        void resolveEntryState();
        return;
      }

      handleSignedOut();
    };

    void loadSession();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) {
        return;
      }

      setAuthSession(session);
      setAuthLoading(false);

      if (session) {
        clearDevAuthSession();
        void resolveEntryState();
        return;
      }

      if (isDevAuthSessionActive()) {
        setAuthSession(buildDevAuthSession());
        void resolveEntryState();
        return;
      }

      handleSignedOut();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [handleSignedOut, resolveEntryState]);

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
      navigate(`/path?${searchParams.toString()}`);
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
      const result = await bootstrapFirstOrg({
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
  }, [bootstrapName, bootstrapSlug, formatBootstrapError, setActiveOrgId, setOrgOptions]);

  const handleSelectOrg = useCallback((orgId: string) => {
    setActiveOrgId(orgId);
    setEntryState({ state: "ready_client" });
  }, [setActiveOrgId]);

  const handleSignOut = useCallback(async () => {
    try {
      setSignOutBusy(true);
      if (isDevAuthSessionActive()) {
        clearDevAuthSession();
        setAuthSession(null);
        handleSignedOut();
        return;
      }

      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
      setAuthSession(null);
      handleSignedOut();
    } catch (error) {
      console.error("Failed to sign out:", error);
    } finally {
      setSignOutBusy(false);
    }
  }, [handleSignedOut]);

  const handleUseDevAuth = useCallback(() => {
    const devSession = buildDevAuthSession();

    if (!devSession) {
      return;
    }

    setDevAuthSessionActive();
    setAuthSession(devSession);
    setAuthLoading(false);
    void resolveEntryState();
  }, [resolveEntryState]);

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
          onOpenInviteHelp={() => setShowInviteHelp(true)}
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

  if (authLoading) {
    return (
      <EntryLayout badge="起動中" title="ログイン状態を確認しています" description="保存済みのセッションを確認しています。">
        <div className={styles.entryLoading}>
          <Loader2 size={20} className={styles.spinnerIcon} />
          <span>少しだけお待ちください</span>
        </div>
      </EntryLayout>
    );
  }

  if (!authSession) {
    return <AuthGate onUseDevAuth={isDevAuthUiEnabled() ? handleUseDevAuth : undefined} />;
  }

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
            viewerEmail={viewerEmail}
            signOutBusy={signOutBusy}
            onChangeOrg={(orgId) => setActiveOrgId(orgId)}
            onOpenBell={openBell}
            onSignOut={() => void handleSignOut()}
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
                <Route path="/path" element={<PathRewardConfirmationPage />} />
                <Route path="/luqo" element={<PathRewardConfirmationPage />} />
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
