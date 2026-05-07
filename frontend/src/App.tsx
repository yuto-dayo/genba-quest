import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Building2,
  CalendarDays,
  ChevronRight,
  Chrome,
  CircleDollarSign,
  HardHat,
  Home,
  LogIn,
  LogOut,
  Loader2,
  Mail,
  KeyRound,
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
import {
  acceptOrgInvite,
  bootstrapFirstOrg,
  fetchAppEntryState,
  fetchNotifications,
  type AppEntryMembershipRecord,
  type AppEntryPendingInvite,
  type AppEntryStateRecord,
  type NotificationRecord,
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

const AUTH_RESEND_COOLDOWN_SECONDS = 60;
const AUTH_RECOVERY_SEARCH_PARAM = "auth";
const AUTH_RECOVERY_SEARCH_VALUE = "recovery";

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

type AuthRequestMode = "google" | "login" | "signup" | "magic" | "reset" | "updatePassword";

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
  const fallbackByMode: Record<AuthRequestMode, string> = {
    google: "Googleログインできませんでした。",
    login: "ログインできませんでした。",
    signup: "初回登録できませんでした。",
    magic: "非常用リンクを送信できませんでした。",
    reset: "パスワード再設定メールを送信できませんでした。",
    updatePassword: "パスワードを更新できませんでした。",
  };
  const fallback = fallbackByMode[mode];

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
    normalizedMessage.includes("email") &&
    (normalizedMessage.includes("invalid") || normalizedMessage.includes("not valid"))
  ) {
    return "メールアドレスの形式を確認してください。";
  }

  if (mode === "google") {
    return fallback;
  }

  if (
    mode === "login" &&
    (normalizedMessage.includes("invalid login credentials") ||
      normalizedMessage.includes("invalid credentials"))
  ) {
    return "メールアドレスまたはパスワードが違います。";
  }

  if (
    mode === "signup" &&
    (normalizedMessage.includes("already registered") ||
      normalizedMessage.includes("already exists") ||
      normalizedMessage.includes("user already registered"))
  ) {
    return "このメールアドレスは登録済みです。通常ログインで入ってください。";
  }

  if (
    (mode === "signup" || mode === "updatePassword") &&
    (normalizedMessage.includes("password") || normalizedMessage.includes("weak"))
  ) {
    return "パスワードは8文字以上で設定してください。";
  }

  if (
    mode === "magic" &&
    (normalizedMessage.includes("signup") ||
      normalizedMessage.includes("signups") ||
      normalizedMessage.includes("user not found"))
  ) {
    return "このメールアドレスはまだ登録されていません。招待済みの場合は「初回登録」で進めてください。";
  }

  return message || fallback;
}

function buildPasswordRecoveryRedirectUrl() {
  const redirectUrl = new URL(window.location.origin);
  redirectUrl.searchParams.set(AUTH_RECOVERY_SEARCH_PARAM, AUTH_RECOVERY_SEARCH_VALUE);
  return redirectUrl.toString();
}

function isPasswordRecoveryRedirect() {
  return new URLSearchParams(window.location.search).get(AUTH_RECOVERY_SEARCH_PARAM) === AUTH_RECOVERY_SEARCH_VALUE;
}

function clearPasswordRecoveryRedirect() {
  const url = new URL(window.location.href);
  if (url.searchParams.get(AUTH_RECOVERY_SEARCH_PARAM) !== AUTH_RECOVERY_SEARCH_VALUE) {
    return;
  }

  url.searchParams.delete(AUTH_RECOVERY_SEARCH_PARAM);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function getNotificationDataString(notification: NotificationRecord | undefined, key: string): string | null {
  const value = notification?.data?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isSiteLevelDraftNotification(notification: NotificationRecord): boolean {
  return getNotificationDataString(notification, "task_type") === "site_level_draft";
}

function getSiteLevelDraftSiteName(notification: NotificationRecord | undefined): string {
  return getNotificationDataString(notification, "site_name") || "完了現場";
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
              title={bellLabel}
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
  const [password, setPassword] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState("");
  const [busyMode, setBusyMode] = useState<AuthRequestMode | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const normalizedEmail = email.trim().toLowerCase();
  const cooldownRemaining = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - nowMs) / 1000))
    : 0;
  const loginDisabled = Boolean(busyMode) || !normalizedEmail || !password;
  const signupDisabled =
    Boolean(busyMode) || !normalizedEmail || !signupPassword || !signupPasswordConfirm;
  const googleDisabled = Boolean(busyMode);
  const magicDisabled = Boolean(busyMode) || !normalizedEmail || cooldownRemaining > 0;
  const resetDisabled = Boolean(busyMode) || cooldownRemaining > 0;

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
    await signInWithPassword();
  };

  const signInWithGoogle = async () => {
    try {
      setBusyMode("google");
      setError(null);
      setSentTo(null);
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });

      if (signInError) {
        throw signInError;
      }
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError, "google"));
    } finally {
      setBusyMode(null);
    }
  };

  const signInWithPassword = async () => {
    if (!normalizedEmail) {
      setError("メールアドレスを入力してください。");
      return;
    }

    if (!password) {
      setError("パスワードを入力してください。");
      return;
    }

    try {
      setBusyMode("login");
      setError(null);
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (signInError) {
        throw signInError;
      }
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError, "login"));
    } finally {
      setBusyMode(null);
    }
  };

  const signUpWithPassword = async () => {
    if (!normalizedEmail) {
      setError("メールアドレスを入力してください。");
      return;
    }

    if (!signupPassword) {
      setError("パスワードを入力してください。");
      return;
    }

    if (signupPassword.length < 8) {
      setError("パスワードは8文字以上で設定してください。");
      return;
    }

    if (signupPassword !== signupPasswordConfirm) {
      setError("確認用パスワードが一致していません。");
      return;
    }

    try {
      setBusyMode("signup");
      setError(null);
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: signupPassword,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      if (!data.session) {
        setSentTo(normalizedEmail);
      }
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError, "signup"));
    } finally {
      setBusyMode(null);
    }
  };

  const requestMagicLink = async () => {
    if (!normalizedEmail) {
      setError("メールアドレスを入力してください。");
      return;
    }

    if (cooldownRemaining > 0) {
      setError(`${cooldownRemaining}秒後に再送できます。`);
      return;
    }

    try {
      setBusyMode("magic");
      setError(null);
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: window.location.origin,
          shouldCreateUser: false,
        },
      });

      if (signInError) {
        throw signInError;
      }

      setSentTo(normalizedEmail);
      setCooldownUntil(Date.now() + AUTH_RESEND_COOLDOWN_SECONDS * 1000);
      setNowMs(Date.now());
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError, "magic"));

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

  const requestPasswordReset = async () => {
    if (!normalizedEmail) {
      setError("メールアドレスを入力してください。");
      return;
    }

    if (cooldownRemaining > 0) {
      setError(`${cooldownRemaining}秒後に再送できます。`);
      return;
    }

    try {
      setBusyMode("reset");
      setError(null);
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: buildPasswordRecoveryRedirectUrl(),
      });

      if (resetError) {
        throw resetError;
      }

      setSentTo(normalizedEmail);
      setCooldownUntil(Date.now() + AUTH_RESEND_COOLDOWN_SECONDS * 1000);
      setNowMs(Date.now());
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError, "reset"));

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
      title="Googleでログイン"
      description="Googleアカウントで入れます。招待はメールアドレスで確認します。"
    >
      <form className={styles.authForm} onSubmit={handleSubmit}>
        <button
          type="button"
          className={`${styles.googleButton} ${busyMode === "google" ? styles.primaryButtonBusy : ""}`}
          disabled={googleDisabled}
          aria-busy={busyMode === "google"}
          onClick={() => void signInWithGoogle()}
        >
          {busyMode === "google" ? <Loader2 size={16} className={styles.spinnerIcon} /> : <Chrome size={16} />}
          Googleで続ける
        </button>

        <div className={styles.authDivider} aria-hidden="true">
          <span />
          <strong>メールでログイン</strong>
          <span />
        </div>

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

        <label className={styles.entryField}>
          <span>パスワード</span>
          <input
            className={styles.entryInput}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setError(null);
            }}
            required
          />
        </label>

        {sentTo && (
          <p className={styles.entrySuccess} aria-live="polite">
            {sentTo} に確認リンクを送りました。メールから開くと続きに進めます。
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
            disabled={loginDisabled}
            aria-busy={busyMode === "login"}
          >
            {busyMode === "login" ? <Loader2 size={16} className={styles.spinnerIcon} /> : <LogIn size={16} />}
            ログイン
          </button>
          <button
            type="button"
            className={`${styles.textButton} ${styles.passwordResetButton} ${busyMode === "reset" ? styles.primaryButtonBusy : ""}`}
            disabled={resetDisabled}
            aria-busy={busyMode === "reset"}
            onClick={() => void requestPasswordReset()}
          >
            {busyMode === "reset" ? <Loader2 size={16} className={styles.spinnerIcon} /> : <KeyRound size={16} />}
            パスワードを忘れた
          </button>
        </div>

        <div className={styles.signupPanel}>
          <div className={styles.signupPanelHeader}>
            <span className={styles.entryIconBadge}>
              <Mail size={18} />
            </span>
            <div>
              <h2>初回登録</h2>
              <p>招待されたメールアドレスに、次回から使うパスワードを設定します。</p>
            </div>
          </div>
          <label className={styles.entryField}>
            <span>初回登録用パスワード</span>
            <input
              className={styles.entryInput}
              type="password"
              autoComplete="new-password"
              value={signupPassword}
              onChange={(event) => {
                setSignupPassword(event.target.value);
                setError(null);
              }}
            />
          </label>
          <label className={styles.entryField}>
            <span>初回登録用パスワード（確認）</span>
            <input
              className={styles.entryInput}
              type="password"
              autoComplete="new-password"
              value={signupPasswordConfirm}
              onChange={(event) => {
                setSignupPasswordConfirm(event.target.value);
                setError(null);
              }}
            />
          </label>
          <button
            type="button"
            className={`${styles.secondaryButton} ${busyMode === "signup" ? styles.primaryButtonBusy : ""}`}
            disabled={signupDisabled}
            aria-busy={busyMode === "signup"}
            onClick={() => void signUpWithPassword()}
          >
            {busyMode === "signup" ? <Loader2 size={16} className={styles.spinnerIcon} /> : <LogIn size={16} />}
            初回登録して進む
          </button>
        </div>

        <div className={styles.authActions}>
          <button
            type="button"
            className={`${styles.secondaryButton} ${busyMode === "magic" ? styles.primaryButtonBusy : ""}`}
            disabled={magicDisabled}
            aria-busy={busyMode === "magic"}
            onClick={() => void requestMagicLink()}
          >
            {busyMode === "magic" ? <Loader2 size={16} className={styles.spinnerIcon} /> : <Mail size={16} />}
            非常用リンクを送る
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

function PasswordRecoveryGate({
  viewerEmail,
  onPasswordUpdated,
}: {
  viewerEmail: string | null;
  onPasswordUpdated: () => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitDisabled = busy || !newPassword || !newPasswordConfirm;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (newPassword.length < 8) {
      setError("パスワードは8文字以上で設定してください。");
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      setError("確認用パスワードが一致していません。");
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        throw updateError;
      }

      onPasswordUpdated();
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError, "updatePassword"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EntryLayout
      badge="再設定"
      title="新しいパスワードを設定"
      description="次回から使うパスワードを設定してください。設定後はそのまま現場データへ進みます。"
    >
      <form className={styles.authForm} onSubmit={handleSubmit}>
        {viewerEmail && <p className={styles.entryInfoMeta}>対象メール: {viewerEmail}</p>}
        <label className={styles.entryField}>
          <span>新しいパスワード</span>
          <input
            className={styles.entryInput}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
              setError(null);
            }}
            required
          />
        </label>
        <label className={styles.entryField}>
          <span>新しいパスワード（確認）</span>
          <input
            className={styles.entryInput}
            type="password"
            autoComplete="new-password"
            value={newPasswordConfirm}
            onChange={(event) => {
              setNewPasswordConfirm(event.target.value);
              setError(null);
            }}
            required
          />
        </label>
        {error && <p className={styles.entryError}>{error}</p>}
        <button
          type="submit"
          className={`${styles.primaryButton} ${busy ? styles.primaryButtonBusy : ""}`}
          disabled={submitDisabled}
          aria-busy={busy}
        >
          {busy ? <Loader2 size={16} className={styles.spinnerIcon} /> : <LogIn size={16} />}
          パスワードを更新
        </button>
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
  inviteBusyId,
  inviteError,
  onAcceptInvite,
}: {
  viewerEmail: string | null;
  pendingInvites: AppEntryPendingInvite[];
  inviteBusyId: string | null;
  inviteError: string | null;
  onAcceptInvite: (inviteId: string) => void;
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
            <button
              type="button"
              className={`${styles.secondaryButton} ${inviteBusyId === invite.invite_id ? styles.primaryButtonBusy : ""}`}
              onClick={() => onAcceptInvite(invite.invite_id)}
              disabled={Boolean(inviteBusyId)}
              aria-busy={inviteBusyId === invite.invite_id}
            >
              {inviteBusyId === invite.invite_id ? (
                <Loader2 size={16} className={styles.spinnerIcon} />
              ) : (
                <ChevronRight size={16} />
              )}
              参加する
            </button>
          </article>
        ))}
      </div>
      {inviteError && <p className={styles.entryError}>{inviteError}</p>}
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
  const [siteLevelDraftNotifications, setSiteLevelDraftNotifications] = useState<NotificationRecord[]>([]);
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [passwordRecoveryActive, setPasswordRecoveryActive] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [entryState, setEntryState] = useState<ClientEntryState>({ state: "loading" });
  const [showInviteHelp, setShowInviteHelp] = useState(false);
  const [bootstrapName, setBootstrapName] = useState("");
  const [bootstrapSlug, setBootstrapSlug] = useState("");
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const activeOrgId = useActiveOrgStore((state) => state.activeOrgId);
  const orgOptions = useActiveOrgStore((state) => state.options);
  const setOrgOptions = useActiveOrgStore((state) => state.setOptions);
  const setActiveOrgId = useActiveOrgStore((state) => state.setActiveOrgId);
  const clearActiveOrg = useActiveOrgStore((state) => state.clear);
  const activeOrg = orgOptions.find((option) => option.org.id === activeOrgId) || null;
  const appReady = entryState.state === "ready_client";
  const orgLabel = activeOrg?.org.name || "組織未選択";
  const orgTone = activeOrg ? "default" : "warning";
  const viewerEmail = authSession?.user.email || null;

  const resolveEntryState = useCallback(async () => {
    setBootstrapError(null);
    setInviteError(null);

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
    setPasswordRecoveryActive(false);
    setEntryState({ state: "loading" });
    setBootstrapError(null);
    setInviteError(null);
    setShowInviteHelp(false);
    setCommunicationSheetOpen(false);
    setSiteLevelDraftNotifications([]);
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
        if (isPasswordRecoveryRedirect()) {
          setPasswordRecoveryActive(true);
          setEntryState({ state: "loading" });
          return;
        }

        setPasswordRecoveryActive(false);
        void resolveEntryState();
        return;
      }

      if (isDevAuthSessionActive()) {
        setAuthSession(buildDevAuthSession());
        setPasswordRecoveryActive(false);
        void resolveEntryState();
        return;
      }

      handleSignedOut();
    };

    void loadSession();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) {
        return;
      }

      setAuthSession(session);
      setAuthLoading(false);

      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecoveryActive(Boolean(session));
        setEntryState({ state: "loading" });
        return;
      }

      if (session) {
        clearDevAuthSession();
        if (isPasswordRecoveryRedirect()) {
          setPasswordRecoveryActive(true);
          setEntryState({ state: "loading" });
          return;
        }

        setPasswordRecoveryActive(false);
        void resolveEntryState();
        return;
      }

      if (isDevAuthSessionActive()) {
        setAuthSession(buildDevAuthSession());
        setPasswordRecoveryActive(false);
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

  const loadSiteLevelDraftNotifications = useCallback(async () => {
    if (!appReady || !activeOrgId) {
      setSiteLevelDraftNotifications([]);
      return;
    }

    try {
      const notifications = await fetchNotifications({ unread_only: true, limit: 50 });
      setSiteLevelDraftNotifications(notifications.filter(isSiteLevelDraftNotification));
    } catch (error) {
      console.error("Failed to load site level draft notifications:", error);
      setSiteLevelDraftNotifications([]);
    }
  }, [activeOrgId, appReady]);

  useEffect(() => {
    void loadSiteLevelDraftNotifications();
  }, [loadSiteLevelDraftNotifications]);

  useEffect(() => {
    window.addEventListener("site-level-draft-updated", loadSiteLevelDraftNotifications);
    return () => {
      window.removeEventListener("site-level-draft-updated", loadSiteLevelDraftNotifications);
    };
  }, [loadSiteLevelDraftNotifications]);

  const siteLevelDraftCount = siteLevelDraftNotifications.length;
  const bellEnabled = appReady && Boolean(activeOrgId) && siteLevelDraftCount > 0;
  const bellNeedsAttention = siteLevelDraftCount > 0;
  const bellBadgeLabel = siteLevelDraftCount > 0 ? String(siteLevelDraftCount) : null;
  const bellLabel =
    siteLevelDraftCount === 1
      ? `${getSiteLevelDraftSiteName(siteLevelDraftNotifications[0])}のレベル入力があります`
      : `完了現場のレベル入力が${siteLevelDraftCount}件あります`;

  const openBell = useCallback(() => {
    if (!activeOrgId) {
      return;
    }

    const nextNotification = siteLevelDraftNotifications[0];
    if (!nextNotification) {
      return;
    }

    const siteId = getNotificationDataString(nextNotification, "site_id");
    const params = new URLSearchParams();
    if (siteId) {
      params.set("site", siteId);
    }
    params.set("levelDraft", nextNotification.id);
    navigate(`/sites?${params.toString()}`);
  }, [activeOrgId, navigate, siteLevelDraftNotifications]);

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

  const formatInviteError = useCallback((code: string) => {
    if (code === "ORG_INVITE_NOT_FOUND") {
      return "招待が見つかりませんでした。管理者に再招待を依頼してください。";
    }

    if (code === "ORG_INVITE_NOT_PENDING") {
      return "この招待はすでに処理済みです。再読み込みしてください。";
    }

    if (code === "ORG_INVITE_EXPIRED") {
      return "招待の有効期限が切れています。管理者に再招待を依頼してください。";
    }

    if (code === "ORG_INVITE_EMAIL_MISMATCH") {
      return "ログイン中のメールアドレスと招待先が一致していません。招待されたメールでログインしてください。";
    }

    return "招待への参加に失敗しました。時間を置いて再度お試しください。";
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

  const handleAcceptInvite = useCallback(async (inviteId: string) => {
    if (!viewerEmail) {
      setInviteError("ログイン中のメールアドレスを確認できません。別の方法でログインしてください。");
      return;
    }

    try {
      setInviteBusyId(inviteId);
      setInviteError(null);
      const result = await acceptOrgInvite(inviteId);
      setOrgOptions([
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
      ]);
      setActiveOrgId(result.active_org.id);
      setEntryState({ state: "ready_client" });
    } catch (error) {
      setInviteError(formatInviteError(error instanceof Error ? error.message : "ORG_INVITE_ACCEPT_FAILED"));
    } finally {
      setInviteBusyId(null);
    }
  }, [formatInviteError, setActiveOrgId, setOrgOptions, viewerEmail]);

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

  const handlePasswordUpdated = useCallback(() => {
    clearPasswordRecoveryRedirect();
    setPasswordRecoveryActive(false);
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
          inviteBusyId={inviteBusyId}
          inviteError={inviteError}
          onAcceptInvite={(inviteId) => void handleAcceptInvite(inviteId)}
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

  if (passwordRecoveryActive) {
    return (
      <PasswordRecoveryGate
        viewerEmail={viewerEmail}
        onPasswordUpdated={handlePasswordUpdated}
      />
    );
  }

  return (
    <>
      {appReady ? (
        <div className={styles.app}>
          <Navigation
            bellEnabled={bellEnabled}
            bellNeedsAttention={bellNeedsAttention}
            bellBadgeLabel={bellBadgeLabel}
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
