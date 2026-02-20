const mockHistoryList = jest.fn();
const mockSetCredentials = jest.fn();

jest.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: jest.fn(() => ({
        setCredentials: mockSetCredentials,
      })),
    },
    gmail: jest.fn(() => ({
      users: {
        history: {
          list: mockHistoryList,
        },
      },
    })),
  },
}));

jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

import { GmailWatcher } from "../../services/GmailWatcher";

describe("GmailWatcher.getNewMessages", () => {
  beforeEach(() => {
    mockHistoryList.mockReset();
    mockSetCredentials.mockReset();
  });

  it("returns empty list when Gmail historyId is not found", async () => {
    mockHistoryList.mockRejectedValue({
      status: 404,
      errors: [{ reason: "notFound", message: "Requested entity was not found." }],
      response: {
        status: 404,
        data: {
          error: {
            errors: [{ reason: "notFound" }],
          },
        },
      },
      message: "Requested entity was not found.",
    });

    const watcher = new GmailWatcher({
      clientId: "cid",
      clientSecret: "secret",
      refreshToken: "refresh",
      topicName: "projects/sample/topics/gmail-notifications",
    });

    await expect(watcher.getNewMessages("4001")).resolves.toEqual([]);
  });

  it("rethrows non-recoverable Gmail API errors", async () => {
    const error = {
      status: 401,
      errors: [{ reason: "authError", message: "Invalid Credentials" }],
      message: "Invalid Credentials",
    };
    mockHistoryList.mockRejectedValue(error);

    const watcher = new GmailWatcher({
      clientId: "cid",
      clientSecret: "secret",
      refreshToken: "refresh",
      topicName: "projects/sample/topics/gmail-notifications",
    });

    await expect(watcher.getNewMessages("4001")).rejects.toBe(error);
  });
});
