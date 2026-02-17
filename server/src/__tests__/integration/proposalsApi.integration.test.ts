const mockApprove = jest.fn();
const mockReject = jest.fn();
const mockExecute = jest.fn();
const mockSubmit = jest.fn();
const mockDelete = jest.fn();

jest.mock('../../services/ProposalService', () => ({
  ProposalService: jest.fn().mockImplementation(() => ({
    approve: mockApprove,
    reject: mockReject,
    execute: mockExecute,
    submit: mockSubmit,
    delete: mockDelete,
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

function getDeleteHandler(path: string) {
  const layer = (proposalsRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.delete
  );

  if (!layer) {
    throw new Error(`DELETE handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe('proposals API integration', () => {
  const approveHandler = getPostHandler('/:id/approve');
  const rejectHandler = getPostHandler('/:id/reject');
  const executeHandler = getPostHandler('/:id/execute');
  const submitHandler = getPostHandler('/:id/submit');
  const deleteHandler = getDeleteHandler('/:id');

  const mockProposalServiceCtor = ProposalService as unknown as jest.Mock;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('POST /:id/approve maps service result to API response', async () => {
    mockApprove.mockResolvedValue({
      proposal: { id: 'p-1', status: 'executed' },
      isFullyApproved: true,
      autoExecuted: true,
    });

    const req = {
      params: { id: 'p-1' },
      body: { reason: 'looks good', actor_type: 'ai' },
      userId: 'user-1',
      userName: 'Route Integration User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await approveHandler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      proposal: { id: 'p-1', status: 'executed' },
      is_fully_approved: true,
      auto_executed: true,
    });
    expect(mockApprove).toHaveBeenCalledWith(
      'p-1',
      { type: 'ai', id: 'user-1', name: 'Route Integration User' },
      'looks good'
    );
    expect(mockProposalServiceCtor).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });

  it('POST /:id/submit maps PROPOSAL_NOT_FOUND to 404 with code', async () => {
    mockSubmit.mockRejectedValue(new Error('PROPOSAL_NOT_FOUND'));

    const req = {
      params: { id: 'p-submit-1' },
      body: {},
      userId: 'user-1',
      userName: 'Route Integration User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await submitHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Proposal not found',
      code: 'PROPOSAL_NOT_FOUND',
    });
  });

  it('POST /:id/submit maps PROPOSAL_ALREADY_SUBMITTED to 400 with code', async () => {
    mockSubmit.mockRejectedValue(new Error('PROPOSAL_ALREADY_SUBMITTED'));

    const req = {
      params: { id: 'p-submit-2' },
      body: {},
      userId: 'user-1',
      userName: 'Route Integration User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await submitHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Proposal already submitted',
      code: 'PROPOSAL_ALREADY_SUBMITTED',
    });
  });

  it('POST /:id/approve maps policy errors to 403 with code', async () => {
    mockApprove.mockRejectedValue(new Error('AI_SELF_APPROVAL_PROHIBITED'));

    const req = {
      params: { id: 'p-2' },
      body: { reason: 'try approve' },
      userId: 'user-1',
      userName: 'Route Integration User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await approveHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'AI cannot approve AI-created proposals',
      code: 'AI_SELF_APPROVAL_PROHIBITED',
    });
  });

  it('POST /:id/reject validates reason before calling service', async () => {
    const req = {
      params: { id: 'p-3' },
      body: {},
      userId: 'user-1',
      userName: 'Route Integration User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await rejectHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'reason is required' });
    expect(mockReject).not.toHaveBeenCalled();
  });

  it('POST /:id/reject maps PROPOSAL_NOT_FOUND to 404 with code', async () => {
    mockReject.mockRejectedValue(new Error('PROPOSAL_NOT_FOUND'));

    const req = {
      params: { id: 'p-3' },
      body: { reason: 'reject reason' },
      userId: 'user-1',
      userName: 'Route Integration User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await rejectHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Proposal not found',
      code: 'PROPOSAL_NOT_FOUND',
    });
  });

  it('POST /:id/reject maps PROPOSAL_NOT_IN_PROPOSED_STATE to 400 with code', async () => {
    mockReject.mockRejectedValue(new Error('PROPOSAL_NOT_IN_PROPOSED_STATE'));

    const req = {
      params: { id: 'p-3' },
      body: { reason: 'reject reason' },
      userId: 'user-1',
      userName: 'Route Integration User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await rejectHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Proposal is not in proposed state',
      code: 'PROPOSAL_NOT_IN_PROPOSED_STATE',
    });
  });

  it('POST /:id/execute maps INSUFFICIENT_APPROVALS error to 400', async () => {
    mockExecute.mockRejectedValue(new Error('INSUFFICIENT_APPROVALS'));

    const req = {
      params: { id: 'p-4' },
      body: {},
      userId: 'user-1',
      userName: 'Route Integration User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await executeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Insufficient approvals for execution',
      code: 'INSUFFICIENT_APPROVALS',
    });
    expect(mockExecute).toHaveBeenCalledWith(
      'p-4',
      { type: 'human', id: 'user-1', name: 'Route Integration User' }
    );
  });

  it('POST /:id/execute maps PROPOSAL_NOT_FOUND error to 404 with code', async () => {
    mockExecute.mockRejectedValue(new Error('PROPOSAL_NOT_FOUND'));

    const req = {
      params: { id: 'p-5' },
      body: {},
      userId: 'user-1',
      userName: 'Route Integration User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await executeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Proposal not found',
      code: 'PROPOSAL_NOT_FOUND',
    });
  });

  it('POST /:id/execute maps PROPOSAL_NOT_APPROVED error to 400 with code', async () => {
    mockExecute.mockRejectedValue(new Error('PROPOSAL_NOT_APPROVED'));

    const req = {
      params: { id: 'p-6' },
      body: {},
      userId: 'user-1',
      userName: 'Route Integration User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await executeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Proposal is not approved',
      code: 'PROPOSAL_NOT_APPROVED',
    });
  });

  it('DELETE /:id maps PROPOSAL_NOT_FOUND to 404 with code', async () => {
    mockDelete.mockRejectedValue(new Error('PROPOSAL_NOT_FOUND'));

    const req = {
      params: { id: 'p-delete-1' },
      userId: 'user-1',
      userName: 'Route Integration User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await deleteHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Proposal not found',
      code: 'PROPOSAL_NOT_FOUND',
    });
  });

  it('DELETE /:id maps CAN_ONLY_DELETE_DRAFT_PROPOSALS to 400 with code', async () => {
    mockDelete.mockRejectedValue(new Error('CAN_ONLY_DELETE_DRAFT_PROPOSALS'));

    const req = {
      params: { id: 'p-delete-2' },
      userId: 'user-1',
      userName: 'Route Integration User',
      orgId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockRes();

    await deleteHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Can only delete draft proposals',
      code: 'CAN_ONLY_DELETE_DRAFT_PROPOSALS',
    });
  });
});
