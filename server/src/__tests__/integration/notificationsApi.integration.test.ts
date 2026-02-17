import { createChain } from '../helpers/mockSupabase';

jest.mock('../../lib/supabaseAdmin', () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { supabaseAdmin } from '../../lib/supabaseAdmin';
import notificationsRouter from '../../routes/notifications';

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

function getGetHandler(path: string) {
  const layer = (notificationsRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.get
  );

  if (!layer) {
    throw new Error(`GET handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

function getPostHandler(path: string) {
  const layer = (notificationsRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.post
  );

  if (!layer) {
    throw new Error(`POST handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe('notifications API integration', () => {
  const listHandler = getGetHandler('/');
  const readOneHandler = getPostHandler('/:id/read');
  const readAllHandler = getPostHandler('/read-all');

  const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET / applies unread and limit filters via HTTP', async () => {
    const chain = createChain({
      data: [{ id: 'n-1', read: false }],
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const req = {
      userId: 'user-1',
      query: { unread_only: 'true', limit: '999' },
    } as any;
    const res = createMockRes();

    await listHandler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([{ id: 'n-1', read: false }]);
    expect(mockFrom).toHaveBeenCalledWith('notifications');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(chain.eq).toHaveBeenCalledWith('read', false);
    expect(chain.limit).toHaveBeenCalledWith(100);
  });

  it('POST /:id/read returns 404 when notification is missing', async () => {
    const chain = createChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    const req = {
      userId: 'user-1',
      params: { id: 'n-404' },
    } as any;
    const res = createMockRes();

    await readOneHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Notification not found' });
  });

  it('POST /read-all returns updated_count from DB result length', async () => {
    const chain = createChain({
      data: [{ id: 'n-1' }, { id: 'n-2' }, { id: 'n-3' }],
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const req = { userId: 'user-1' } as any;
    const res = createMockRes();

    await readAllHandler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ updated_count: 3 });
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(chain.eq).toHaveBeenCalledWith('read', false);
    expect(chain.select).toHaveBeenCalledWith('id');
  });
});
