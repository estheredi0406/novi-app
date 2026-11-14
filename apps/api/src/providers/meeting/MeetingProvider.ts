// Where group meetings happen (D71). Behind an interface (D3) so Daily can be
// replaced later, for example by a server at the MFI.
export interface MeetingProvider {
  createRoom(input: { name: string; opensAt: Date; closesAt: Date; maxParticipants: number }): Promise<{
    name: string;
    url: string;
  }>;
  deleteRoom(name: string): Promise<void>;
  // The address that lets this member in, with her pass in it.
  joinUrl(input: {
    roomName: string;
    roomUrl: string;
    userId: string;
    userName: string;
    isOwner: boolean;
    closesAt: Date;
    lang: "fr" | "en";
  }): Promise<string>;
}
