import { createChain, setupMockFromSequence } from '../helpers/mockSupabase';
import {
  actors,
  proposals,
  policies,
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
    it('draft → proposed に遷移する', async () => {
      const proposedResult = { ...proposals.proposed };

      // from('proposals').select().eq().single() → draft (getById)
      const getByIdChain = createChain({ data: proposals.draft, error: null });
      // from('proposals').update().eq().select().single() → proposed
      const updateChain = createChain({ data: proposedResult, error: null });

      setupMockFromSequence(mockFrom, [getByIdChain, updateChain]);

      const result = await service.submit(TEST_PROPOSAL_ID, actors.human);
      expect(result.proposal.status).toBe('proposed');
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
      const chain = createChain({ data: proposals.proposed, error: null });
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
      const getByIdChain = createChain({ data: proposals.proposed, error: null });
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
      const getByIdChain = createChain({ data: proposals.proposed, error: null });
      mockFrom.mockReturnValue(getByIdChain);

      const partialProposal = {
        ...proposals.proposed,
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
      const getByIdChain = createChain({ data: proposals.proposed, error: null });
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
      const getByIdChain = createChain({ data: proposals.proposed, error: null });
      mockFrom.mockReturnValue(getByIdChain);

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'AI_SELF_APPROVAL_PROHIBITED' },
      });

      await expect(
        service.approve(TEST_PROPOSAL_ID, actors.ai)
      ).rejects.toThrow('AI_SELF_APPROVAL_PROHIBITED');
    });

    it('RPC関数が存在しない場合はfallbackへ', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Could not find the function public.approve_proposal_atomic' },
      });
      mockCanApprove.mockResolvedValue({ allowed: true });

      const approvedResult = {
        ...proposals.proposed,
        status: 'approved',
        approvals: [{ actor: actors.human, decision: 'approve', at: '2026-01-01T00:00:00Z' }],
      };
      const executedResult = { ...proposals.executed };

      const getByIdChain = createChain({ data: proposals.proposed, error: null });
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
        ...proposals.proposed,
        status: 'approved',
        approvals: [{ actor: actors.human, decision: 'approve', at: '2026-01-01T00:00:00Z' }],
      };
      const executedResult = { ...proposals.executed };

      // 1. getById (approve内)
      const getByIdChain = createChain({ data: proposals.proposed, error: null });
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
        ...proposals.proposed,
        status: 'approved',
        approvals: [{ actor: actors.human, decision: 'approve', at: '2026-01-01T00:00:00Z' }],
      };

      // 1. getById (approve内)
      const getByIdChain = createChain({ data: proposals.proposed, error: null });
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
        status: 'proposed',
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
      expect(result.proposal.status).toBe('proposed');
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

    it('proposed 以外の状態 → PROPOSAL_NOT_IN_PROPOSED_STATE', async () => {
      const chain = createChain({ data: proposals.draft, error: null });
      mockFrom.mockReturnValue(chain);

      await expect(
        service.approve(TEST_PROPOSAL_ID, actors.human)
      ).rejects.toThrow('PROPOSAL_NOT_IN_PROPOSED_STATE');
    });
  });

  // ============================================================
  // reject()
  // ============================================================

  describe('reject()', () => {
    it('RPC関数が利用可能な場合は原子実行結果を返す', async () => {
      const getByIdChain = createChain({ data: proposals.proposed, error: null });
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

    it('proposed → rejected に遷移する', async () => {
      const rejectedResult = {
        ...proposals.rejected,
        status: 'rejected',
      };

      const getByIdChain = createChain({ data: proposals.proposed, error: null });
      const updateChain = createChain({ data: rejectedResult, error: null });

      setupMockFromSequence(mockFrom, [getByIdChain, updateChain]);

      const result = await service.reject(TEST_PROPOSAL_ID, actors.human, 'テスト却下理由');
      expect(result.status).toBe('rejected');
    });

    it('proposed 以外 → PROPOSAL_NOT_IN_PROPOSED_STATE', async () => {
      const chain = createChain({ data: proposals.approved, error: null });
      mockFrom.mockReturnValue(chain);

      await expect(
        service.reject(TEST_PROPOSAL_ID, actors.human, '理由')
      ).rejects.toThrow('PROPOSAL_NOT_IN_PROPOSED_STATE');
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
          throw new Error('PROPOSAL_NOT_IN_PROPOSED_STATE');
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
        error: 'PROPOSAL_NOT_IN_PROPOSED_STATE',
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

    it('proposed 状態 → CAN_ONLY_DELETE_DRAFT_PROPOSALS', async () => {
      const chain = createChain({ data: proposals.proposed, error: null });
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
