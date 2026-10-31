import { z } from "zod";

// Request bodies for the newsletter endpoints. The consent checkbox must be
// ticked: the box, with the exact wording beside it, is what the ledger records.

export const subscribeSchema = z.object({
  email: z.string().trim().min(1, "Enter your email address.").max(200, "That email address is too long.").pipe(z.email("Enter a valid email address.")),
  consent: z.literal(true, { error: "Tick the box to subscribe." }),
});

export const tokenSchema = z.object({
  token: z.string().trim().min(10).max(400),
});

export type SubscribeBody = z.infer<typeof subscribeSchema>;
