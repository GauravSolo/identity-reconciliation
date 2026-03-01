import { Request, Response } from "express";
import { z } from "zod";
import { identifyContact } from "../services/contact.service";

const identifySchema = z
  .object({
    email: z.email("Invalid email format").nullish(),
    phoneNumber: z
      .union([z.string(), z.number()])
      .transform((val) => String(val))
      .pipe(z.string().length(10, "Phone number must be 10 digits"))
      .nullish(),
  })
  .refine((data) => data.email || data.phoneNumber, {
    message: "At least one of email or phoneNumber must be provided",
  });

export async function identify(req: Request, res: Response) {
  const parsed = identifySchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues.map((e: { message: string }) => e.message) });
    return;
  }

  const { email, phoneNumber } = parsed.data;

  const result = await identifyContact(email ?? null, phoneNumber ?? null);
  res.status(200).json(result);
}
