import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitPersonalScheduleProposal } from '../../lib/api';
import { CalendarScheduleModal } from './CalendarScheduleModal';

Object.defineProperty(window, 'scrollTo', {
    writable: true,
    value: vi.fn(),
});

vi.mock('framer-motion', () => ({
    motion: new Proxy(
        {},
        {
            get:
                (_target, tag: string) =>
                (motionProps: ComponentProps<'div'> & {
                    initial?: unknown;
                    animate?: unknown;
                    exit?: unknown;
                    transition?: unknown;
                }) => {
                    const { children, ...props } = motionProps;
                    const domProps = { ...props } as Record<string, unknown>;

                    ['initial', 'animate', 'exit', 'transition'].forEach((prop) => {
                        delete domProps[prop];
                    });

                    return createElement(tag, domProps, children);
                },
        },
    ),
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../../lib/api', async () => {
    const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
    return {
        ...actual,
        fetchMembers: vi.fn().mockResolvedValue([]),
        fetchSites: vi.fn().mockResolvedValue([]),
        submitAssignmentCreateProposal: vi.fn(),
        submitPersonalScheduleProposal: vi.fn(),
    };
});

function renderPersonalScheduleModal() {
    return render(
        <CalendarScheduleModal
            initialDate="2026-04-25"
            scope="personal"
            initialMode="personal"
            onClose={vi.fn()}
            onCreated={vi.fn()}
        />,
    );
}

describe('CalendarScheduleModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('normalizes a single hour value when finishing time entry', () => {
        renderPersonalScheduleModal();
        fireEvent.click(screen.getByRole('button', { name: '開始時刻' }));
        fireEvent.change(screen.getByRole('textbox', { name: '開始時刻の時' }), {
            target: { value: '9' },
        });
        fireEvent.click(screen.getByRole('button', { name: '終了へ' }));

        expect(screen.getByRole('button', { name: '開始時刻' })).toHaveTextContent('09:00');
        expect(screen.getByRole('dialog', { name: '終了時刻を選択' })).toBeInTheDocument();
    });

    it('accepts compact time input such as 930', () => {
        renderPersonalScheduleModal();
        fireEvent.click(screen.getByRole('button', { name: '開始時刻' }));
        fireEvent.change(screen.getByRole('textbox', { name: '開始時刻の時' }), {
            target: { value: '930' },
        });

        expect(screen.getByRole('button', { name: '開始時刻' })).toHaveTextContent('09:30');
        expect(screen.getByRole('dialog', { name: '開始時刻を選択' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: '終了時刻を選択' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '終了時刻' })).toHaveTextContent('10:30');
    });

    it('keeps the typed hour when focus moves to the minute field', () => {
        renderPersonalScheduleModal();
        fireEvent.click(screen.getByRole('button', { name: '開始時刻' }));

        const hourInput = screen.getByRole('textbox', { name: '開始時刻の時' });
        fireEvent.change(hourInput, { target: { value: '09' } });
        fireEvent.blur(hourInput);

        expect(screen.getByRole('textbox', { name: '開始時刻の時' })).toHaveValue('09');
        expect(screen.getByRole('dialog', { name: '開始時刻を選択' })).toBeInTheDocument();
    });

    it('accepts full-width numeric input', () => {
        renderPersonalScheduleModal();
        fireEvent.click(screen.getByRole('button', { name: '開始時刻' }));
        fireEvent.change(screen.getByRole('textbox', { name: '開始時刻の時' }), {
            target: { value: '１２' },
        });

        expect(screen.getByRole('textbox', { name: '開始時刻の時' })).toHaveValue('12');
    });

    it('shows contextual chips for the selected time part', async () => {
        renderPersonalScheduleModal();
        fireEvent.click(screen.getByRole('button', { name: '開始時刻' }));

        expect(screen.queryByRole('group', { name: '時を選択' })).not.toBeInTheDocument();
        expect(screen.queryByRole('group', { name: '分を選択' })).not.toBeInTheDocument();

        fireEvent.focus(screen.getByRole('textbox', { name: '開始時刻の時' }));
        const hourGroup = await screen.findByRole('group', { name: '時を選択' });
        expect(within(hourGroup).getByRole('button', { name: '09' })).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: '分を選択' })).not.toBeInTheDocument();

        fireEvent.click(within(hourGroup).getByRole('button', { name: '09' }));
        const minuteGroupAfterHourChip = await screen.findByRole('group', { name: '分を選択' });
        expect(within(minuteGroupAfterHourChip).getByRole('button', { name: '30' })).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: '時を選択' })).not.toBeInTheDocument();

        fireEvent.focus(screen.getByRole('textbox', { name: '開始時刻の時' }));
        await screen.findByRole('group', { name: '時を選択' });
        fireEvent.focus(screen.getByRole('textbox', { name: '開始時刻の分' }));
        const minuteGroup = await screen.findByRole('group', { name: '分を選択' });
        expect(within(minuteGroup).getByRole('button', { name: '30' })).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.queryByRole('group', { name: '時を選択' })).not.toBeInTheDocument();
        });
    });

    it('moves from start date to end date in the same picker', () => {
        renderPersonalScheduleModal();

        fireEvent.click(screen.getByRole('button', { name: '開始日' }));
        fireEvent.click(screen.getByRole('button', { name: '26' }));

        expect(screen.getByRole('button', { name: '開始日' })).toHaveTextContent('2026/04/26');
        expect(screen.getByRole('dialog', { name: '終了日を選択' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '27' }));

        expect(screen.queryByRole('dialog', { name: '終了日を選択' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '終了日' })).toHaveTextContent('2026/04/27');
    });

    it('submits the address field as proposal address', async () => {
        renderPersonalScheduleModal();

        fireEvent.change(screen.getByRole('textbox', { name: 'タイトル' }), {
            target: { value: '現調' },
        });
        fireEvent.change(screen.getByRole('textbox', { name: '住所' }), {
            target: { value: '東京都渋谷区渋谷1-2-3' },
        });
        fireEvent.click(screen.getByRole('button', { name: '予定色 青緑' }));
        expect(screen.getByRole('dialog', { name: '予定色を選択' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '橙を選択' }));
        expect(screen.queryByRole('dialog', { name: '予定色を選択' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '開始時刻' }));
        fireEvent.click(screen.getByRole('button', { name: '09:00' }));
        fireEvent.click(screen.getByRole('button', { name: '完了' }));
        fireEvent.click(screen.getByRole('button', { name: '予定を入れる' }));

        await waitFor(() => {
            expect(submitPersonalScheduleProposal).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: '現調',
                    start_time: '09:00',
                    end_time: '10:00',
                    address: '東京都渋谷区渋谷1-2-3',
                    color: '#F97316',
                }),
            );
        });
    });
});
