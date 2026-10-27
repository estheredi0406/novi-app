import type { RecordVerification } from "@novi/shared";
import { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { renderRecordDocument } from "../lib/recordDocument.js";
import { publicKeyPem, verifyShare } from "../services/recordService.js";

// Public: what a lender reaches by scanning the QR code on a shared savings
// record (D50). No login: the code itself, 122 random bits, is the key, and
// every opening is logged.
export const verifyApiRouter = Router();
export const verifyPageRouter = Router();

const params = z.object({ id: z.string().uuid() });

// The public key, so a lender's own systems can check signatures.
verifyApiRouter.get("/public-key", (_req, res) => {
  res.json({ algorithm: "Ed25519", publicKeyPem: publicKeyPem() });
});

verifyApiRouter.get("/:id", async (req, res) => {
  const { id } = params.parse(req.params);
  res.json(await verifyShare(id));
});

// The same check as a document a loan officer can open on any phone, print
// or save as PDF (D65).
verifyPageRouter.get("/:id", async (req, res) => {
  const { id } = params.parse(req.params);
  res.type("html").send(await documentFor(await verifyShare(id), id, `${req.protocol}://${req.get("host")}`));
});

// The document for one share, with its QR code drawn by the server.
export async function documentFor(check: RecordVerification, shareId: string, origin: string): Promise<string> {
  const verifyUrl = `${origin}/verify/${shareId}`;
  const qrSvg = await QRCode.toString(verifyUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#1B1F4B" },
  });
  return renderRecordDocument(check, { shareId, verifyUrl, qrSvg, publicKeyUrl: `${origin}/v1/verify/public-key` });
}
