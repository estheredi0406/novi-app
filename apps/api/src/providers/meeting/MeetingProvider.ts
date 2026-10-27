// Where group meetings take place (D71). Novi asks the provider for a
// private room for one meeting, and for a personal pass for each member who
// joins. Behind an interface like every outside service (D3), so Daily can
// be replaced, for example by a self-hosted server at the MFI.
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
