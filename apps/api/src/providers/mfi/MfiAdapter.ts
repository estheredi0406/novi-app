// What Novi asks of the MFI that holds a group's money (D34). The MFI is told
// what it needs to hold and pay out the money, and nothing about who pays
// what: group totals only, no names or phone numbers (D33).
export type GroupAccountRequest = {
  groupId: string; // Novi's reference; sent again on a retry, so one group never gets two accounts
  contributionFcfa: number; // what each member pays each time
  members: number;
  frequency: "WEEKLY" | "MONTHLY";
};

export interface MfiAdapter {
  // Opens the group's account and returns the MFI's reference for it.
  // Calling it again for the same groupId returns the same account.
  openGroupAccount(request: GroupAccountRequest): Promise<{ accountRef: string }>;
}