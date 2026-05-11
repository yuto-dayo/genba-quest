/**
 * Supabase チェーンAPI モックヘルパー
 *
 * supabaseAdmin.from('table').select('*').eq('id', val).single()
 * のようなチェーン呼び出しをモック化する。
 *
 * 使い方:
 *   const mock = createMockSupabase();
 *   jest.mock('../../lib/supabaseAdmin', () => ({ supabaseAdmin: mock.client }));
 *   mock.mockResult({ data: ..., error: null });
 */

type SupabaseResult = { data: unknown; error: unknown };

interface MockChain {
  select: jest.Mock;
  insert: jest.Mock;
  upsert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  eq: jest.Mock;
  gt: jest.Mock;
  gte: jest.Mock;
  lte: jest.Mock;
  lt: jest.Mock;
  neq: jest.Mock;
  in: jest.Mock;
  is: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  range: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
  then: (resolve: (val: SupabaseResult) => void, reject?: (err: unknown) => void) => Promise<unknown>;
  _result: SupabaseResult;
}

export function createChain(result: SupabaseResult = { data: null, error: null }): MockChain {
  const chain: MockChain = {} as MockChain;
  chain._result = result;

  const chainable = ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'gt', 'gte', 'lte', 'lt', 'neq', 'in', 'is', 'order', 'limit', 'range'] as const;
  for (const method of chainable) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }

  chain.single = jest.fn().mockImplementation(() => Promise.resolve(chain._result));
  chain.maybeSingle = jest.fn().mockImplementation(() => Promise.resolve(chain._result));

  // Promise-like: await without terminal method
  chain.then = (resolve, reject) => Promise.resolve(chain._result).then(resolve, reject);

  return chain;
}

/**
 * テーブル名 → チェーン のマッピングで from() をモック化
 */
export function setupMockFrom(
  mockFrom: jest.Mock,
  tableChains: Record<string, MockChain>
): void {
  mockFrom.mockImplementation((table: string) => {
    return tableChains[table] || createChain();
  });
}

/**
 * from() を呼び出し順でチェーンを返すようモック化
 */
export function setupMockFromSequence(
  mockFrom: jest.Mock,
  chains: MockChain[]
): void {
  let callIndex = 0;
  mockFrom.mockImplementation(() => {
    const chain = chains[callIndex] || createChain();
    callIndex++;
    return chain;
  });
}
