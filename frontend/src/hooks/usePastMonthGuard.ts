import { useEffect, useMemo, useState } from "react";
import { fetchMonthCloseStatus } from "../lib/api";

export function usePastMonthGuard(selectedMonth: string) {
    const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
    const isPast = selectedMonth < currentMonth;

    const [isFinalized, setIsFinalized] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetchMonthCloseStatus(selectedMonth)
            .then((result) => {
                if (!cancelled) {
                    setIsFinalized(result?.status === "closed");
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setIsFinalized(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [selectedMonth]);

    return {
        isPast,
        isFinalized,
        readOnly: isPast || isFinalized,
    };
}
