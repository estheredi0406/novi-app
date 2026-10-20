import { randomUUID } from "node:crypto";
import type { GroupAccountRequest, MfiAdapter } from "./MfiAdapter.js";

// Stands in for the partner MFI until it offers an API (brief: FUCEC-Togo has
// none today). Keeps the accounts in memory so tests can read what the MFI
// was told, and can be made to fail once, as a real MFI sometimes will.
export class MockMfiAdapter implements MfiAdapter {
  readonly accounts = new Map<string, { accountRef: string; request: GroupAccountRequest }>();
  failNext = false;

  async openGroupAccount(request: GroupAccountRequest): Promise<{ accountRef: string }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("mock MFI unavailable");
    }
    const existing = this.accounts.get(request.groupId);
    if (existing) return { accountRef: existing.accountRef };

    const accountRef = `MOCK-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.accounts.set(request.groupId, { accountRef, request });
    console.log(`[mock MFI] opened ${accountRef} for group ${request.groupId}`);
    return { accountRef };
  }
}