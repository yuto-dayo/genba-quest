import { createChain } from '../helpers/mockSupabase';
import { actors, makeProposal, TEST_ORG_ID } from '../helpers/fixtures';

jest.mock('../../lib/supabaseAdmin', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('../../services/PolicyEngine', () => {
  const actual = jest.requireActual('../../services/PolicyEngine');

  const mockEvaluateProposal = jest.fn();
  const mockCanApprove = jest.fn();
  const mockCanExecute = jest.fn();

  const MockPolicyEngine = jest.fn().mockImplementation(() => ({
    evaluateProposal: mockEvaluateProposal,
    canApprove: mockCanApprove,
    canExecute: mockCanExecute,
  }));

  return {
    ...actual,
    PolicyEngine: MockPolicyEngine,
    __mockEvaluateProposal: mockEvaluateProposal,
    __mockCanApprove: mockCanApprove,
    __mockCanExecute: mockCanExecute,
  };
});

import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { ProposalService } from '../../services/ProposalService';
import type { ProposalType } from '../../services/PolicyEngine';

const mockFrom = supabaseAdmin.from as jest.Mock;

const { __mockEvaluateProposal: mockEvaluateProposal } = jest.requireMock('../../services/PolicyEngine') as {
  __mockEvaluateProposal: jest.Mock;
};

const defaultEvaluation = {
  policy: {
    id: 'policy-one',
    org_id: TEST_ORG_ID,
    name: 'require_one_approval',
    conditions: [],
    required_approvers: [{ type: 'any_member' as const }],
    required_count: 1,
    auto_approve: false,
    ai_can_approve: false,
    priority: 1,
    is_active: true,
  },
  matched: true,
  autoApprove: false,
  requiredApprovals: 1,
  aiCanApprove: false,
  requiredApprovers: [{ type: 'any_member' as const }],
};

function buildCreatedProposal(type: ProposalType) {
  return makeProposal({
    type,
    status: 'draft',
    payload: {},
    description: `test-${type}`,
    created_by: actors.human,
  });
}

function mockCreateSuccess(type: ProposalType) {
  const insertChain = createChain({ data: buildCreatedProposal(type), error: null });
  mockFrom.mockReturnValue(insertChain);
}

describe('ProposalService.create assignment past date guard', () => {
  let service: ProposalService;

  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    service = new ProposalService(TEST_ORG_ID);
    mockEvaluateProposal.mockResolvedValue(defaultEvaluation);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('today/未来の日付は assignment proposal で通る', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-13T03:00:00.000Z'));

    mockCreateSuccess('assignment.create');
    await expect(
      service.create({
        type: 'assignment.create',
        payload: { date: '2026-05-13' },
        description: 'today assignment.create',
        created_by: actors.human,
      })
    ).resolves.toMatchObject({ status: 'draft' });

    mockCreateSuccess('assignment.update');
    await expect(
      service.create({
        type: 'assignment.update',
        payload: { date: '2026-05-14' },
        description: 'future assignment.update',
        created_by: actors.human,
      })
    ).resolves.toMatchObject({ status: 'draft' });

    expect(mockEvaluateProposal).toHaveBeenCalledTimes(2);
  });

  it.each<ProposalType>(['assignment.create', 'assignment.update', 'assignment.cancel'])(
    '過去日付は %s で lock される',
    async (type) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-05-13T00:00:00.000Z'));

      await expect(
        service.create({
          type,
          payload: { date: '2026-05-12' },
          description: 'past date should fail',
          created_by: actors.human,
        })
      ).rejects.toThrow('ASSIGNMENT_PAST_DATE_LOCKED');

      expect(mockEvaluateProposal).not.toHaveBeenCalled();
      expect(mockFrom).not.toHaveBeenCalled();
    }
  );

  it('他 proposal type は過去日付でも影響を受けない', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-13T00:00:00.000Z'));

    mockCreateSuccess('expense.create');

    await expect(
      service.create({
        type: 'expense.create',
        payload: { date: '2026-05-12', amount: 3000 },
        description: 'expense should pass',
        created_by: actors.human,
      })
    ).resolves.toMatchObject({ status: 'draft' });

    expect(mockEvaluateProposal).toHaveBeenCalledTimes(1);
  });

  it.each<ProposalType>(['assignment.create', 'assignment.update', 'assignment.cancel'])(
    'payload.date 欠落は %s で通る',
    async (type) => {
      mockCreateSuccess(type);

      await expect(
        service.create({
          type,
          payload: { site_id: 'site-1' },
          description: 'date missing should pass',
          created_by: actors.human,
        })
      ).resolves.toMatchObject({ status: 'draft' });
    }
  );

  it('JST日付境界(UTC 15:00)で前日が lock され当日は通る', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-12T15:00:00.000Z'));

    await expect(
      service.create({
        type: 'assignment.create',
        payload: { date: '2026-05-12' },
        description: 'boundary previous day',
        created_by: actors.human,
      })
    ).rejects.toThrow('ASSIGNMENT_PAST_DATE_LOCKED');

    expect(mockEvaluateProposal).not.toHaveBeenCalled();

    mockCreateSuccess('assignment.create');

    await expect(
      service.create({
        type: 'assignment.create',
        payload: { date: '2026-05-13' },
        description: 'boundary same day',
        created_by: actors.human,
      })
    ).resolves.toMatchObject({ status: 'draft' });

    expect(mockEvaluateProposal).toHaveBeenCalledTimes(1);
  });
});
