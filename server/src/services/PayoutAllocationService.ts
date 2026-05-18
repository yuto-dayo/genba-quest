import { largestRemainderRound } from "./PathV32SimpleRewardService";

export interface PayoutBalance {
  member_id: string;
  unsettled: number;
}

export interface AllocationLine {
  member_id: string;
  allocated: number;
  unsettled_after: number;
}

function normalizeYen(value: number, code: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(code);
  }
  return Math.round(value);
}

export class PayoutAllocationService {
  static allocateProRata(receivedAmount: number, balances: PayoutBalance[]): AllocationLine[] {
    const received = Math.max(0, normalizeYen(receivedAmount, "INVALID_RECEIVED_AMOUNT"));
    const positiveBalances = balances
      .map((balance) => ({
        member_id: balance.member_id,
        unsettled: normalizeYen(balance.unsettled, "INVALID_UNSETTLED_AMOUNT"),
      }))
      .filter((balance) => balance.member_id && balance.unsettled > 0)
      .sort((left, right) => left.member_id.localeCompare(right.member_id));

    if (received === 0 || positiveBalances.length === 0) {
      return [];
    }

    const totalUnsettled = positiveBalances.reduce((sum, balance) => sum + balance.unsettled, 0);
    if (received >= totalUnsettled) {
      return positiveBalances.map((balance) => ({
        member_id: balance.member_id,
        allocated: balance.unsettled,
        unsettled_after: 0,
      }));
    }

    const rawAllocations = positiveBalances.map(
      (balance) => (received * balance.unsettled) / totalUnsettled,
    );
    const roundedAllocations = largestRemainderRound(received, rawAllocations);

    return positiveBalances
      .map((balance, index) => {
        const allocated = Math.min(balance.unsettled, roundedAllocations[index] ?? 0);
        return {
          member_id: balance.member_id,
          allocated,
          unsettled_after: balance.unsettled - allocated,
        };
      })
      .filter((line) => line.allocated > 0);
  }
}
