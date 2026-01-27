import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Home, Map, Award, MessageCircle, Menu, X } from "lucide-react";
import { useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import "./styles/genba-quest.css";
import styles from "./App.module.css";

function Navigation() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { path: "/", label: "ダッシュボード", icon: Home },
    { path: "/sites", label: "現場", icon: Map },
    { path: "/perks", label: "パーク", icon: Award },
    { path: "/sherpa", label: "シェルパ", icon: MessageCircle },
  ];

  return (
    <>
      <header className={styles.header}>
        <Link to="/" className={styles.logo}>
          🏗️ GENBA QUEST
        </Link>

        {/* デスクトップナビ */}
        <nav className={styles.desktopNav}>
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`${styles.navLink} ${location.pathname === item.path ? styles.active : ""
                }`}
            >
              <item.icon size={18} />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* モバイルメニューボタン */}
        <button
          className={styles.menuButton}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </header>

      {/* モバイルナビ */}
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
                className={`${styles.mobileNavLink} ${location.pathname === item.path ? styles.active : ""
                  }`}
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

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className={styles.placeholder}>
      <h1>{title}</h1>
      <p>このページは開発中です</p>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div className={styles.app}>
        <Navigation />
        <main className={styles.main}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/sites" element={<PlaceholderPage title="現場管理" />} />
            <Route path="/perks" element={<PlaceholderPage title="パークツリー" />} />
            <Route path="/sherpa" element={<PlaceholderPage title="シェルパチャット" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
