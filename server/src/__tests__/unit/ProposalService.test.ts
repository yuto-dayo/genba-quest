import { createChain, setupMockFromSequence } from '../helpers/mockSupabase';
import {
  actors,
  proposals,
  policies,
  proposalPayloads,
  ledgerEvent,
  makeProposal,
  TEST_ORG_ID,
  TEST_PROPOSAL_ID,
  TEST_EVENT_ID,
  TEST_TRANSACTION_ID,
  TEST_SITE_ID,
} from '../helpers/fixtures';

// supabaseAdmin をモジュールレベルでモック
jest.mock('../../lib/supabaseAdmin', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
}));

// PolicyEngine をモック（ProposalService 内の new PolicyEngine() を差し替え）
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

const mockFrom = supabaseAdmin.from as jest.Mock;
const mockRpc = (supabaseAdmin as unknown as { rpc: jest.Mock }).rpc;

// PolicyEngine のモック関数を取得
const {
  __mockEvaluateProposal: mockEvaluateProposal,
  __mockCanApprove: mockCanApprove,
  __mockCanExecute: mockCanExecute,
} = jest.requireMock('../../services/PolicyEngine') as {
  __mockEvaluateProposal: jest.Mock;
  __mockCanApprove: jest.Mock;
  __mockCanExecute: jest.Mock;
};

describe('ProposalService', () => {
  let service: ProposalService;

  const defaultEvaluation = {
    policy: policies.requireOneApproval,
    matched: true,
    autoApprove: false,
    requiredApprovals: 1,
    aiCanApprove: false,
    requiredApprovers: [{ type: 'any_member' as const }],
  };

  beforeEach(() => {
    delete process.env.PROPOSAL_RPC_FALLBACK_MODE;
    service = new ProposalService(TEST_ORG_ID);
    jest.clearAllMocks();
    mockRpc.mockImplementation(async (fn: string) => ({
      data: null,
      error: { message: `Could not find the function public.${fn}` },
    }));
    mockEvaluateProposal.mockResolvedValue(defaultEvaluation);
    mockCanApprove.mockResolvedValue({ allowed: true });
    mockCanExecute.mockResolvedValue({ allowed: true });
  });

  // ============================================================
  // create()
  // ============================================================

  describe('create()', () => {
    it('draft 状態で Proposal を作成する', async () => {
      const insertChain = createChain({ data: proposals.draft, error: null });
      mockFrom.mockReturnValue(insertChain);

      const result = await service.create({
        type: 'expense.create',
        payload: { amount: 3000, category: 'material' },
        description: 'テスト資材購入',
        created_by: actors.human,
      });

      expect(result.status).toBe('draft');
      expect(mockFrom).toHaveBeenCalledWith('proposals');
      expect(insertChain.insert).toHaveBeenCalled();
    });

    it('DB エラー時は例外を投げる', async () => {
      const insertChain = createChain({ data: null, error: { message: 'insert error' } });
      mockFrom.mockReturnValue(insertChain);

      await expect(
        service.create({
          type: 'expense.create',
          payload: { amount: 3000 },
          description: 'test',
          created_by: actors.human,
        })
      ).rejects.toThrow('Failed to create proposal');
    });
  });

  // ============================================================
  // submit()
  // ============================================================

  describe('submit()', () => {
    it('draft → pending に遷移する', async () => {
      const proposedResult = { ...proposals.pending };

      // from('proposals').select().eq().single() → draft (getById)
      const getByIdChain = createChain({ data: proposals.draft, error: null });
      // from('proposals').update().eq().select().single() → pending
      const updateChain = createChain({ data: proposedResult, error: null });

      setupMockFromSequence(mockFrom, [getByIdChain, updateChain]);

      const result = await service.submit(TEST_PROPOSAL_ID, actors.human);
      expect(result.proposal.status).toBe('pending');
      expect(result.autoApproved).toBe(false);
      expect(result.autoExecuted).toBe(false);
    });

    it('存在しない Proposal → PROPOSAL_NOT_FOUND', async () => {
      const chain = createChain({ data: null, error: { message: 'not found' } });
      mockFrom.mockReturnValue(chain);

      await expect(
        service.submit('nonexistent-id', actors.human)
      ).rejects.toThrow('PROPOSAL_NOT_FOUND');
    });

    it('draft 以外の Proposal → PROPOSAL_ALREADY_SUBMITTED', async () => {
      const chain = createChain({ data: proposals.pending, error: null });
      mockFrom.mockReturnValue(chain);

      await expect(
        service.submit(TEST_PROPOSAL_ID, actors.human)
      ).rejects.toThrow('PROPOSAL_ALREADY_SUBMITTED');
    });

    it('自動承認ポリシー → approved + executed を返す', async () => {
      mockEvaluateProposal.mockResolvedValue({
        ...defaultEvaluation,
        autoApprove: true,
      });

      const executedResult = { ...proposals.executed };

      // 1. getById (submit内)
      const getByIdChain = createChain({ data: proposals.draft, error: null });
      // 2. update (submit内 → approved)
      const updateChain = createChain({ data: { ...proposals.approved }, error: null });
      // 3. getById (execute内)
      const getByIdChain2 = createChain({ data: { ...proposals.approved }, error: null });
      // 4. from('ledger_events') findOrCreateLedgerEvent - select existing
      const eventSelectChain = createChain({ data: null, error: null });
      // 5. from('ledger_events') insert new event
      const eventInsertChain = createChain({ data: ledgerEvent, error: null });
      // 6. ensureLedgerJournal: buildLedgerEntries returns entries, findOrCreateLedgerTransaction
      const txSelectChain = createChain({ data: null, error: null });
      // 7. insert transaction
      const txInsertChain = createChain({ data: { id: TEST_TRANSACTION_ID }, error: null });
      // 8. insertLedgerEntriesIfNeeded: select existing
      const entriesSelectChain = createChain({ data: [], error: null });
      // 9. insert entries
      const entriesInsertChain = createChain({ data: null, error: null });
      // 10. update proposal → executed
      const executeUpdateChain = createChain({ data: executedResult, error: null });

      setupMockFromSequence(mockFrom, [
        getByIdChain,
        updateChain,
        getByIdChain2,
        eventSelectChain,
        eventInsertChain,
        txSelectChain,
        txInsertChain,
        entriesSelectChain,
        entriesInsertChain,
        executeUpdateChain,
      ]);

      const result = await service.submit(TEST_PROPOSAL_ID, actors.human);
      expect(result.autoApproved).toBe(true);
      expect(result.autoExecuted).toBe(true);
    });
  });

  // ============================================================
  // approve() - Atomic RPC path
  // ============================================================

  describe('approve() - atomic RPC', () => {
    it('RPC関数が利用可能な場合は原子実行結果を返す', async () => {
      const getByIdChain = createChain({ data: proposals.pending, error: null });
      mockFrom.mockReturnValue(getByIdChain);

      const executedProposal = { ...proposals.executed };
      mockRpc.mockResolvedValueOnce({
        data: {
          proposal: executedProposal,
          is_fully_approved: true,
          auto_executed: true,
        },
        error: null,
      });

      const result = await service.approve(TEST_PROPOSAL_ID, actors.human, 'テスト承認');
      expect(result.isFullyApproved).toBe(true);
      expect(result.autoExecuted).toBe(true);
      expect(result.proposal.status).toBe('executed');
      expect(mockRpc).toHaveBeenCalledWith('approve_proposal_atomic', {
        p_org_id: TEST_ORG_ID,
        p_proposal_id: TEST_PROPOSAL_ID,
        p_approver: actors.human,
        p_reason: 'テスト承認',
      });
    });

    it('RPC部分承認結果を正しく返す', async () => {
      const getByIdChain = createChain({ data: proposals.pending, error: null });
      mockFrom.mockReturnValue(getByIdChain);

      const partialProposal = {
        ...proposals.pending,
        approvals: [{ actor: actors.human, decision: 'approve', at: '2026-01-01T00:00:00Z' }],
      };
      mockRpc.mockResolvedValueOnce({
        data: {
          proposal: partialProposal,
          is_fully_approved: false,
          auto_executed: false,
        },
        error: null,
      });

      const result = await service.approve(TEST_PROPOSAL_ID, actors.human);
      expect(result.isFullyApproved).toBe(false);
      expect(result.autoExecuted).toBe(false);
    });

    it('RPC前にポリシー拒否を検知した場合は即時エラー', async () => {
      const getByIdChain = createChain({ data: proposals.pending, error: null });
      mockFrom.mockReturnValue(getByIdChain);
      mockCanApprove.mockResolvedValueOnce({
        allowed: false,
        reason: 'APPROVER_NOT_ALLOWED_BY_POLICY',
      });

      await expect(
        service.approve(TEST_PROPOSAL_ID, actors.human)
      ).rejects.toThrow('APPROVER_NOT_ALLOWED_BY_POLICY');

      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('RPC関数がAI自己承認禁止エラーを返す', async () => {
      const getByIdChain = createChain({ data: proposals.pending, error: null });
      mockFrom.mockReturnValue(getByIdChain);

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'AI_SELF_APPROVAL_PROHIBITED' },
      });

      await expect(
        service.approve(TEST_PROPOSAL_ID, actors.ai)
      ).rejects.toThrow('AI_SELF_APPROVAL_PROHIBITED');
    });

    it('旧RPCエラー PROPOSAL_NOT_IN_PROPOSED_STATE を pending エラーとして扱う', async () => {
      const getByIdChain = createChain({ data: proposals.pending, error: null });
      mockFrom.mockReturnValue(getByIdChain);

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'PROPOSAL_NOT_IN_PROPOSED_STATE' },
      });

      await expect(
        service.approve(TEST_PROPOSAL_ID, actors.human)
      ).rejects.toThrow('PROPOSAL_NOT_IN_PENDING_STATE');
    });

    it('RPC関数が存在しない場合はfallbackへ', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Could not find the function public.approve_proposal_atomic' },
      });
      mockCanApprove.mockResolvedValue({ allowed: true });

      const approvedResult = {
        ...proposals.pending,
        status: 'approved',
        approvals: [{ actor: actors.human, decision: 'approve', at: '2026-01-01T00:00:00Z' }],
      };
      const executedResult = { ...proposals.executed };

      const getByIdChain = createChain({ data: proposals.pending, error: null });
      const updateChain = createChain({ data: approvedResult, error: null });
      const getByIdChain2 = createChain({ data: { ...approvedResult }, error: null });
      const eventSelectChain = createChain({ data: null, error: null });
      const eventInsertChain = createChain({ data: ledgerEvent, error: null });
      const txSelectChain = createChain({ data: null, error: null });
      const txInsertChain = createChain({ data: { id: TEST_TRANSACTION_ID }, error: null });
      const entriesSelectChain = createChain({ data: [], error: null });
      const entriesInsertChain = createChain({ data: null, error: null });
      const executeUpdateChain = createChain({ data: executedResult, error: null });

      setupMockFromSequence(mockFrom, [
        getByIdChain,
        updateChain,
        getByIdChain2,
        eventSelectChain,
        eventInsertChain,
        txSelectChain,
        txInsertChain,
        entriesSelectChain,
        entriesInsertChain,
        executeUpdateChain,
      ]);

      const result = await service.approve(TEST_PROPOSAL_ID, actors.human, 'テスト承認');
      expect(result.isFullyApproved).toBe(true);
      expect(result.autoExecuted).toBe(true);
    });

    it('strict mode時にRPC関数が存在しない場合は ATOMIC_RPC_REQUIRED', async () => {
      process.env.PROPOSAL_RPC_FALLBACK_MODE = 'disabled';
      const strictService = new ProposalService(TEST_ORG_ID);

      const getByIdChain = createChain({ data: proposals.pending, error: null });
      mockFrom.mockReturnValue(getByIdChain);

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Could not find the function public.approve_proposal_atomic' },
      });

      await expect(
        strictService.approve(TEST_PROPOSAL_ID, actors.human, 'テスト承認')
      ).rejects.toThrow('ATOMIC_RPC_REQUIRED');
    });
  });

  // ============================================================
  // approve() - Fallback path
  // ============================================================

  describe('approve() - fallback', () => {
    beforeEach(() => {
      // approve_proposal_atomic → fallback, execute_proposal_atomic → fallback
      mockRpc.mockImplementation(async (fn: string) => ({
        data: null,
        error: { message: `Could not find the function public.${fn}` },
      }));
    });

    it('最終承認で自動実行される', async () => {
      mockCanApprove.mockResolvedValue({ allowed: true });

      const approvedResult = {
        ...proposals.pending,
        status: 'approved',
        approvals: [{ actor: actors.human, decision: 'approve', at: '2026-01-01T00:00:00Z' }],
      };
      const executedResult = { ...proposals.executed };

      // 1. getById (approve内)
      const getByIdChain = createChain({ data: proposals.pending, error: null });
      // 2. update (approve内 → approved)
      const updateChain = createChain({ data: approvedResult, error: null });
      // 3. getById (execute内)
      const getByIdChain2 = createChain({ data: { ...approvedResult }, error: null });
      // 4. findOrCreateLedgerEvent: select existing
      const eventSelectChain = createChain({ data: null, error: null });
      // 5. insert event
      const eventInsertChain = createChain({ data: ledgerEvent, error: null });
      // 6. findOrCreateLedgerTransaction: select
      const txSelectChain = createChain({ data: null, error: null });
      // 7. insert transaction
      const txInsertChain = createChain({ data: { id: TEST_TRANSACTION_ID }, error: null });
      // 8. insertLedgerEntriesIfNeeded: select
      const entriesSelectChain = createChain({ data: [], error: null });
      // 9. insert entries
      const entriesInsertChain = createChain({ data: null, error: null });
      // 10. update proposal → executed
      const executeUpdateChain = createChain({ data: executedResult, error: null });

      setupMockFromSequence(mockFrom, [
        getByIdChain,
        updateChain,
        getByIdChain2,
        eventSelectChain,
        eventInsertChain,
        txSelectChain,
        txInsertChain,
        entriesSelectChain,
        entriesInsertChain,
        executeUpdateChain,
      ]);

      const result = await service.approve(TEST_PROPOSAL_ID, actors.human, 'テスト承認');
      expect(result.isFullyApproved).toBe(true);
      expect(result.autoExecuted).toBe(true);
      expect(result.proposal.status).toBe('executed');
    });

    it('自動実行失敗時は承認結果を返す', async () => {
      mockCanApprove.mockResolvedValue({ allowed: true });
      mockCanExecute.mockResolvedValueOnce({ allowed: false, reason: 'INSUFFICIENT_APPROVALS' });

      const approvedResult = {
        ...proposals.pending,
        status: 'approved',
        approvals: [{ actor: actors.human, decision: 'approve', at: '2026-01-01T00:00:00Z' }],
      };

      // 1. getById (approve内)
      const getByIdChain = createChain({ data: proposals.pending, error: null });
      // 2. update → approved
      const updateChain = createChain({ data: approvedResult, error: null });
      // 3. getById (execute内)
      const getByIdChain2 = createChain({ data: { ...approvedResult }, error: null });

      setupMockFromSequence(mockFrom, [getByIdChain, updateChain, getByIdChain2]);

      const result = await service.approve(TEST_PROPOSAL_ID, actors.human);
      expect(result.isFullyApproved).toBe(true);
      expect(result.autoExecuted).toBe(false);
      expect(result.proposal.status).toBe('approved');
    });

    it('部分承認では自動実行されない', async () => {
      mockCanApprove.mockResolvedValue({ allowed: true });

      const twoApprovalProposal = makeProposal({
        status: 'pending',
        required_approvals: 2,
        approvals: [],
      });

      const stillProposedResult = {
        ...twoApprovalProposal,
        approvals: [{ actor: actors.human, decision: 'approve', at: '2026-01-01T00:00:00Z' }],
      };

      const getByIdChain = createChain({ data: twoApprovalProposal, error: null });
      const updateChain = createChain({ data: stillProposedResult, error: null });

      setupMockFromSequence(mockFrom, [getByIdChain, updateChain]);

      const result = await service.approve(TEST_PROPOSAL_ID, actors.human);
      expect(result.isFullyApproved).toBe(false);
      expect(result.autoExecuted).toBe(false);
      expect(result.proposal.status).toBe('pending');
    });

    it('AI 自己承認禁止 → エラー', async () => {
      mockCanApprove.mockResolvedValue({
        allowed: false,
        reason: 'AI_SELF_APPROVAL_PROHIBITED',
      });

      const chain = createChain({ data: proposals.aiCreated, error: null });
      mockFrom.mockReturnValue(chain);

      await expect(
        service.approve(TEST_PROPOSAL_ID, actors.ai)
      ).rejects.toThrow('AI_SELF_APPROVAL_PROHIBITED');
    });

    it('pending 以外の状態 → PROPOSAL_NOT_IN_PENDING_STATE', async () => {
      const chain = createChain({ data: proposals.draft, error: null });
      mockFrom.mockReturnValue(chain);

      await expect(
        service.approve(TEST_PROPOSAL_ID, actors.human)
      ).rejects.toThrow('PROPOSAL_NOT_IN_PENDING_STATE');
    });
  });

  // ============================================================
  // reject()
  // ============================================================

  describe('reject()', () => {
    it('RPC関数が利用可能な場合は原子実行結果を返す', async () => {
      const getByIdChain = createChain({ data: proposals.pending, error: null });
      mockFrom.mockReturnValue(getByIdChain);

      const rejectedResult = { ...proposals.rejected, status: 'rejected' };
      mockRpc.mockResolvedValueOnce({ data: rejectedResult, error: null });

      const result = await service.reject(TEST_PROPOSAL_ID, actors.human, 'テスト却下理由');
      expect(result.status).toBe('rejected');
      expect(mockRpc).toHaveBeenCalledWith('reject_proposal_atomic', {
        p_org_id: TEST_ORG_ID,
        p_proposal_id: TEST_PROPOSAL_ID,
        p_rejector: actors.human,
        p_reason: 'テスト却下理由',
      });
    });

    it('pending → rejected に遷移する', async () => {
      const rejectedResult = {
        ...proposals.rejected,
        status: 'rejected',
      };

      const getByIdChain = createChain({ data: proposals.pending, error: null });
      const updateChain = createChain({ data: rejectedResult, error: null });

      setupMockFromSequence(mockFrom, [getByIdChain, updateChain]);

      const result = await service.reject(TEST_PROPOSAL_ID, actors.human, 'テスト却下理由');
      expect(result.status).toBe('rejected');
    });

    it('reject RPCの旧エラー PROPOSAL_NOT_IN_PROPOSED_STATE を pending エラーとして扱う', async () => {
      const getByIdChain = createChain({ data: proposals.pending, error: null });
      mockFrom.mockReturnValue(getByIdChain);

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'PROPOSAL_NOT_IN_PROPOSED_STATE' },
      });

      await expect(
        service.reject(TEST_PROPOSAL_ID, actors.human, '理由')
      ).rejects.toThrow('PROPOSAL_NOT_IN_PENDING_STATE');
    });

    it('pending 以外 → PROPOSAL_NOT_IN_PENDING_STATE', async () => {
      const chain = createChain({ data: proposals.approved, error: null });
      mockFrom.mockReturnValue(chain);

      await expect(
        service.reject(TEST_PROPOSAL_ID, actors.human, '理由')
      ).rejects.toThrow('PROPOSAL_NOT_IN_PENDING_STATE');
    });

    it('strict mode時にreject RPC関数が存在しない場合は ATOMIC_RPC_REQUIRED', async () => {
      process.env.PROPOSAL_RPC_FALLBACK_MODE = 'disabled';
      const strictService = new ProposalService(TEST_ORG_ID);

      const getByIdChain = createChain({ data: proposals.pending, error: null });
      mockFrom.mockReturnValue(getByIdChain);

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Could not find the function public.reject_proposal_atomic' },
      });

      await expect(
        strictService.reject(TEST_PROPOSAL_ID, actors.human, '理由')
      ).rejects.toThrow('ATOMIC_RPC_REQUIRED');
    });
  });

  // ============================================================
  // batch approve/reject
  // ============================================================

  describe('approveBatch()/rejectBatch()', () => {
    it('approveBatch: 重複IDを除外し、成功/失敗件数を集計する', async () => {
      const approveSpy = jest
        .spyOn(service, 'approve')
        .mockImplementation(async (proposalId: string) => {
          if (proposalId === 'ok-1') {
            return {
              proposal: { ...proposals.executed, id: proposalId },
              isFullyApproved: true,
              autoExecuted: true,
            };
          }
          throw new Error('PROPOSAL_NOT_FOUND');
        });

      const result = await service.approveBatch(
        ['ok-1', 'ng-1', 'ok-1'],
        actors.human,
        'batch approval'
      );

      expect(approveSpy).toHaveBeenCalledTimes(2);
      expect(result.total).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.results[0]).toMatchObject({
        proposalId: 'ok-1',
        success: true,
        isFullyApproved: true,
        autoExecuted: true,
      });
      expect(result.results[1]).toMatchObject({
        proposalId: 'ng-1',
        success: false,
        error: 'PROPOSAL_NOT_FOUND',
      });
    });

    it('rejectBatch: 重複IDを除外し、成功/失敗件数を集計する', async () => {
      const rejectSpy = jest
        .spyOn(service, 'reject')
        .mockImplementation(async (proposalId: string) => {
          if (proposalId === 'ok-2') {
            return { ...proposals.rejected, id: proposalId };
          }
          throw new Error('PROPOSAL_NOT_IN_PENDING_STATE');
        });

      const result = await service.rejectBatch(
        ['ok-2', 'ng-2', 'ok-2'],
        actors.human,
        'batch rejection'
      );

      expect(rejectSpy).toHaveBeenCalledTimes(2);
      expect(result.total).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.results[0]).toMatchObject({
        proposalId: 'ok-2',
        success: true,
      });
      expect(result.results[1]).toMatchObject({
        proposalId: 'ng-2',
        success: false,
        error: 'PROPOSAL_NOT_IN_PENDING_STATE',
      });
    });
  });

  // ============================================================
  // execute()
  // ============================================================

  describe('execute()', () => {
    it('RPC関数が利用可能な場合は原子実行結果を返す', async () => {
      const executedResult = { ...proposals.executed };
      mockRpc.mockResolvedValue({ data: executedResult, error: null });

      const getByIdChain = createChain({ data: proposals.approved, error: null });
      mockFrom.mockReturnValue(getByIdChain);

      const result = await service.execute(TEST_PROPOSAL_ID, actors.system);
      expect(result.status).toBe('executed');
      expect(mockFrom).toHaveBeenCalledTimes(1);
      expect(mockRpc).toHaveBeenCalledWith('execute_proposal_atomic', {
        p_org_id: TEST_ORG_ID,
        p_proposal_id: TEST_PROPOSAL_ID,
        p_executor: actors.system,
      });
    });

    it('approved → executed に遷移し LedgerEvent を生成する', async () => {
      const executedResult = { ...proposals.executed };

      // 1. getById → approved
      const getByIdChain = createChain({ data: proposals.approved, error: null });
      // 2. findOrCreateLedgerEvent: select → no existing
      const eventSelectChain = createChain({ data: null, error: null });
      // 3. insert event
      const eventInsertChain = createChain({ data: ledgerEvent, error: null });
      // 4. findOrCreateLedgerTransaction: select → no existing
      const txSelectChain = createChain({ data: null, error: null });
      // 5. insert transaction
      const txInsertChain = createChain({ data: { id: TEST_TRANSACTION_ID }, error: null });
      // 6. insertLedgerEntriesIfNeeded: select → no existing
      const entriesSelectChain = createChain({ data: [], error: null });
      // 7. insert entries
      const entriesInsertChain = createChain({ data: null, error: null });
      // 8. update proposal → executed
      const executeUpdateChain = createChain({ data: executedResult, error: null });

      setupMockFromSequence(mockFrom, [
        getByIdChain,
        eventSelectChain,
        eventInsertChain,
        txSelectChain,
        txInsertChain,
        entriesSelectChain,
        entriesInsertChain,
        executeUpdateChain,
      ]);

      const result = await service.execute(TEST_PROPOSAL_ID, actors.system);
      expect(result.status).toBe('executed');
      expect(result.result_event_id).toBe(TEST_EVENT_ID);
    });

    it('evaluation.finalize 実行時に profile と confirmation を更新する', async () => {
      const approvedFinalizeProposal = makeProposal({
        status: 'approved',
        type: 'evaluation.finalize',
        payload: {
          month: '2026-04',
          member_id: '11111111-1111-4111-8111-111111111111',
          confirmed_big_skill_states: {
            cross_work: 'near_independent',
            site_trust: 'stable_independent',
          },
          work_days: 19,
          A: 2,
          R: 1,
          Q: 2,
          current_level: 'L3',
          comment: '月次レビュー',
        },
      });
      const executedFinalizeProposal = {
        ...approvedFinalizeProposal,
        status: 'executed',
        executed_at: '2026-01-02T00:00:00Z',
        executed_by: actors.system,
        result_event_id: TEST_EVENT_ID,
      };
      const finalizeEvent = {
        ...ledgerEvent,
        event_type: 'evaluation_finalized',
        payload: approvedFinalizeProposal.payload,
      };

      const getByIdChain = createChain({ data: approvedFinalizeProposal, error: null });
      const eventSelectChain = createChain({ data: null, error: null });
      const eventInsertChain = createChain({ data: finalizeEvent, error: null });
      const profileUpsertChain = createChain({ data: null, error: null });
      const confirmationsUpsertChain = createChain({ data: null, error: null });
      const finalizationsUpsertChain = createChain({ data: null, error: null });
      const executeUpdateChain = createChain({ data: executedFinalizeProposal, error: null });

      setupMockFromSequence(mockFrom, [
        getByIdChain,
        eventSelectChain,
        eventInsertChain,
        profileUpsertChain,
        confirmationsUpsertChain,
        finalizationsUpsertChain,
        executeUpdateChain,
      ]);

      const result = await service.execute(TEST_PROPOSAL_ID, actors.system);

      expect(result.status).toBe('executed');
      expect(profileUpsertChain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          org_id: TEST_ORG_ID,
          member_id: '11111111-1111-4111-8111-111111111111',
          cross_work_status: 'near_independent',
          site_trust_status: 'stable_independent',
          current_level: 'L3',
        }),
        { onConflict: 'org_id,member_id' }
      );
      expect(confirmationsUpsertChain.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            org_id: TEST_ORG_ID,
            month: '2026-04',
            member_id: '11111111-1111-4111-8111-111111111111',
            target_type: 'big_skill',
            target_key: 'cross_work',
            confirmation_status: 'near_independent',
          }),
        ]),
        { onConflict: 'org_id,month,member_id,target_type,target_key' }
      );
      expect(finalizationsUpsertChain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          org_id: TEST_ORG_ID,
          month: '2026-04',
          member_id: '11111111-1111-4111-8111-111111111111',
          work_days: 19,
          A: 2,
          R: 1,
          Q: 2,
          current_level: 'L3',
        }),
        { onConflict: 'org_id,month,member_id' }
      );
    });

    it('skill.achieve 実行時に certification current state を更新する', async () => {
      const approvedSkillProposal = makeProposal({
        status: 'approved',
        type: 'skill.achieve',
        payload: {
          member_id: '11111111-1111-4111-8111-111111111111',
          skill_key: 'joint_finish',
          category: 'finish',
          status: 'verified',
          evidence_count: 2,
          review_required_flag: false,
        },
      });
      const executedSkillProposal = {
        ...approvedSkillProposal,
        status: 'executed',
        executed_at: '2026-01-02T00:00:00Z',
        executed_by: actors.system,
        result_event_id: TEST_EVENT_ID,
      };
      const skillEvent = {
        ...ledgerEvent,
        event_type: 'skill_achieved',
        payload: approvedSkillProposal.payload,
      };

      const getByIdChain = createChain({ data: approvedSkillProposal, error: null });
      const eventSelectChain = createChain({ data: null, error: null });
      const eventInsertChain = createChain({ data: skillEvent, error: null });
      const certificationUpsertChain = createChain({ data: null, error: null });
      const executeUpdateChain = createChain({ data: executedSkillProposal, error: null });

      setupMockFromSequence(mockFrom, [
        getByIdChain,
        eventSelectChain,
        eventInsertChain,
        certificationUpsertChain,
        executeUpdateChain,
      ]);

      const result = await service.execute(TEST_PROPOSAL_ID, actors.system);

      expect(result.status).toBe('executed');
      expect(certificationUpsertChain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          org_id: TEST_ORG_ID,
          member_id: '11111111-1111-4111-8111-111111111111',
          skill_key: 'joint_finish',
          category: 'finish',
          status: 'verified',
          evidence_count: 2,
        }),
        { onConflict: 'org_id,member_id,skill_key' }
      );
    });

    it('冪等性: 既に executed の場合はそのまま返す', async () => {
      const chain = createChain({ data: proposals.executed, error: null });
      mockFrom.mockReturnValue(chain);

      const result = await service.execute(TEST_PROPOSAL_ID, actors.system);
      expect(result.status).toBe('executed');
      // from() は getById の1回だけ
      expect(mockFrom).toHaveBeenCalledTimes(1);
    });

    it('approved 以外（draft）→ PROPOSAL_NOT_APPROVED', async () => {
      const chain = createChain({ data: proposals.draft, error: null });
      mockFrom.mockReturnValue(chain);

      await expect(
        service.execute(TEST_PROPOSAL_ID, actors.system)
      ).rejects.toThrow('PROPOSAL_NOT_APPROVED');
    });

    it('PolicyEngine が実行不可と判定した場合はエラー', async () => {
      mockCanExecute.mockResolvedValue({ allowed: false, reason: 'INSUFFICIENT_APPROVALS' });
      const chain = createChain({ data: proposals.approved, error: null });
      mockFrom.mockReturnValue(chain);

      await expect(
        service.execute(TEST_PROPOSAL_ID, actors.system)
      ).rejects.toThrow('INSUFFICIENT_APPROVALS');
      expect(mockFrom).toHaveBeenCalledTimes(1);
    });

    it('strict mode時にexecute RPC関数が存在しない場合は ATOMIC_RPC_REQUIRED', async () => {
      process.env.PROPOSAL_RPC_FALLBACK_MODE = 'disabled';
      const strictService = new ProposalService(TEST_ORG_ID);

      const chain = createChain({ data: proposals.approved, error: null });
      mockFrom.mockReturnValue(chain);

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Could not find the function public.execute_proposal_atomic' },
      });

      await expect(
        strictService.execute(TEST_PROPOSAL_ID, actors.system)
      ).rejects.toThrow('ATOMIC_RPC_REQUIRED');
    });
  });

  describe('mapProposalTypeToEventType', () => {
    const mapEventType = (type: string) =>
      (service as unknown as {
        mapProposalTypeToEventType: (proposalType: string) => string;
      }).mapProposalTypeToEventType(type);

    it('evidence-backed internal_transfer bucket を explicit event type へ分解する', () => {
      expect(mapEventType('assignment.create')).toBe('assignment.scheduled');
      expect(mapEventType('assignment.update')).toBe('assignment.rescheduled');
      expect(mapEventType('assignment.cancel')).toBe('assignment.cancelled');
      expect(mapEventType('leave.request')).toBe('leave.recorded');
      expect(mapEventType('communication.review')).toBe('communication.review_recorded');
      expect(mapEventType('communication.task')).toBe('communication.task_recorded');
      expect(mapEventType('task.revision.request')).toBe('task.revision_requested');
      expect(mapEventType('site.create')).toBe('site.created');
    });

    it('site.complete は canonical fact path 優先のため internal_transfer に残す', () => {
      expect(mapEventType('site.complete')).toBe('internal_transfer');
    });
  });

  describe('applyStateChange', () => {
    const applyStateChange = (proposal: any) =>
      (service as any).applyStateChange(proposal, ledgerEvent);

    it.each([
      { type: 'assignment.update', payload: proposalPayloads.assignmentUpdate },
      { type: 'assignment.cancel', payload: proposalPayloads.assignmentCancel },
      { type: 'site.complete', payload: proposalPayloads.siteComplete },
    ])('$type は A-1 boundary として追加副作用を持たない', async ({ type, payload }) => {
      const ensureLedgerJournalSpy = jest
        .spyOn(service as any, 'ensureLedgerJournal')
        .mockResolvedValue(undefined);
      const assignmentCreateSpy = jest
        .spyOn(service as any, 'applyAssignmentCreate')
        .mockResolvedValue(undefined);
      const leaveRequestSpy = jest
        .spyOn(service as any, 'applyLeaveRequest')
        .mockResolvedValue(undefined);
      const evaluationFinalizeSpy = jest
        .spyOn(service as any, 'applyEvaluationFinalize')
        .mockResolvedValue(undefined);
      const skillCertificationSpy = jest
        .spyOn(service as any, 'applySkillCertification')
        .mockResolvedValue(undefined);
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        await expect(
          applyStateChange(
            makeProposal({
              type: type as any,
              payload,
            })
          )
        ).resolves.toBeUndefined();

        expect(ensureLedgerJournalSpy).toHaveBeenCalledWith(
          expect.objectContaining({ type, payload }),
          ledgerEvent
        );
        expect(assignmentCreateSpy).not.toHaveBeenCalled();
        expect(leaveRequestSpy).not.toHaveBeenCalled();
        expect(evaluationFinalizeSpy).not.toHaveBeenCalled();
        expect(skillCertificationSpy).not.toHaveBeenCalled();
      } finally {
        consoleLogSpy.mockRestore();
        skillCertificationSpy.mockRestore();
        evaluationFinalizeSpy.mockRestore();
        leaveRequestSpy.mockRestore();
        assignmentCreateSpy.mockRestore();
        ensureLedgerJournalSpy.mockRestore();
      }
    });
  });

  // ============================================================
  // delete()
  // ============================================================

  describe('delete()', () => {
    it('draft 状態のみ削除可能', async () => {
      const getByIdChain = createChain({ data: proposals.draft, error: null });
      const deleteChain = createChain({ data: null, error: null });

      setupMockFromSequence(mockFrom, [getByIdChain, deleteChain]);

      await expect(service.delete(TEST_PROPOSAL_ID)).resolves.toBeUndefined();
      expect(deleteChain.delete).toHaveBeenCalled();
    });

    it('pending 状態 → CAN_ONLY_DELETE_DRAFT_PROPOSALS', async () => {
      const chain = createChain({ data: proposals.pending, error: null });
      mockFrom.mockReturnValue(chain);

      await expect(
        service.delete(TEST_PROPOSAL_ID)
      ).rejects.toThrow('CAN_ONLY_DELETE_DRAFT_PROPOSALS');
    });
  });

  // ============================================================
  // buildLedgerEntries (via private access)
  // ============================================================

  describe('buildLedgerEntries - Ledger バランス検証', () => {
    const buildEntries = (proposal: any, event: any) =>
      (service as any).buildLedgerEntries(proposal, event);

    it('expense_recorded: debit合計 = credit合計', () => {
      const proposal = makeProposal({
        payload: { amount: 5000, category: 'material', description: 'テスト' },
      });
      const event = { ...ledgerEvent, event_type: 'expense_recorded' };

      const entries = buildEntries(proposal, event);
      expect(entries).not.toBeNull();

      const totalDebit = entries!.reduce((s: number, e: any) => s + e.debitAmount, 0);
      const totalCredit = entries!.reduce((s: number, e: any) => s + e.creditAmount, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(5000);
    });

    it('income_recorded: debit合計 = credit合計', () => {
      const proposal = makeProposal({
        type: 'income.create',
        payload: { amount: 100000, description: '売上' },
      });
      const event = { ...ledgerEvent, event_type: 'income_recorded' };

      const entries = buildEntries(proposal, event);
      expect(entries).not.toBeNull();

      const totalDebit = entries!.reduce((s: number, e: any) => s + e.debitAmount, 0);
      const totalCredit = entries!.reduce((s: number, e: any) => s + e.creditAmount, 0);
      expect(totalDebit).toBe(totalCredit);
    });

    it('payment_received: 売掛金を現金に振替', () => {
      const proposal = makeProposal({
        type: 'invoice.mark_paid',
        payload: { amount: 50000 },
      });
      const event = { ...ledgerEvent, event_type: 'payment_received' };

      const entries = buildEntries(proposal, event);
      expect(entries).toHaveLength(2);
      // 現金（借方）+ 売掛金（貸方）
      expect(entries![0].accountCode).toBe('1100'); // cash
      expect(entries![1].accountCode).toBe('1200'); // accountsReceivable
    });

    it('金額が 0 または null → null を返す', () => {
      const proposal = makeProposal({ payload: { description: 'no amount' } });
      const event = { ...ledgerEvent, event_type: 'expense_recorded' };

      expect(buildEntries(proposal, event)).toBeNull();
    });

    it('expense カテゴリマッピング: material → 5100', () => {
      const proposal = makeProposal({
        payload: { amount: 1000, category: 'material' },
      });
      const event = { ...ledgerEvent, event_type: 'expense_recorded' };

      const entries = buildEntries(proposal, event);
      expect(entries![0].accountCode).toBe('5100'); // materials
    });

    it('expense カテゴリマッピング: travel → 5300', () => {
      const proposal = makeProposal({
        payload: { amount: 2000, category: 'travel' },
      });
      const event = { ...ledgerEvent, event_type: 'expense_recorded' };

      const entries = buildEntries(proposal, event);
      expect(entries![0].accountCode).toBe('5300'); // travel
    });

    it('不明カテゴリ → 5900 (otherExpense)', () => {
      const proposal = makeProposal({
        payload: { amount: 500, category: 'unknown' },
      });
      const event = { ...ledgerEvent, event_type: 'expense_recorded' };

      const entries = buildEntries(proposal, event);
      expect(entries![0].accountCode).toBe('5900');
    });
  });

  // ============================================================
  // leave.request side effect (via private access)
  // ============================================================

  describe('applyLeaveRequest', () => {
    const applyLeaveRequest = (proposal: any) =>
      (service as any).applyLeaveRequest(proposal);

    it('personal_schedules に承認済み休暇を新規作成する', async () => {
      const lookupChain = createChain({ data: null, error: null });
      const insertChain = createChain({ data: null, error: null });
      setupMockFromSequence(mockFrom, [lookupChain, insertChain]);

      const leaveProposal = makeProposal({
        type: 'leave.request',
        payload: {
          user_id: '11111111-1111-4111-8111-111111111111',
          start_date: '2026-03-01',
          end_date: '2026-03-02',
          leave_type: 'vacation',
          reason: '家族都合',
        },
      });

      await expect(applyLeaveRequest(leaveProposal)).resolves.toBeUndefined();
      expect(mockFrom).toHaveBeenNthCalledWith(1, 'personal_schedules');
      expect(mockFrom).toHaveBeenNthCalledWith(2, 'personal_schedules');
      expect(insertChain.insert).toHaveBeenCalled();
    });

    it('unsupported leave_type はスキップする', async () => {
      const leaveProposal = makeProposal({
        type: 'leave.request',
        payload: {
          user_id: '11111111-1111-4111-8111-111111111111',
          start_date: '2026-03-01',
          end_date: '2026-03-02',
          leave_type: 'unsupported',
        },
      });

      await expect(applyLeaveRequest(leaveProposal)).resolves.toBeUndefined();
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // extractAmount (via private access)
  // ============================================================

  describe('extractAmount', () => {
    const extract = (payload: Record<string, unknown>) =>
      (service as any).extractAmount(payload);

    it('amount フィールドから数値を抽出', () => {
      expect(extract({ amount: 3000 })).toBe(3000);
    });

    it('文字列 "¥3,000" → 3000', () => {
      expect(extract({ amount: '¥3,000' })).toBe(3000);
    });

    it('amount_subtotal + tax_amount を合算', () => {
      expect(extract({ amount_subtotal: 10000, tax_amount: 1000 })).toBe(11000);
    });

    it('負の金額は絶対値にする', () => {
      expect(extract({ amount: -5000 })).toBe(5000);
    });

    it('金額情報なし → null', () => {
      expect(extract({ description: 'no amount' })).toBeNull();
    });
  });

  // ============================================================
  // isBalanced (via private access)
  // ============================================================

  describe('isBalanced', () => {
    const isBalanced = (debit: number, credit: number) =>
      (service as any).isBalanced(debit, credit);

    it('同額 → true', () => {
      expect(isBalanced(1000, 1000)).toBe(true);
    });

    it('浮動小数点誤差を吸収（小数点2桁で丸め）', () => {
      expect(isBalanced(0.1 + 0.2, 0.3)).toBe(true);
    });

    it('1円以上の差異 → false', () => {
      expect(isBalanced(1000, 999)).toBe(false);
    });
  });
});
