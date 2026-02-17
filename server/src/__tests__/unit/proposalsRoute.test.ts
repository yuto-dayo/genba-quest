const mockApproveBatch = jest.fn();
const mockRejectBatch = jest.fn();

jest.mock('../../services/ProposalService', () => ({
  ProposalService: jest.fn().mockImplementation(() => ({
    approveBatch: mockApproveBatch,
    rejectBatch: mockRejectBatch,
  })),
}));

import proposalsRouter from '../../routes/proposals';
import { ProposalService } from '../../services/ProposalService';

type MockRes = {
  status: jest.Mock;
  json: jest.Mock;
  send: jest.Mock;
};

function createMockRes(): MockRes {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
  } as unknown as MockRes;
  res.status.mockReturnValue(res);
  return res;
}

function getPostHandler(path: string) {
  const layer = (proposalsRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.post
  );

  if (!layer) {
    throw new Error(`POST handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe('proposals router batch endpoints', () => {
  const approveBatchHandler = getPostHandler('/approve/batch');
  const rejectBatchHandler = getPostHandler('/reject/batch');
  const mockProposalServiceCtor = ProposalService as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /approve/batch validates empty proposal_ids', async () => {
    const req = {
      body: { proposal_ids: [] },
      userId: 'user-1',
      userName: 'Route Test User',
    } as any;
    const res = createMockRes();

    await approveBatchHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'proposal_ids must be a non-empty array',
    });
    expect(mockApproveBatch).not.toHaveBeenCalled();
  });

  it('POST /approve/batch maps service response to API contract', async () => {
    mockApproveBatch.mockResolvedValue({
      total: 2,
      successCount: 1,
      failedCount: 1,
      results: [
        {
          proposalId: 'p-1',
          success: true,
          proposal: { id: 'p-1', status: 'executed' },
          isFullyApproved: true,
          autoExecuted: true,
        },
        {
          proposalId: 'p-2',
          success: false,
          error: 'PROPOSAL_NOT_FOUND',
        },
      ],
    });

    const req = {
      body: {
        proposal_ids: ['p-1', 'p-2'],
        reason: 'ok',
        actor_type: 'ai',
      },
      userId: 'user-1',
      userName: 'Route Test User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await approveBatchHandler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      total: 2,
      success_count: 1,
      failed_count: 1,
      results: [
        {
          proposal_id: 'p-1',
          success: true,
          proposal: { id: 'p-1', status: 'executed' },
          is_fully_approved: true,
          auto_executed: true,
          error: undefined,
        },
        {
          proposal_id: 'p-2',
          success: false,
          proposal: undefined,
          is_fully_approved: undefined,
          auto_executed: undefined,
          error: 'PROPOSAL_NOT_FOUND',
        },
      ],
    });

    expect(mockApproveBatch).toHaveBeenCalledWith(
      ['p-1', 'p-2'],
      { type: 'ai', id: 'user-1', name: 'Route Test User' },
      'ok'
    );
    expect(mockProposalServiceCtor).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });

  it('POST /reject/batch requires reason', async () => {
    const req = {
      body: { proposal_ids: ['p-1'] },
      userId: 'user-1',
      userName: 'Route Test User',
    } as any;
    const res = createMockRes();

    await rejectBatchHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'reason is required' });
    expect(mockRejectBatch).not.toHaveBeenCalled();
  });

  it('POST /reject/batch maps service response to API contract', async () => {
    mockRejectBatch.mockResolvedValue({
      total: 2,
      successCount: 1,
      failedCount: 1,
      results: [
        {
          proposalId: 'p-1',
          success: true,
          proposal: { id: 'p-1', status: 'rejected' },
        },
        {
          proposalId: 'p-2',
          success: false,
          error: 'PROPOSAL_NOT_IN_PROPOSED_STATE',
        },
      ],
    });

    const req = {
      body: { proposal_ids: ['p-1', 'p-2'], reason: 'no' },
      userId: 'user-1',
      userName: 'Route Test User',
    } as any;
    const res = createMockRes();

    await rejectBatchHandler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      total: 2,
      success_count: 1,
      failed_count: 1,
      results: [
        {
          proposal_id: 'p-1',
          success: true,
          proposal: { id: 'p-1', status: 'rejected' },
          error: undefined,
        },
        {
          proposal_id: 'p-2',
          success: false,
          proposal: undefined,
          error: 'PROPOSAL_NOT_IN_PROPOSED_STATE',
        },
      ],
    });

    expect(mockRejectBatch).toHaveBeenCalledWith(
      ['p-1', 'p-2'],
      { type: 'human', id: 'user-1', name: 'Route Test User' },
      'no'
    );
  });
});
