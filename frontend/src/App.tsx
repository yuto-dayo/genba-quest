import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarDays, Map, DollarSign, Menu, X, HardHat, Sun, Star, Settings2, Bell, Bot, CircleAlert, MessagesSquare } from "lucide-react";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Today } from "./pages/Today";
import { Calendar } from "./pages/Calendar";
import { Sites } from "./pages/Sites";
import { Money } from "./pages/Money";
import { Settings } from "./pages/Settings";
import { Communications } from "./pages/Communications";
import LUQOPage from "./pages/LUQO";
import { FloatingActionButton, SherpaFAB } from "./components/FloatingActionButton";
import { SherpaChat } from "./components/SherpaChat";
import { MonthlyEvaluationModal } from "./components/today/MonthlyEvaluationModal";
import { fetchPathForms } from "./lib/api";
import { supabase } from "./lib/supabase";
import "./styles/genba-quest.css";
import styles from "./App.module.css";

const MONTHLY_EVALUATION_START_DAY = 25;

function isMonthlyEvaluationWindow(date: Date) {
  return date.getDate() >= MONTHLY_EVALUATION_START_DAY;
}

function formatMonthLabel(date: Date) {
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, "0")}月`;
}

function formatMonthValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkViewport = () => {
      setIsMobile(window.innerWidth <= 768 || "ontouchstart" in window);
    };

    checkViewport();
    window.addEventListener("resize", checkViewport);
    return () => window.removeEventListener("resize", checkViewport);
  }, []);

  return isMobile;
}

function Navigation({
  monthlyEvaluationEnabled,
  monthlyEvaluationPending,
  monthlyEvaluationPreviewMode,
  monthlyEvaluationStatusLoading,
  monthlyEvaluationMonthLabel,
  onOpenMonthlyEvaluation,
}: {
  monthlyEvaluationEnabled: boolean;
  monthlyEvaluationPending: boolean;
  monthlyEvaluationPreviewMode: boolean;
  monthlyEvaluationStatusLoading: boolean;
  monthlyEvaluationMonthLabel: string;
  onOpenMonthlyEvaluation: () => void;
}) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { path: "/", label: "今日", icon: Sun },
    { path: "/calendar", label: "スケジュール", icon: CalendarDays },
    { path: "/sites", label: "現場", icon: Map },
    { path: "/communications", label: "連絡", icon: MessagesSquare },
    { path: "/money", label: "お金", icon: DollarSign },
    { path: "/luqo", label: "LUQO", icon: Star },
  ];

  return (
    <>
      <header className={styles.header}>
        <Link to="/" className={styles.logo}>
          <HardHat size={24} className={styles.logoIcon} />
          GENBA QUEST
        </Link>

        {/* Desktop Nav */}
        <nav className={styles.desktopNav}>
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`${styles.navLink} ${location.pathname === item.path ? styles.active : ""}`}
            >
              <item.icon size={18} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.headerRight}>
          {monthlyEvaluationEnabled && (
            <button
              type="button"
              className={`${styles.bellButton} ${
                monthlyEvaluationPending ? styles.bellButtonPending : styles.bellButtonDone
              }`}
              onClick={onOpenMonthlyEvaluation}
              aria-label={
                monthlyEvaluationStatusLoading
                  ? "月末フォームの状態を確認中"
                  : monthlyEvaluationPending
                    ? `${monthlyEvaluationMonthLabel}の月末フォームが未入力です`
                    : `${monthlyEvaluationMonthLabel}の月末フォームを確認`
              }
              title={
                monthlyEvaluationPreviewMode
                  ? `${monthlyEvaluationMonthLabel}の月末フォームをプレビュー`
                  : monthlyEvaluationPending
                    ? `${monthlyEvaluationMonthLabel}の月末フォームを入力`
                    : `${monthlyEvaluationMonthLabel}の月末フォームを確認`
              }
            >
              <Bell
                size={20}
                className={monthlyEvaluationPending ? styles.bellIconPending : undefined}
              />
              {monthlyEvaluationPending && <span className={styles.bellBadge}>!</span>}
            </button>
          )}
          <Link
            to="/settings"
            className={`${styles.iconButton} ${location.pathname === "/settings" ? styles.iconButtonActive : ""}`}
            aria-label="設定"
          >
            <Settings2 size={20} />
          </Link>

          {/* Mobile Menu Button */}
          <button
            className={styles.menuButton}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </header>

      {/* Mobile Nav */}
      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            className={styles.mobileNav}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`${styles.mobileNavLink} ${location.pathname === item.path ? styles.active : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                <item.icon size={20} />
                {item.label}
              </Link>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  );
}

function App() {
  const [sherpaOpen, setSherpaOpen] = useState(false);
  const isMobile = useIsMobileViewport();

  return (
    <BrowserRouter>
      <AppContent
        sherpaOpen={sherpaOpen}
        setSherpaOpen={setSherpaOpen}
        isMobile={isMobile}
      />
    </BrowserRouter>
  );
}

function AppContent({
  sherpaOpen,
  setSherpaOpen,
  isMobile,
}: {
  sherpaOpen: boolean;
  setSherpaOpen: Dispatch<SetStateAction<boolean>>;
  isMobile: boolean;
}) {
  const location = useLocation();
  const hideSherpaFab =
    location.pathname === "/sites" ||
    (isMobile && location.pathname === "/money");
  const [showMonthlyEvaluationModal, setShowMonthlyEvaluationModal] = useState(false);
  const [monthlyEvaluationSubmitted, setMonthlyEvaluationSubmitted] = useState(false);
  const [monthlyEvaluationStatusLoading, setMonthlyEvaluationStatusLoading] = useState(false);
  const monthlyEvaluationPreviewMode =
    new URLSearchParams(location.search).get("month_end_form_preview") === "1";
  const monthlyEvaluationDate = new Date();
  const monthlyEvaluationEnabled =
    monthlyEvaluationPreviewMode || isMonthlyEvaluationWindow(monthlyEvaluationDate);
  const monthlyEvaluationMonthLabel = formatMonthLabel(monthlyEvaluationDate);
  const monthlyEvaluationMonthValue = formatMonthValue(monthlyEvaluationDate);

  const loadMonthlyEvaluationStatus = useCallback(async () => {
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
  }, [monthlyEvaluationEnabled, monthlyEvaluationMonthValue]);

  useEffect(() => {
    void loadMonthlyEvaluationStatus();
  }, [loadMonthlyEvaluationStatus]);

  const monthlyEvaluationPending =
    monthlyEvaluationEnabled && !monthlyEvaluationStatusLoading && !monthlyEvaluationSubmitted;
  const openTodayFocusComposer = useCallback(() => {
    window.dispatchEvent(new CustomEvent("today:open-focus-item-composer"));
  }, []);

  return (
    <>
      <div className={styles.app}>
        <Navigation
          monthlyEvaluationEnabled={monthlyEvaluationEnabled}
          monthlyEvaluationPending={monthlyEvaluationPending}
          monthlyEvaluationPreviewMode={monthlyEvaluationPreviewMode}
          monthlyEvaluationStatusLoading={monthlyEvaluationStatusLoading}
          monthlyEvaluationMonthLabel={monthlyEvaluationMonthLabel}
          onOpenMonthlyEvaluation={() => setShowMonthlyEvaluationModal(true)}
        />
        <main className={styles.main}>
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/sites" element={<Sites />} />
            <Route path="/money" element={<Money />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/communications" element={<Communications />} />
            <Route path="/luqo" element={<LUQOPage />} />
          </Routes>
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

        {/* Sherpa FAB + Chat */}
        {!hideSherpaFab &&
          (location.pathname === "/" ? (
            <FloatingActionButton
              behavior="draggable"
              items={[
                {
                  id: "today-focus-item",
                  label: "解決事項を追加",
                  icon: <CircleAlert size={20} />,
                  onClick: openTodayFocusComposer,
                },
                {
                  id: "sherpa",
                  label: "Sherpa",
                  icon: <Bot size={20} />,
                  onClick: () => setSherpaOpen(true),
                },
              ]}
            />
          ) : (
            <SherpaFAB onClick={() => setSherpaOpen(true)} />
          ))}
        <SherpaChat
          open={sherpaOpen}
          onClose={() => setSherpaOpen(false)}
        />
      </div>
    </>
  );
}

export default App;
