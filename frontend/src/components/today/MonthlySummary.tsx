import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { fetchPL } from '../../lib/api';
import styles from './TodayComponents.module.css';

export function MonthlySummary() {
    const [sales, setSales] = useState(0);
    const [expenses, setExpenses] = useState(0);

    useEffect(() => {
        const loadPL = async () => {
            try {
                const now = new Date();
                const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                const data = await fetchPL({ month: monthStr });
                setSales(data.sales);
                setExpenses(data.expenses);
            } catch (err) {
                console.error("Failed to load PL", err);
            }
        };
        loadPL();
    }, []);

    return (
        <div className={styles.summaryContainer}>
            <div className={styles.summaryCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className={styles.summaryLabel}>今月の売上</span>
                    <TrendingUp size={16} className={styles.income} />
                </div>
                <span className={`${styles.summaryValue} ${styles.income}`}>
                    ¥{sales.toLocaleString()}
                </span>
            </div>
            <div className={styles.summaryCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className={styles.summaryLabel}>今月の経費</span>
                    <TrendingDown size={16} className={styles.expense} />
                </div>
                <span className={`${styles.summaryValue} ${styles.expense}`}>
                    -¥{expenses.toLocaleString()}
                </span>
            </div>
        </div>
    );
}
