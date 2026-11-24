import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.string().default("5000"),
    HOST: z.string().default("127.0.0.1"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    SESSION_DURATION_HOURS: z.coerce
      .number()
      .int()
      .min(1, "SESSION_DURATION_HOURS must be at least 1")
      .max(720, "SESSION_DURATION_HOURS must not exceed 720 (30 days)")
      .default(8),
    SESSION_COOKIE_NAME: z.string().min(1).default("sid"),
    FRONTEND_ORIGIN: z.string().url("FRONTEND_ORIGIN must be a valid URL").optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === "production" && !data.FRONTEND_ORIGIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FRONTEND_ORIGIN"],
        message:
          "FRONTEND_ORIGIN is required in production. " +
          "Set it to the exact URL of the frontend (e.g. https://app.example.com).",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
