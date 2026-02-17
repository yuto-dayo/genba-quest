import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarDays, Map, DollarSign, Menu, X, HardHat, Sun } from "lucide-react";
import { useState } from "react";
import { Today } from "./pages/Today";
import { Calendar } from "./pages/Calendar";
import { Sites } from "./pages/Sites";
import { Money } from "./pages/Money";
import { SherpaFAB } from "./components/FloatingActionButton";
import { SherpaChat } from "./components/SherpaChat";
import "./styles/genba-quest.css";
import styles from "./App.module.css";

function Navigation() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { path: "/", label: "今日", icon: Sun },
    { path: "/calendar", label: "スケジュール", icon: CalendarDays },
    { path: "/sites", label: "現場", icon: Map },
    { path: "/money", label: "お金", icon: DollarSign },
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

        {/* Mobile Menu Button */}
        <button
          className={styles.menuButton}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
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

  return (
    <BrowserRouter>
      <div className={styles.app}>
        <Navigation />
        <main className={styles.main}>
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/sites" element={<Sites />} />
            <Route path="/money" element={<Money />} />
          </Routes>
        </main>

        {/* Sherpa FAB + Chat */}
        <SherpaFAB onClick={() => setSherpaOpen(true)} />
        <SherpaChat
          open={sherpaOpen}
          onClose={() => setSherpaOpen(false)}
        />
      </div>
    </BrowserRouter>
  );
}

export default App;
