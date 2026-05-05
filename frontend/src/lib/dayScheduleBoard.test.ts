import { describe, expect, it } from 'vitest';
import { buildDayScheduleBoard, countMonthlyShortageDays } from './dayScheduleBoard';
import type { Member, Site } from './api';
import type { CalendarDay } from '../types/calendar';

const members: Member[] = [
    {
        id: 'worker-1',
        full_name: '田中 太郎',
        username: null,
        avatar_url: null,
    },
    {
        id: 'worker-2',
        full_name: '佐藤 花子',
        username: null,
        avatar_url: null,
    },
];

function makeSite(overrides: Partial<Site>): Site {
    return {
        id: 'site-1',
        name: '第一現場',
        status: 'active',
        assigned_users: [],
        required_worker_count: 2,
        created_at: '2026-04-01T00:00:00.000Z',
        ...overrides,
    };
}

function makeDay(overrides: Partial<CalendarDay>): CalendarDay {
    return {
        date: '2026-04-25',
        day: 25,
        assignments: [],
        personal_schedules: [],
        isToday: false,
        isCurrentMonth: true,
        isWeekend: false,
        ...overrides,
    };
}

describe('dayScheduleBoard', () => {
    it('excludes sites with nullable required_worker_count from shortage calculations', () => {
        const site = makeSite({
            required_worker_count: null,
            assigned_users: [],
        });
        const day = makeDay({
            assignments: [
                {
                    id: 'site-row',
                    user_id: 'site',
                    site_id: site.id,
                    site_name: site.name,
                    date: '2026-04-25',
                    status: 'scheduled',
                    source: 'site',
                },
            ],
        });

        const board = buildDayScheduleBoard({ day, sites: [site], members, drafts: [] });

        expect(board.sites[0].required_worker_count).toBeNull();
        expect(board.sites[0].shortage_count).toBeNull();
        expect(board.shortage_site_count).toBe(0);
        expect(countMonthlyShortageDays([day], [site])).toBe(0);
    });

    it('de-dupes site assigned users and approved assignment.create proposals by site and worker', () => {
        const site = makeSite({
            assigned_users: ['worker-1'],
            required_worker_count: 2,
        });
        const day = makeDay({
            assignments: [
                {
                    id: 'site-row',
                    user_id: 'site',
                    site_id: site.id,
                    site_name: site.name,
                    date: '2026-04-25',
                    status: 'scheduled',
                    source: 'site',
                },
                {
                    id: 'proposal-duplicate',
                    user_id: 'worker-1',
                    site_id: site.id,
                    site_name: site.name,
                    date: '2026-04-25',
                    status: 'confirmed',
                    source: 'proposal',
                    proposal_type: 'assignment.create',
                },
                {
                    id: 'proposal-new',
                    user_id: 'worker-2',
                    site_id: site.id,
                    site_name: site.name,
                    date: '2026-04-25',
                    status: 'confirmed',
                    source: 'proposal',
                    proposal_type: 'assignment.create',
                },
            ],
        });

        const board = buildDayScheduleBoard({ day, sites: [site], members, drafts: [] });

        expect(board.sites[0].confirmed_count).toBe(2);
        expect(board.sites[0].shortage_count).toBe(0);
    });

    it('ignores non-create assignment proposals for v1 projected staffing counts', () => {
        const site = makeSite({
            assigned_users: [],
            required_worker_count: 1,
        });
        const day = makeDay({
            assignments: [
                {
                    id: 'site-row',
                    user_id: 'site',
                    site_id: site.id,
                    site_name: site.name,
                    date: '2026-04-25',
                    status: 'scheduled',
                    source: 'site',
                },
                {
                    id: 'proposal-update',
                    user_id: 'worker-1',
                    site_id: site.id,
                    site_name: site.name,
                    date: '2026-04-25',
                    status: 'confirmed',
                    source: 'proposal',
                    proposal_type: 'assignment.update',
                },
            ],
        });

        const board = buildDayScheduleBoard({ day, sites: [site], members, drafts: [] });

        expect(board.sites[0].confirmed_count).toBe(0);
        expect(board.sites[0].shortage_count).toBe(1);
        expect(countMonthlyShortageDays([day], [site])).toBe(1);
    });

    it('keeps tentative site markers out of staffing shortage calculations', () => {
        const site = makeSite({
            status: 'tentative',
            required_worker_count: 2,
        });
        const day = makeDay({
            assignments: [
                {
                    id: 'site-tentative',
                    user_id: 'site',
                    site_id: site.id,
                    site_name: site.name,
                    date: '2026-04-25',
                    status: 'tentative',
                    source: 'site',
                },
            ],
        });

        const board = buildDayScheduleBoard({ day, sites: [site], members, drafts: [] });

        expect(board.sites).toHaveLength(0);
        expect(board.shortage_site_count).toBe(0);
        expect(countMonthlyShortageDays([day], [site])).toBe(0);
    });

    it('counts assignment.create drafts in projected staffing before proposal submission', () => {
        const site = makeSite({
            assigned_users: ['worker-1'],
            required_worker_count: 2,
        });
        const day = makeDay({
            assignments: [
                {
                    id: 'site-row',
                    user_id: 'site',
                    site_id: site.id,
                    site_name: site.name,
                    date: '2026-04-25',
                    status: 'scheduled',
                    source: 'site',
                },
            ],
        });

        const board = buildDayScheduleBoard({
            day,
            sites: [site],
            members,
            drafts: [
                {
                    id: 'draft-1',
                    date: '2026-04-25',
                    site_id: site.id,
                    site_name: site.name,
                    worker_id: 'worker-2',
                    worker_name: '佐藤 花子',
                },
            ],
        });

        expect(board.sites[0].draft_count).toBe(1);
        expect(board.sites[0].projected_count).toBe(2);
        expect(board.sites[0].shortage_count).toBe(0);
    });

    it('keeps completed sites visible without shortage or draft staffing actions', () => {
        const site = makeSite({
            status: 'completed',
            assigned_users: ['worker-1'],
            required_worker_count: 2,
        });
        const day = makeDay({
            assignments: [
                {
                    id: 'site-row',
                    user_id: 'site',
                    site_id: site.id,
                    site_name: site.name,
                    date: '2026-04-25',
                    status: 'completed',
                    source: 'site',
                },
            ],
        });

        const board = buildDayScheduleBoard({
            day,
            sites: [site],
            members,
            drafts: [
                {
                    id: 'draft-1',
                    date: '2026-04-25',
                    site_id: site.id,
                    site_name: site.name,
                    worker_id: 'worker-2',
                    worker_name: '佐藤 花子',
                },
            ],
        });

        expect(board.sites[0].is_completed).toBe(true);
        expect(board.sites[0].draft_count).toBe(0);
        expect(board.sites[0].shortage_count).toBeNull();
        expect(board.shortage_site_count).toBe(0);
    });

    it('marks ordinary schedules as warnings while keeping workers selectable', () => {
        const day = makeDay({
            personal_schedules: [
                {
                    id: 'event-1',
                    user_id: 'worker-1',
                    start_date: '2026-04-25',
                    end_date: '2026-04-25',
                    type: 'event',
                    title: '打ち合わせ',
                    start_time: '10:00:00',
                    end_time: '11:00:00',
                    blocks_assignment: false,
                    visibility: 'organization',
                    approved: true,
                    status: 'approved',
                    source: 'personal_schedule',
                },
            ],
        });

        const board = buildDayScheduleBoard({ day, sites: [], members, drafts: [] });

        expect(board.warning_worker_ids_for_date).toEqual(['worker-1']);
        expect(board.unavailable_worker_ids_for_date).toEqual([]);
        expect(board.worker_status_by_id['worker-1']).toEqual({
            severity: 'warning',
            label: '予定あり',
        });
    });

    it('prioritizes sick leave over rest and warnings for candidate status', () => {
        const day = makeDay({
            personal_schedules: [
                {
                    id: 'event-1',
                    user_id: 'worker-1',
                    start_date: '2026-04-25',
                    end_date: '2026-04-25',
                    type: 'event',
                    title: '打ち合わせ',
                    blocks_assignment: false,
                    visibility: 'organization',
                    approved: true,
                    status: 'approved',
                    source: 'personal_schedule',
                },
                {
                    id: 'vacation-1',
                    user_id: 'worker-1',
                    start_date: '2026-04-25',
                    end_date: '2026-04-25',
                    type: 'vacation',
                    title: '休み',
                    blocks_assignment: true,
                    visibility: 'organization',
                    approved: true,
                    status: 'approved',
                    source: 'personal_schedule',
                },
                {
                    id: 'sick-1',
                    user_id: 'worker-1',
                    start_date: '2026-04-25',
                    end_date: '2026-04-25',
                    type: 'sick_leave',
                    title: '病欠',
                    blocks_assignment: true,
                    visibility: 'organization',
                    approved: true,
                    status: 'approved',
                    source: 'personal_schedule',
                },
            ],
        });

        const board = buildDayScheduleBoard({ day, sites: [], members, drafts: [] });

        expect(board.unavailable_worker_ids_for_date).toEqual(['worker-1']);
        expect(board.warning_worker_ids_for_date).toEqual(['worker-1']);
        expect(board.worker_status_by_id['worker-1']).toEqual({
            severity: 'blocked',
            label: '病欠',
        });
    });
});
