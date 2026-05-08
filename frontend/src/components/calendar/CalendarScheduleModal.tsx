import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
    AlertTriangle,
    BriefcaseBusiness,
    CalendarDays,
    CalendarPlus2,
    Check,
    ChevronLeft,
    ChevronRight,
    Clock,
    Loader2,
    MapPin,
    X,
} from 'lucide-react';
import {
    fetchMembers,
    fetchSites,
    submitAssignmentCreateProposal,
    submitPersonalScheduleProposal,
    type Member,
    type PersonalScheduleType,
    type PersonalScheduleVisibility,
    type Site,
} from '../../lib/api';
import type { CalendarScope } from '../../types/calendarCockpit';
import styles from './CalendarScheduleModal.module.css';

type ModalMode = 'menu' | 'personal' | 'assignment';
type DateTimePickerTarget = 'startDate' | 'endDate' | 'startTime' | 'endTime';
type DatePickerTarget = Extract<DateTimePickerTarget, 'startDate' | 'endDate'>;
type TimePickerTarget = Extract<DateTimePickerTarget, 'startTime' | 'endTime'>;
type TimePart = 'hour' | 'minute';

interface CalendarScheduleModalProps {
    initialDate: string;
    scope: CalendarScope;
    initialMode?: ModalMode;
    defaultMemberId?: string | null;
    onClose: () => void;
    onCreated: () => Promise<void> | void;
}

const SCHEDULE_TYPE_LABELS: Record<PersonalScheduleType, string> = {
    event: '予定',
    task: 'タスク',
    vacation: '休み',
    sick_leave: '病欠',
    business_trip: '出張',
    training: '研修',
};

const SCHEDULE_TYPE_OPTIONS: PersonalScheduleType[] = ['event', 'task'];

const VISIBILITY_OPTIONS: Array<{ value: PersonalScheduleVisibility; label: string }> = [
    { value: 'personal', label: '自分だけ' },
    { value: 'organization', label: '組織にも表示' },
];
const SCHEDULE_COLOR_OPTIONS = [
    { value: '#0D9488', label: '青緑' },
    { value: '#F97316', label: '橙' },
    { value: '#2563EB', label: '青' },
    { value: '#7C3AED', label: '紫' },
    { value: '#DC2626', label: '赤' },
    { value: '#CA8A04', label: '黄' },
];
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const COMMON_TIME_OPTIONS = ['08:00', '09:00', '10:00', '12:00', '13:00', '15:00', '17:00', '18:00'];
const HOUR_OPTIONS = Array.from(new Set(COMMON_TIME_OPTIONS.map((time) => time.slice(0, 2))));
const MINUTE_OPTIONS = ['00', '15', '30', '45'];
const TIME_PART_CHIP_ACTIVATION_DELAY_MS = 80;
const TIME_VALUE_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function getMemberLabel(member: Member): string {
    return member.full_name || member.display_name || member.username || member.id;
}

function isValidTimeRange(isAllDay: boolean, startDate: string, endDate: string, startTime: string, endTime: string): boolean {
    if (isAllDay) {
        return true;
    }
    if (!startTime || !endTime) {
        return false;
    }
    if (!TIME_VALUE_PATTERN.test(startTime) || !TIME_VALUE_PATTERN.test(endTime)) {
        return false;
    }
    if (startDate < endDate) {
        return true;
    }
    return startTime < endTime;
}

function blocksAssignmentForScheduleType(type: PersonalScheduleType): boolean {
    return type === 'vacation' || type === 'sick_leave';
}

function toDateValue(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function shiftDateValue(value: string, dayOffset: number): string {
    const parsed = parseDateValue(value);
    if (!parsed) {
        return value;
    }
    parsed.setDate(parsed.getDate() + dayOffset);
    return toDateValue(parsed);
}

function parseDateValue(value: string): Date | null {
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) {
        return null;
    }
    return new Date(year, month - 1, day);
}

function formatDisplayDate(value: string): string {
    const parsed = parseDateValue(value);
    if (!parsed) {
        return '日付';
    }
    return `${parsed.getFullYear()}/${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getDate()).padStart(2, '0')}`;
}

function formatMonthTitle(date: Date): string {
    return `${date.getFullYear()}年 ${date.getMonth() + 1}月`;
}

function getCalendarDays(monthDate: Date) {
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startDate = new Date(firstDay);
    startDate.setDate(firstDay.getDate() - firstDay.getDay());
    const today = toDateValue(new Date());

    return Array.from({ length: 42 }, (_, index) => {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + index);
        const value = toDateValue(date);
        return {
            value,
            day: date.getDate(),
            isCurrentMonth: date.getMonth() === monthDate.getMonth(),
            isToday: value === today,
        };
    });
}

function addMinutesToTime(value: string, minutes: number): { time: string; dayOffset: number } {
    const [hour, minute] = value.split(':').map(Number);
    const totalMinutes = hour * 60 + minute + minutes;
    const dayOffset = Math.floor(totalMinutes / 1440);
    const normalized = ((totalMinutes % 1440) + 1440) % 1440;
    const nextHour = String(Math.floor(normalized / 60)).padStart(2, '0');
    const nextMinute = String(normalized % 60).padStart(2, '0');
    return { time: `${nextHour}:${nextMinute}`, dayOffset };
}

function splitTimeParts(value: string): { hour: string; minute: string } {
    if (!TIME_VALUE_PATTERN.test(value)) {
        return { hour: '', minute: '' };
    }
    const [hour, minute] = value.split(':');
    return { hour, minute };
}

function normalizeTimeInputText(value: string): string {
    return value.replace(/[０-９]/g, (character) =>
        String.fromCharCode(character.charCodeAt(0) - 0xfee0)
    );
}

function parseLooseTimeInput(value: string): string | null {
    const normalized = normalizeTimeInputText(value).trim().replace(/[：.]/g, ':');
    const colonMatch = normalized.match(/^(\d{1,2}):(\d{1,2})$/);

    if (colonMatch) {
        const hour = Number(colonMatch[1]);
        const minute = Number(colonMatch[2]);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
            return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        }
        return null;
    }

    const digits = normalized.replace(/\D/g, '');
    if (!digits) {
        return null;
    }

    const hourText = digits.length <= 2 ? digits : digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
    const minuteText = digits.length <= 2 ? '00' : digits.length === 3 ? digits.slice(1, 3) : digits.slice(2, 4);
    const hour = Number(hourText);
    const minute = Number(minuteText);

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }

    return null;
}

function isValidTimePart(value: string, max: number): boolean {
    if (!/^\d{1,2}$/.test(value)) {
        return false;
    }
    const numberValue = Number(value);
    return numberValue >= 0 && numberValue <= max;
}

function normalizeTimeDraft(hour: string, minute: string, fillEmptyMinute = false): string | null {
    if (!hour && !minute) {
        return null;
    }
    if (!hour || !isValidTimePart(hour, 23)) {
        return null;
    }

    const normalizedMinute = minute || (fillEmptyMinute ? '00' : '');
    if (!normalizedMinute || !isValidTimePart(normalizedMinute, 59)) {
        return null;
    }

    return `${String(Number(hour)).padStart(2, '0')}:${String(Number(normalizedMinute)).padStart(2, '0')}`;
}

function getTimeDraftError(hour: string, minute: string): string | null {
    if (!hour && !minute) {
        return null;
    }
    if (minute && !hour) {
        return '時を入力してください。';
    }
    if (hour && !isValidTimePart(hour, 23)) {
        return '時は0〜23で入力してください。';
    }
    if (minute && !isValidTimePart(minute, 59)) {
        return '分は0〜59で入力してください。';
    }
    return null;
}

function getPickerTitle(target: DateTimePickerTarget): string {
    switch (target) {
        case 'startDate':
            return '開始日';
        case 'endDate':
            return '終了日';
        case 'startTime':
            return '開始時刻';
        case 'endTime':
            return '終了時刻';
    }
}

export function CalendarScheduleModal({
    initialDate,
    scope,
    initialMode,
    defaultMemberId = null,
    onClose,
    onCreated,
}: CalendarScheduleModalProps) {
    const [mode, setMode] = useState<ModalMode>(scope === 'personal' ? 'personal' : initialMode ?? 'menu');
    const [sites, setSites] = useState<Site[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [siteId, setSiteId] = useState('');
    const [memberId, setMemberId] = useState(defaultMemberId ?? '');
    const [date, setDate] = useState(initialDate);
    const [endDate, setEndDate] = useState(initialDate);
    const [note, setNote] = useState('');
    const [address, setAddress] = useState('');
    const [scheduleType, setScheduleType] = useState<PersonalScheduleType>('event');
    const [title, setTitle] = useState('');
    const [isAllDay, setIsAllDay] = useState(false);
    const [activePicker, setActivePicker] = useState<DateTimePickerTarget | null>(null);
    const [calendarMonth, setCalendarMonth] = useState(() => parseDateValue(initialDate) || new Date());
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [timeDraft, setTimeDraft] = useState<{ target: TimePickerTarget | null; hour: string; minute: string }>({
        target: null,
        hour: '',
        minute: '',
    });
    const [activeTimePart, setActiveTimePart] = useState<TimePart | null>(null);
    const [visibility, setVisibility] = useState<PersonalScheduleVisibility>('personal');
    const [scheduleColor, setScheduleColor] = useState(SCHEDULE_COLOR_OPTIONS[0].value);
    const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
    const [isLoadingOptions, setIsLoadingOptions] = useState(scope === 'organization');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const minuteInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const scrollY = window.scrollY;
        const previousOverflow = document.body.style.overflow;
        const previousPosition = document.body.style.position;
        const previousTop = document.body.style.top;
        const previousWidth = document.body.style.width;

        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.top = `-${scrollY}px`;
        document.body.style.width = '100%';

        return () => {
            document.body.style.overflow = previousOverflow;
            document.body.style.position = previousPosition;
            document.body.style.top = previousTop;
            document.body.style.width = previousWidth;
            window.scrollTo(0, scrollY);
        };
    }, []);

    useEffect(() => {
        setDate(initialDate);
        setEndDate(initialDate);
        const parsed = parseDateValue(initialDate);
        if (parsed) {
            setCalendarMonth(parsed);
        }
    }, [initialDate]);

    useEffect(() => {
        if (scope !== 'organization') {
            return;
        }

        let active = true;

        const loadOptions = async () => {
            setIsLoadingOptions(true);
            try {
                const [sitesData, membersData] = await Promise.all([
                    fetchSites(),
                    fetchMembers(),
                ]);

                if (!active) {
                    return;
                }

                setSites(sitesData);
                setMembers(membersData);

                const selectableSites = sitesData.filter((site) =>
                    ['active', 'in_progress'].includes(site.status)
                );

                setSiteId((current) => current || selectableSites[0]?.id || sitesData[0]?.id || '');
                setMemberId((current) => current || defaultMemberId || membersData[0]?.id || '');
            } catch (loadError) {
                console.error('Failed to load schedule modal options:', loadError);
                if (active) {
                    setError('候補を読み込めませんでした。時間をおいてもう一度お試しください。');
                }
            } finally {
                if (active) {
                    setIsLoadingOptions(false);
                }
            }
        };

        void loadOptions();

        return () => {
            active = false;
        };
    }, [defaultMemberId, scope]);

    useEffect(() => {
        if (blocksAssignmentForScheduleType(scheduleType)) {
            setVisibility('organization');
        }
    }, [scheduleType]);

    const activeSites = useMemo(() => {
        const selectable = sites.filter((site) => ['active', 'in_progress'].includes(site.status));
        return selectable.length > 0 ? selectable : sites;
    }, [sites]);

    const selectedSite = activeSites.find((site) => site.id === siteId) || null;
    const selectedMember = members.find((member) => member.id === memberId) || null;
    const isVisibilityForced = blocksAssignmentForScheduleType(scheduleType);
    const calendarDays = useMemo(() => getCalendarDays(calendarMonth), [calendarMonth]);
    const activeTime = activePicker === 'startTime' ? startTime : activePicker === 'endTime' ? endTime : '';
    const activeTimeDraft =
        (activePicker === 'startTime' || activePicker === 'endTime') && timeDraft.target === activePicker
            ? timeDraft
            : { target: null, ...splitTimeParts(activeTime) };
    const timeDraftError =
        activePicker === 'startTime' || activePicker === 'endTime'
            ? getTimeDraftError(activeTimeDraft.hour, activeTimeDraft.minute)
            : null;
    const selectedPickerDate = activePicker === 'endDate' ? endDate : date;
    const selectedScheduleColor =
        SCHEDULE_COLOR_OPTIONS.find((option) => option.value === scheduleColor) || SCHEDULE_COLOR_OPTIONS[0];
    const addressText = address.trim();

    const personalTitle = title.trim();
    const personalError =
        !date
            ? '日付を選んでください。'
            : !endDate
              ? '終了日を選んでください。'
              : date > endDate
                ? '終了日は開始日以降にしてください。'
                : !personalTitle
                  ? 'タイトルを入力してください。'
                  : !isValidTimeRange(isAllDay, date, endDate, startTime, endTime)
                    ? '終日をOFFにした場合は、開始と終了の時刻を正しく入力してください。'
                    : null;

    const canSubmitPersonal = !isSubmitting && personalError === null;
    const canSubmitAssignment =
        !isLoadingOptions &&
        !isSubmitting &&
        Boolean(siteId) &&
        Boolean(memberId) &&
        Boolean(date);

    const openPersonalForm = () => {
        setError(null);
        setMode('personal');
    };

    const handleScheduleTypeChange = (nextType: PersonalScheduleType) => {
        setScheduleType(nextType);
        setVisibility((current) =>
            blocksAssignmentForScheduleType(nextType)
                ? 'organization'
                : blocksAssignmentForScheduleType(scheduleType)
                  ? 'personal'
                  : current
        );
    };

    const handleAllDayToggle = () => {
        if (!isAllDay) {
            setStartTime('');
            setEndTime('');
            setActivePicker(null);
            setTimeDraft({ target: null, hour: '', minute: '' });
            setActiveTimePart(null);
        }
        setIsAllDay((current) => !current);
    };

    const switchDatePickerTarget = (target: DatePickerTarget) => {
        const parsed = parseDateValue(target === 'endDate' ? endDate : date);
        if (parsed) {
            setCalendarMonth(parsed);
        }
        setActivePicker(target);
    };

    const switchTimePickerTarget = (target: TimePickerTarget) => {
        setTimeDraft({
            target,
            ...splitTimeParts(target === 'startTime' ? startTime : endTime),
        });
        setActivePicker(target);
        setActiveTimePart(null);
    };

    const openDatePicker = (target: DateTimePickerTarget) => {
        const parsed = parseDateValue(target === 'endDate' ? endDate : date);
        if (parsed) {
            setCalendarMonth(parsed);
        }
        setActivePicker((current) => (current === target ? null : target));
    };

    const openTimePicker = (target: TimePickerTarget) => {
        if (activePicker === target) {
            setActivePicker(null);
            setTimeDraft({ target: null, hour: '', minute: '' });
            setActiveTimePart(null);
            return;
        }

        switchTimePickerTarget(target);
    };

    const handleDateSelect = (nextDate: string) => {
        if (activePicker === 'endDate') {
            setEndDate(nextDate);
            const parsed = parseDateValue(nextDate);
            if (parsed) {
                setCalendarMonth(parsed);
            }
            setActivePicker(null);
            return;
        }

        if (activePicker === 'startDate') {
            setDate(nextDate);
            const nextEndDate = endDate < nextDate ? nextDate : endDate;
            if (nextEndDate !== endDate) {
                setEndDate(nextEndDate);
            }
            const parsed = parseDateValue(nextEndDate);
            if (parsed) {
                setCalendarMonth(parsed);
            }
            setActivePicker('endDate');
        } else {
            setDate(nextDate);
            const parsed = parseDateValue(nextDate);
            if (parsed) {
                setCalendarMonth(parsed);
            }
            setActivePicker(null);
        }
    };

    const handleMonthChange = (offset: number) => {
        setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
    };

    const handleTimeSelect = (nextTime: string, shouldAdvanceFromStart = true) => {
        if (activePicker !== 'startTime' && activePicker !== 'endTime') {
            return;
        }

        if (activePicker === 'startTime') {
            setStartTime(nextTime);
            let nextEndTimeValue = endTime;
            let nextEndDateValue = endDate;
            if (!TIME_VALUE_PATTERN.test(endTime) || endDate < date || (endDate === date && endTime <= nextTime)) {
                const nextEnd = addMinutesToTime(nextTime, 60);
                const minimumEndDate = shiftDateValue(date, nextEnd.dayOffset);
                setEndTime(nextEnd.time);
                setEndDate((current) => (current < minimumEndDate ? minimumEndDate : current));
                nextEndTimeValue = nextEnd.time;
                nextEndDateValue = endDate < minimumEndDate ? minimumEndDate : endDate;
            }
            if (shouldAdvanceFromStart) {
                setTimeDraft({ target: 'endTime', ...splitTimeParts(nextEndTimeValue) });
                setActivePicker('endTime');
                const parsedEndDate = parseDateValue(nextEndDateValue);
                if (parsedEndDate) {
                    setCalendarMonth(parsedEndDate);
                }
            } else {
                setTimeDraft({ target: 'startTime', ...splitTimeParts(nextTime) });
            }
        } else {
            setEndTime(nextTime);
            setTimeDraft({ target: activePicker, ...splitTimeParts(nextTime) });
        }
        setActiveTimePart(null);
    };

    const handleTimePartChange = (part: 'hour' | 'minute', rawValue: string) => {
        if (activePicker !== 'startTime' && activePicker !== 'endTime') {
            return;
        }

        setActiveTimePart(part);
        const normalizedValue = normalizeTimeInputText(rawValue);
        const parsedTime = parseLooseTimeInput(normalizedValue);
        const digits = normalizedValue.replace(/\D/g, '');
        if ((rawValue.includes(':') || rawValue.includes('：') || rawValue.includes('.') || digits.length > 2) && parsedTime) {
            handleTimeSelect(parsedTime, false);
            return;
        }

        const nextDraft = {
            target: activePicker,
            hour: part === 'hour' ? digits.slice(0, 2) : activeTimeDraft.hour,
            minute: part === 'minute' ? digits.slice(0, 2) : activeTimeDraft.minute,
        };

        setTimeDraft(nextDraft);

        const shouldCommit =
            (part === 'hour' && nextDraft.hour.length === 2 && Boolean(nextDraft.minute)) ||
            (part === 'minute' && Boolean(nextDraft.hour) && nextDraft.minute.length === 2);
        const normalizedTime = shouldCommit ? normalizeTimeDraft(nextDraft.hour, nextDraft.minute) : null;
        if (normalizedTime) {
            handleTimeSelect(normalizedTime, false);
        }

        if (part === 'hour' && nextDraft.hour.length === 2) {
            minuteInputRef.current?.focus();
            minuteInputRef.current?.select();
        }
    };

    const handleHourSelect = (hour: string) => {
        if (activePicker !== 'startTime' && activePicker !== 'endTime') {
            return;
        }

        const nextDraft = {
            target: activePicker,
            hour,
            minute: activeTimeDraft.minute,
        };

        setTimeDraft(nextDraft);
        const normalizedTime = normalizeTimeDraft(nextDraft.hour, nextDraft.minute);
        if (normalizedTime) {
            handleTimeSelect(normalizedTime, false);
        }

        minuteInputRef.current?.focus();
        minuteInputRef.current?.select();
        setActiveTimePart('minute');
    };

    const handleTimePartBlur = (part: 'hour' | 'minute') => {
        if (activePicker !== 'startTime' && activePicker !== 'endTime') {
            return;
        }

        setTimeDraft((currentDraft) => {
            const sourceDraft = currentDraft.target === activePicker ? currentDraft : activeTimeDraft;
            const nextDraft = {
                target: activePicker,
                hour:
                    part === 'hour' && sourceDraft.hour.length === 1 && isValidTimePart(sourceDraft.hour, 23)
                        ? sourceDraft.hour.padStart(2, '0')
                        : sourceDraft.hour,
                minute:
                    part === 'minute' && sourceDraft.minute.length === 1 && isValidTimePart(sourceDraft.minute, 59)
                        ? sourceDraft.minute.padStart(2, '0')
                        : sourceDraft.minute,
            };

            const normalizedTime = normalizeTimeDraft(nextDraft.hour, nextDraft.minute);
            if (normalizedTime) {
                if (activePicker === 'startTime') {
                    setStartTime(normalizedTime);
                    if (
                        !TIME_VALUE_PATTERN.test(endTime) ||
                        endDate < date ||
                        (endDate === date && endTime <= normalizedTime)
                    ) {
                        const nextEnd = addMinutesToTime(normalizedTime, 60);
                        const minimumEndDate = shiftDateValue(date, nextEnd.dayOffset);
                        setEndTime(nextEnd.time);
                        setEndDate((current) => (current < minimumEndDate ? minimumEndDate : current));
                    }
                } else {
                    setEndTime(normalizedTime);
                }
            }

            return nextDraft;
        });
    };

    const handleMinuteSelect = (minute: string) => {
        if (activePicker !== 'startTime' && activePicker !== 'endTime') {
            return;
        }

        setActiveTimePart('minute');
        const nextDraft = {
            target: activePicker,
            hour: activeTimeDraft.hour,
            minute,
        };

        setTimeDraft(nextDraft);
        const normalizedTime = normalizeTimeDraft(nextDraft.hour, nextDraft.minute);
        if (normalizedTime) {
            handleTimeSelect(normalizedTime, false);
        }
    };

    const handleTimePickerDone = () => {
        if (activePicker !== 'startTime' && activePicker !== 'endTime') {
            setActivePicker(null);
            return;
        }

        if (!activeTimeDraft.hour && !activeTimeDraft.minute) {
            setActivePicker(null);
            setTimeDraft({ target: null, hour: '', minute: '' });
            setActiveTimePart(null);
            return;
        }

        const normalizedTime = normalizeTimeDraft(activeTimeDraft.hour, activeTimeDraft.minute, true);
        if (!normalizedTime) {
            return;
        }

        const pickerBeforeDone = activePicker;
        handleTimeSelect(normalizedTime, true);
        if (pickerBeforeDone === 'startTime') {
            return;
        }
        setActivePicker(null);
        setTimeDraft({ target: null, hour: '', minute: '' });
        setActiveTimePart(null);
    };

    const handleSubmitPersonal = async () => {
        if (!canSubmitPersonal) {
            setError(personalError);
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            await submitPersonalScheduleProposal({
                start_date: date,
                end_date: endDate,
                schedule_type: scheduleType,
                title: personalTitle,
                start_time: isAllDay ? undefined : startTime || undefined,
                end_time: isAllDay ? undefined : endTime || undefined,
                address: addressText || undefined,
                color: scheduleColor,
                visibility,
            });

            await onCreated();
            onClose();
        } catch (submitError) {
            console.error('Failed to create personal schedule proposal:', submitError);
            setError('予定を入れられませんでした。入力を確認してもう一度お試しください。');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmitAssignment = async () => {
        if (!selectedSite || !memberId || !date || isSubmitting) {
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            await submitAssignmentCreateProposal({
                worker_id: memberId,
                site_id: selectedSite.id,
                site_name: selectedSite.name,
                date,
                note,
            });

            await onCreated();
            onClose();
        } catch (submitError) {
            console.error('Failed to create assignment proposal:', submitError);
            setError('配置案を送れませんでした。もう一度お試しください。');
        } finally {
            setIsSubmitting(false);
        }
    };

    const titleId = 'calendar-schedule-modal-title';
    const modalTitle =
        mode === 'personal' ? '予定を入れる' : mode === 'assignment' ? '現場に入れる' : '追加する';
    const modalSubtitle =
        mode === 'personal'
            ? '追加先: 自分の予定'
            : mode === 'assignment'
              ? '既存現場にメンバーを配置します。'
              : date;

    return (
        <motion.div
            className={styles.overlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
        >
            <motion.div
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby={mode === 'personal' ? undefined : titleId}
                aria-label={mode === 'personal' ? modalTitle : undefined}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <button
                        type="button"
                        className={styles.closeButton}
                        onClick={onClose}
                        aria-label="閉じる"
                    >
                        <X size={20} />
                    </button>
                    {mode !== 'personal' && (
                        <div className={styles.titleGroup}>
                            <h2 id={titleId} className={styles.title}>
                                {modalTitle}
                            </h2>
                            <p className={styles.subtitle}>{modalSubtitle}</p>
                        </div>
                    )}
                </header>

                {error && (
                    <div className={styles.errorBanner}>
                        <AlertTriangle size={16} />
                        <span>{error}</span>
                    </div>
                )}

                {mode === 'menu' && (
                    <div className={styles.actionMenu}>
                        <button type="button" className={styles.actionButton} onClick={openPersonalForm}>
                            <span className={styles.actionIcon}>
                                <CalendarPlus2 size={18} />
                            </span>
                            <span>
                                <strong>予定を入れる</strong>
                                <small>予定やタスクを入れる</small>
                            </span>
                        </button>
                    </div>
                )}

                {mode === 'personal' && (
                    <div className={styles.formGrid}>
                        <div className={styles.primaryScheduleCard}>
                            <label className={styles.titleEntry}>
                                <input
                                    className={styles.titleInput}
                                    type="text"
                                    aria-label="タイトル"
                                    value={title}
                                    onChange={(event) => setTitle(event.target.value)}
                                    placeholder="タイトル追加"
                                />
                            </label>

                            <div className={styles.scheduleControlRow}>
                                <div className={styles.chipRow} role="group" aria-label="予定の種類">
                                    {SCHEDULE_TYPE_OPTIONS.map((option) => (
                                        <button
                                            key={option}
                                            type="button"
                                            className={`${styles.typeSegmentButton} ${
                                                scheduleType === option ? styles.typeSegmentButtonActive : ''
                                            }`}
                                            onClick={() => handleScheduleTypeChange(option)}
                                        >
                                            {SCHEDULE_TYPE_LABELS[option]}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    type="button"
                                    className={styles.colorSelectButton}
                                    style={{ '--schedule-color': selectedScheduleColor.value } as CSSProperties}
                                    onClick={() => {
                                        setActivePicker(null);
                                        setIsColorPickerOpen(true);
                                    }}
                                    aria-label={`予定色 ${selectedScheduleColor.label}`}
                                >
                                    <span className={styles.colorSelectSwatch} aria-hidden="true" />
                                    <span>{selectedScheduleColor.label}</span>
                                </button>
                            </div>
                        </div>

                        <div className={styles.field}>
                            <div className={styles.typeSegment} role="group" aria-label="表示範囲">
                                {VISIBILITY_OPTIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        className={`${styles.typeSegmentButton} ${
                                            visibility === option.value ? styles.typeSegmentButtonActive : ''
                                        }`}
                                        onClick={() => setVisibility(option.value)}
                                        disabled={isVisibilityForced && option.value === 'personal'}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className={styles.dateTimeCard}>
                            <div className={styles.allDayRow}>
                                <span className={styles.label}>終日</span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={isAllDay}
                                    className={`${styles.switchButton} ${isAllDay ? styles.switchButtonActive : ''}`}
                                    onClick={handleAllDayToggle}
                                >
                                    <span className={styles.switchThumb} />
                                </button>
                            </div>

                            <div className={styles.dateTimeStack}>
                                <div className={styles.dateTimeRow}>
                                    <span className={styles.dateTimeLabel}>開始</span>
                                    <button
                                        type="button"
                                        className={`${styles.dateTimeButton} ${
                                            activePicker === 'startDate' ? styles.dateTimeButtonActive : ''
                                        }`}
                                        aria-label="開始日"
                                        onClick={() => openDatePicker('startDate')}
                                    >
                                        <CalendarDays size={16} />
                                        <span>{formatDisplayDate(date)}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.dateTimeButton} ${
                                            activePicker === 'startTime' ? styles.dateTimeButtonActive : ''
                                        }`}
                                        aria-label="開始時刻"
                                        onClick={() => openTimePicker('startTime')}
                                        disabled={isAllDay}
                                    >
                                        <Clock size={16} />
                                        <span>{isAllDay ? '--:--' : startTime || '時刻'}</span>
                                    </button>
                                </div>
                                <div className={styles.dateTimeRow}>
                                    <span className={styles.dateTimeLabel}>終了</span>
                                    <button
                                        type="button"
                                        className={`${styles.dateTimeButton} ${
                                            activePicker === 'endDate' ? styles.dateTimeButtonActive : ''
                                        }`}
                                        aria-label="終了日"
                                        onClick={() => openDatePicker('endDate')}
                                    >
                                        <CalendarDays size={16} />
                                        <span>{formatDisplayDate(endDate)}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.dateTimeButton} ${
                                            activePicker === 'endTime' ? styles.dateTimeButtonActive : ''
                                        }`}
                                        aria-label="終了時刻"
                                        onClick={() => openTimePicker('endTime')}
                                        disabled={isAllDay}
                                    >
                                        <Clock size={16} />
                                        <span>{isAllDay ? '--:--' : endTime || '時刻'}</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <label className={styles.addressField}>
                            <MapPin size={18} aria-hidden="true" />
                            <input
                                className={styles.addressInput}
                                type="text"
                                aria-label="住所"
                                value={address}
                                onChange={(event) => setAddress(event.target.value)}
                                placeholder="住所を追加"
                            />
                        </label>

                    </div>
                )}

                {mode === 'personal' && isColorPickerOpen && (
                    <div className={styles.pickerScrim} onClick={() => setIsColorPickerOpen(false)}>
                        <div
                            className={styles.colorPickerDialog}
                            role="dialog"
                            aria-label="予定色を選択"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className={styles.pickerDialogHeader}>
                                <span>色</span>
                                <button
                                    type="button"
                                    className={styles.iconButton}
                                    onClick={() => setIsColorPickerOpen(false)}
                                    aria-label="閉じる"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            <div className={styles.colorPickerGrid} role="group" aria-label="予定色">
                                {SCHEDULE_COLOR_OPTIONS.map((option) => {
                                    const isSelected = scheduleColor === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            className={`${styles.colorPickerOption} ${
                                                isSelected ? styles.colorPickerOptionSelected : ''
                                            }`}
                                            style={{ '--schedule-color': option.value } as CSSProperties}
                                            aria-label={`${option.label}を選択`}
                                            aria-pressed={isSelected}
                                            onClick={() => {
                                                setScheduleColor(option.value);
                                                setIsColorPickerOpen(false);
                                            }}
                                        >
                                            <span className={styles.colorPickerSwatch}>
                                                {isSelected && <Check size={16} aria-hidden="true" />}
                                            </span>
                                            <span>{option.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {mode === 'personal' && activePicker && (
                    <div className={styles.pickerScrim} onClick={() => setActivePicker(null)}>
                        <div
                            className={styles.pickerDialog}
                            role="dialog"
                            aria-label={`${getPickerTitle(activePicker)}を選択`}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className={styles.pickerDialogHeader}>
                                <span>{getPickerTitle(activePicker)}</span>
                                <button
                                    type="button"
                                    className={styles.iconButton}
                                    onClick={() => setActivePicker(null)}
                                    aria-label="閉じる"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {(activePicker === 'startDate' || activePicker === 'endDate') && (
                                <div className={styles.pickerStepSegment} role="group" aria-label="日付の入力対象">
                                    <button
                                        type="button"
                                        className={`${styles.pickerStepButton} ${
                                            activePicker === 'startDate' ? styles.pickerStepButtonActive : ''
                                        }`}
                                        onClick={() => switchDatePickerTarget('startDate')}
                                    >
                                        開始
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.pickerStepButton} ${
                                            activePicker === 'endDate' ? styles.pickerStepButtonActive : ''
                                        }`}
                                        onClick={() => switchDatePickerTarget('endDate')}
                                    >
                                        終了
                                    </button>
                                </div>
                            )}

                            {(activePicker === 'startTime' || activePicker === 'endTime') && (
                                <div className={styles.pickerStepSegment} role="group" aria-label="時刻の入力対象">
                                    <button
                                        type="button"
                                        className={`${styles.pickerStepButton} ${
                                            activePicker === 'startTime' ? styles.pickerStepButtonActive : ''
                                        }`}
                                        onClick={() => switchTimePickerTarget('startTime')}
                                    >
                                        開始
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.pickerStepButton} ${
                                            activePicker === 'endTime' ? styles.pickerStepButtonActive : ''
                                        }`}
                                        onClick={() => switchTimePickerTarget('endTime')}
                                    >
                                        終了
                                    </button>
                                </div>
                            )}

                            {(activePicker === 'startDate' || activePicker === 'endDate') && (
                                <div className={styles.pickerPanel}>
                                    <div className={styles.pickerHeader}>
                                        <button
                                            type="button"
                                            className={styles.iconButton}
                                            onClick={() => handleMonthChange(-1)}
                                            aria-label="前の月"
                                        >
                                            <ChevronLeft size={18} />
                                        </button>
                                        <span>{formatMonthTitle(calendarMonth)}</span>
                                        <button
                                            type="button"
                                            className={styles.iconButton}
                                            onClick={() => handleMonthChange(1)}
                                            aria-label="次の月"
                                        >
                                            <ChevronRight size={18} />
                                        </button>
                                    </div>
                                    <div className={styles.weekdayGrid}>
                                        {WEEKDAY_LABELS.map((weekday) => (
                                            <span key={weekday}>{weekday}</span>
                                        ))}
                                    </div>
                                    <div className={styles.calendarGrid}>
                                        {calendarDays.map((calendarDay) => (
                                            <button
                                                key={calendarDay.value}
                                                type="button"
                                                className={`${styles.calendarDay} ${
                                                    calendarDay.value === selectedPickerDate ? styles.calendarDaySelected : ''
                                                } ${calendarDay.isToday ? styles.calendarDayToday : ''} ${
                                                    !calendarDay.isCurrentMonth ? styles.calendarDayMuted : ''
                                                }`}
                                                onClick={() => handleDateSelect(calendarDay.value)}
                                            >
                                                {calendarDay.day}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {(activePicker === 'startTime' || activePicker === 'endTime') && (
                                <>
                                    <div className={styles.pickerPanel}>
                                        <div className={styles.timeQuickSection}>
                                            <span className={styles.timePickerLabel}>よく使う</span>
                                            <div className={styles.timeQuickGrid}>
                                                {COMMON_TIME_OPTIONS.map((timeOption) => (
                                                    <button
                                                        key={timeOption}
                                                        type="button"
                                                        className={`${styles.timeChip} ${
                                                            activeTime === timeOption ? styles.timeChipActive : ''
                                                        }`}
                                                        onClick={() => handleTimeSelect(timeOption)}
                                                    >
                                                        {timeOption}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className={styles.timeManualSection}>
                                            <span className={styles.timePickerLabel}>直接入力</span>
                                            <div className={styles.timeEntryGrid}>
                                                <input
                                                    className={styles.timePartInput}
                                                    type="text"
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    value={activeTimeDraft.hour}
                                                    onChange={(event) => handleTimePartChange('hour', event.target.value)}
                                                    onBlur={() => handleTimePartBlur('hour')}
                                                    onFocus={(event) => {
                                                        event.target.select();
                                                        window.setTimeout(
                                                            () => setActiveTimePart('hour'),
                                                            TIME_PART_CHIP_ACTIVATION_DELAY_MS
                                                        );
                                                    }}
                                                    aria-label={`${getPickerTitle(activePicker)}の時`}
                                                    placeholder="09"
                                                />
                                                <span className={styles.timeSeparator}>:</span>
                                                <input
                                                    ref={minuteInputRef}
                                                    className={styles.timePartInput}
                                                    type="text"
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    value={activeTimeDraft.minute}
                                                    onChange={(event) => handleTimePartChange('minute', event.target.value)}
                                                    onBlur={() => handleTimePartBlur('minute')}
                                                    onFocus={(event) => {
                                                        event.target.select();
                                                        window.setTimeout(
                                                            () => setActiveTimePart('minute'),
                                                            TIME_PART_CHIP_ACTIVATION_DELAY_MS
                                                        );
                                                    }}
                                                    aria-label={`${getPickerTitle(activePicker)}の分`}
                                                    placeholder="00"
                                                />
                                            </div>
                                            {activeTimePart && (
                                                <div className={styles.minuteChipStage}>
                                                    {(['hour', 'minute'] as const).map((timePart) => {
                                                        const isActive = activeTimePart === timePart;
                                                        return (
                                                            <div
                                                                key={timePart}
                                                                className={`${styles.minuteChipRow} ${
                                                                    isActive
                                                                        ? styles.minuteChipRowActive
                                                                        : styles.minuteChipRowInactive
                                                                }`}
                                                                role={isActive ? 'group' : undefined}
                                                                aria-label={
                                                                    isActive
                                                                        ? timePart === 'hour'
                                                                            ? '時を選択'
                                                                            : '分を選択'
                                                                        : undefined
                                                                }
                                                                aria-hidden={!isActive}
                                                            >
                                                                {(timePart === 'hour' ? HOUR_OPTIONS : MINUTE_OPTIONS).map((option) => (
                                                                    <button
                                                                        key={option}
                                                                        type="button"
                                                                        className={`${styles.minuteChip} ${
                                                                            (timePart === 'hour'
                                                                                ? activeTimeDraft.hour === option
                                                                                : activeTimeDraft.minute === option)
                                                                                ? styles.minuteChipActive
                                                                                : ''
                                                                        }`}
                                                                        onMouseDown={(event) => event.preventDefault()}
                                                                        onClick={() =>
                                                                            timePart === 'hour'
                                                                                ? handleHourSelect(option)
                                                                                : handleMinuteSelect(option)
                                                                        }
                                                                    >
                                                                        {option}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            {timeDraftError && (
                                                <div className={styles.timePickerError}>{timeDraftError}</div>
                                            )}
                                        </div>
                                    </div>
                                    <div className={styles.pickerActions}>
                                        <button
                                            type="button"
                                            className={styles.pickerDoneButton}
                                            onClick={handleTimePickerDone}
                                        >
                                            {activePicker === 'startTime' ? '終了へ' : '完了'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {mode === 'assignment' && (
                    <>
                        {isLoadingOptions ? (
                            <div className={styles.loadingState}>
                                <Loader2 size={20} className={styles.loadingIcon} />
                                <span>候補を読み込み中</span>
                            </div>
                        ) : (
                            <>
                                <div className={styles.contextRow}>
                                    <span className={styles.contextChip}>日付 {date}</span>
                                    {selectedSite && (
                                        <span className={styles.contextChip}>現場 {selectedSite.name}</span>
                                    )}
                                    {selectedMember && (
                                        <span className={styles.contextChip}>
                                            担当 {getMemberLabel(selectedMember)}
                                        </span>
                                    )}
                                </div>

                                <div className={styles.formGrid}>
                                    <label className={styles.field}>
                                        <span className={styles.label}>日付</span>
                                        <input
                                            className={styles.input}
                                            type="date"
                                            value={date}
                                            onChange={(event) => setDate(event.target.value)}
                                        />
                                    </label>

                                    <label className={styles.field}>
                                        <span className={styles.label}>現場</span>
                                        <select
                                            className={styles.select}
                                            value={siteId}
                                            onChange={(event) => setSiteId(event.target.value)}
                                        >
                                            <option value="">現場を選択</option>
                                            {activeSites.map((site) => (
                                                <option key={site.id} value={site.id}>
                                                    {site.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className={styles.field}>
                                        <span className={styles.label}>メンバー</span>
                                        <select
                                            className={styles.select}
                                            value={memberId}
                                            onChange={(event) => setMemberId(event.target.value)}
                                        >
                                            <option value="">メンバーを選択</option>
                                            {members.map((member) => (
                                                <option key={member.id} value={member.id}>
                                                    {getMemberLabel(member)}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className={styles.field}>
                                        <span className={styles.label}>メモ</span>
                                        <textarea
                                            className={styles.textarea}
                                            rows={4}
                                            value={note}
                                            onChange={(event) => setNote(event.target.value)}
                                            placeholder="例: 欠員が出たため入れ替え"
                                        />
                                    </label>
                                </div>
                            </>
                        )}
                    </>
                )}

                {mode !== 'menu' && (
                    <footer className={styles.footer}>
                        <p className={styles.footerNote}>
                            {mode === 'personal' ? '入力した内容を予定として送信します。' : '配置案を送信します。'}
                        </p>
                        {scope === 'organization' && (initialMode ?? 'menu') === 'menu' && (
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => {
                                    setError(null);
                                    setMode('menu');
                                }}
                                disabled={isSubmitting}
                            >
                                戻る
                            </button>
                        )}
                        <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={onClose}
                            disabled={isSubmitting}
                        >
                            キャンセル
                        </button>
                        <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={mode === 'personal' ? handleSubmitPersonal : handleSubmitAssignment}
                            disabled={mode === 'personal' ? !canSubmitPersonal : !canSubmitAssignment}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 size={16} className={styles.loadingIcon} />
                                    送信中...
                                </>
                            ) : mode === 'personal' ? (
                                '予定を入れる'
                            ) : (
                                <>
                                    <BriefcaseBusiness size={16} />
                                    配置案を送る
                                </>
                            )}
                        </button>
                    </footer>
                )}
            </motion.div>
        </motion.div>
    );
}
