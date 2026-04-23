import { proposalPayloads } from '../helpers/fixtures';

const mockApproveBatch = jest.fn();
const mockRejectBatch = jest.fn();
const mockGetById = jest.fn();
const mockCreate = jest.fn();
const mockCreateAndSubmit = jest.fn();

jest.mock('../../services/ProposalService', () => ({
  ProposalService: jest.fn().mockImplementation(() => ({
    approveBatch: mockApproveBatch,
    rejectBatch: mockRejectBatch,
    getById: mockGetById,
    create: mockCreate,
    createAndSubmit: mockCreateAndSubmit,
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
  const createHandler = getPostHandler('/');
  const createIntegrationHandler = getPostHandler('/integration');
  const approveBatchHandler = getPostHandler('/approve/batch');
  const rejectBatchHandler = getPostHandler('/reject/batch');
  const createAndSubmitHandler = getPostHandler('/create-and-submit');
  const instructHandler = getPostHandler('/:id/instruct');
  const mockProposalServiceCtor = ProposalService as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST / rejects site.complete because canonical RPC is required', async () => {
    const req = {
      body: {
        type: 'site.complete',
        payload: proposalPayloads.siteComplete,
        description: 'mark site complete',
      },
      userId: 'user-1',
      userName: 'Route Test User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await createHandler(req, res);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'SITE_COMPLETE_CANONICAL_RPC_REQUIRED',
      code: 'SITE_COMPLETE_CANONICAL_RPC_REQUIRED',
    });
  });

  it('POST /integration rejects site.complete because canonical RPC is required', async () => {
    const req = {
      body: {
        type: 'site.complete',
        payload: proposalPayloads.siteComplete,
        description: 'mark site complete',
        source: 'gmail',
        external_id: 'message-1',
      },
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await createIntegrationHandler(req, res);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateAndSubmit).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'SITE_COMPLETE_CANONICAL_RPC_REQUIRED',
      code: 'SITE_COMPLETE_CANONICAL_RPC_REQUIRED',
    });
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
      { type: 'human', id: 'user-1', name: 'Route Test User' },
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
          error: 'PROPOSAL_NOT_IN_PENDING_STATE',
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
          error: 'PROPOSAL_NOT_IN_PENDING_STATE',
        },
      ],
    });

    expect(mockRejectBatch).toHaveBeenCalledWith(
      ['p-1', 'p-2'],
      { type: 'human', id: 'user-1', name: 'Route Test User' },
      'no'
    );
  });

  it('POST /create-and-submit requires org context', async () => {
    const req = {
      body: {
        type: 'luqo.reward.calculate',
        payload: { breakdown: [] },
        description: 'legacy luqo proposal',
      },
      userId: 'user-1',
      userName: 'Route Test User',
    } as any;
    const res = createMockRes();

    await createAndSubmitHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'ORG_CONTEXT_REQUIRED',
      code: 'ORG_CONTEXT_REQUIRED',
    });
  });

  it('POST /create-and-submit maps LUQO validation errors to 400', async () => {
    mockCreateAndSubmit.mockRejectedValue(new Error('INVALID_MEMBER_ID'));
    const req = {
      body: {
        type: 'luqo.reward.calculate',
        payload: { breakdown: [{ member_id: '', name: '田中' }] },
        description: 'legacy luqo proposal',
      },
      userId: 'user-1',
      userName: 'Route Test User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await createAndSubmitHandler(req, res);

    expect(mockProposalServiceCtor).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'INVALID_MEMBER_ID',
      code: 'INVALID_MEMBER_ID',
    });
  });

  it('POST /create-and-submit maps wrapped canonical reward guard errors', async () => {
    mockCreateAndSubmit.mockRejectedValue(
      new Error('Failed to execute proposal atomically: MONTH_CLOSE_NOT_FOUND')
    );
    const req = {
      body: {
        type: 'reward.calculate',
        payload: {
          calculation_system: 'path_v22',
          month_close_id: '11111111-1111-4111-8111-111111111111',
        },
        description: 'canonical reward proposal',
      },
      userId: 'user-1',
      userName: 'Route Test User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await createAndSubmitHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'MONTH_CLOSE_NOT_FOUND',
      code: 'MONTH_CLOSE_NOT_FOUND',
    });
  });

  it.each([
    {
      type: 'assignment.update',
      payload: proposalPayloads.assignmentUpdate,
      description: 'move scheduled assignment',
    },
    {
      type: 'assignment.cancel',
      payload: proposalPayloads.assignmentCancel,
      description: 'cancel scheduled assignment',
    },
  ])('POST /create-and-submit preserves $type payload contract', async ({ type, payload, description }) => {
    mockCreateAndSubmit.mockResolvedValue({
      proposal: { id: 'proposal-contract', type, status: 'pending' },
      autoApproved: false,
      autoExecuted: false,
    });

    const req = {
      body: {
        type,
        payload,
        description,
      },
      userId: 'user-1',
      userName: 'Route Test User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await createAndSubmitHandler(req, res);

    expect(mockCreateAndSubmit).toHaveBeenCalledWith({
      type,
      payload,
      description,
      created_by: { type: 'human', id: 'user-1', name: 'Route Test User' },
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      proposal: { id: 'proposal-contract', type, status: 'pending' },
      auto_approved: false,
      auto_executed: false,
    });
  });

  it('POST /create-and-submit rejects site.complete because canonical RPC is required', async () => {
    const req = {
      body: {
        type: 'site.complete',
        payload: proposalPayloads.siteComplete,
        description: 'mark site complete',
      },
      userId: 'user-1',
      userName: 'Route Test User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await createAndSubmitHandler(req, res);

    expect(mockCreateAndSubmit).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'SITE_COMPLETE_CANONICAL_RPC_REQUIRED',
      code: 'SITE_COMPLETE_CANONICAL_RPC_REQUIRED',
    });
  });

  it('POST /:id/instruct validates instruction', async () => {
    const req = {
      params: { id: 'p-1' },
      body: {},
      userId: 'user-1',
      userName: 'Route Test User',
    } as any;
    const res = createMockRes();

    await instructHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'instruction is required' });
    expect(mockGetById).not.toHaveBeenCalled();
  });

  it('POST /:id/instruct creates task.revision.request proposal for pending target', async () => {
    mockGetById.mockResolvedValue({
      id: 'p-1',
      type: 'communication.task',
      status: 'pending',
      description: 'target proposal',
      payload: {
        source_message_id: 'msg-1',
        parent_proposal_id: 'parent-1',
        title: '確認タスク',
      },
    });
    mockCreateAndSubmit.mockResolvedValue({
      proposal: { id: 'instruction-1', type: 'task.revision.request', status: 'pending' },
      autoApproved: false,
      autoExecuted: false,
    });

    const req = {
      params: { id: 'p-1' },
      body: { instruction: '返信文を丁寧語に修正してください' },
      userId: 'user-1',
      userName: 'Route Test User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await instructHandler(req, res);

    expect(mockGetById).toHaveBeenCalledWith('p-1');
    expect(mockCreateAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.revision.request',
        description: '提案への修正指示: 返信文を丁寧語に修正してください',
        created_by: { type: 'human', id: 'user-1', name: 'Route Test User' },
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      proposal: { id: 'instruction-1', type: 'task.revision.request', status: 'pending' },
      auto_approved: false,
      auto_executed: false,
      submitted: true,
    });
    expect(mockProposalServiceCtor).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });
});
