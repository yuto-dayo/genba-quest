import { useEffect, useState } from 'react';
import { fetchPL } from '../../lib/api';
import styles from './TodayComponents.module.css';

interface SiteSummaryTarget {
    id: string;
    name: string;
}

interface MonthlySummaryProps {
    sites: SiteSummaryTarget[];
}

interface SiteNumberReport {
    sales: number;
    expenses: number;
}

const EMPTY_REPORT: SiteNumberReport = {
    sales: 0,
    expenses: 0,
};

function formatCurrency(value: number) {
    const sign = value < 0 ? '-' : '';
    return `${sign}¥${Math.abs(value).toLocaleString('ja-JP')}`;
}

export function MonthlySummary({ sites }: MonthlySummaryProps) {
    const [reportsBySiteId, setReportsBySiteId] = useState<Record<string, SiteNumberReport>>({});
    const siteIdsKey = sites.map((site) => site.id).join('|');

    useEffect(() => {
        let cancelled = false;

        const loadPL = async () => {
            if (sites.length === 0) {
                setReportsBySiteId({});
                return;
            }

            try {
                const now = new Date();
                const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                const reports = await Promise.all(
                    sites.map(async (site) => {
                        const report = await fetchPL({ month: monthStr, site_id: site.id });
                        return [site.id, { sales: report.sales, expenses: report.expenses }] as const;
                    })
                );

                if (cancelled) {
                    return;
                }

                setReportsBySiteId(Object.fromEntries(reports));
            } catch (err) {
                console.error("Failed to load site PL", err);
            }
        };
        loadPL();

        return () => {
            cancelled = true;
        };
    }, [sites, siteIdsKey]);

    return (
        <div className={styles.summaryContainer}>
            {sites.length === 0 ? (
                <div className={styles.summaryCard}>
                    <span className={styles.summarySiteName}>今日の現場はありません</span>
                    <span className={styles.summaryNote}>現場が入ると数字を表示します</span>
                </div>
            ) : (
                sites.map((site) => {
                    const report = reportsBySiteId[site.id] || EMPTY_REPORT;
                    const profit = report.sales - report.expenses;

                    return (
                        <article key={site.id} className={styles.summaryCard}>
                            <span className={styles.summarySiteName}>{site.name}</span>
                            <div className={styles.summaryMetrics}>
                                <div className={styles.summaryMetric}>
                                    <span className={styles.summaryLabel}>売上</span>
                                    <strong className={`${styles.summaryValue} ${styles.income}`}>
                                        {formatCurrency(report.sales)}
                                    </strong>
                                </div>
                                <div className={styles.summaryMetric}>
                                    <span className={styles.summaryLabel}>経費</span>
                                    <strong className={`${styles.summaryValue} ${styles.expense}`}>
                                        {formatCurrency(-report.expenses)}
                                    </strong>
                                </div>
                                <div className={styles.summaryMetric}>
                                    <span className={styles.summaryLabel}>利益</span>
                                    <strong className={`${styles.summaryValue} ${profit >= 0 ? styles.income : styles.expense}`}>
                                        {formatCurrency(profit)}
                                    </strong>
                                </div>
                            </div>
                        </article>
                    );
                })
            )}
        </div>
    );
}
