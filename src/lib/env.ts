import { z } from "zod";

/**
 * Public env is inlined at build time, so each key must be referenced
 * literally (process.env.NEXT_PUBLIC_X) for Next.js to substitute it.
 */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/**
 * "demo" runs the whole booking flow with a simulated payment screen: no
 * Razorpay account, no money moves, refunds are recorded instantly.
 */
const paymentsMode = z.enum(["razorpay", "demo"]).default("razorpay");

const publicSchema = z
  .object({
    NEXT_PUBLIC_SITE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
    NEXT_PUBLIC_PAYMENTS_MODE: paymentsMode,
    NEXT_PUBLIC_RAZORPAY_KEY_ID: optional(z.string().startsWith("rzp_")),
  })
  .superRefine((env, ctx) => {
    if (env.NEXT_PUBLIC_PAYMENTS_MODE === "razorpay" && !env.NEXT_PUBLIC_RAZORPAY_KEY_ID) {
      ctx.addIssue({ code: "custom", path: ["NEXT_PUBLIC_RAZORPAY_KEY_ID"], message: "required unless NEXT_PUBLIC_PAYMENTS_MODE=demo" });
    }
  });

const serverSchema = z
  .object({
    NEXT_PUBLIC_PAYMENTS_MODE: paymentsMode,
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    RAZORPAY_KEY_SECRET: optional(z.string().min(8)),
    RAZORPAY_WEBHOOK_SECRET: optional(z.string().min(8)),
    RAZORPAYX_ACCOUNT_NUMBER: optional(z.string().min(6)),
    RESEND_API_KEY: optional(z.string().startsWith("re_")),
    EMAIL_FROM: optional(z.string().min(3)),
    WHATSAPP_WEBHOOK_URL: optional(z.string().url()),
    WHATSAPP_WEBHOOK_TOKEN: optional(z.string()),
    SMS_WEBHOOK_URL: optional(z.string().url()),
    SMS_WEBHOOK_TOKEN: optional(z.string()),
  })
  .superRefine((env, ctx) => {
    if (env.NEXT_PUBLIC_PAYMENTS_MODE !== "razorpay") return;
    for (const key of ["RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] as const) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "required unless NEXT_PUBLIC_PAYMENTS_MODE=demo" });
    }
  });

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

let cachedPublic: PublicEnv | undefined;
let cachedServer: ServerEnv | undefined;

export function publicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_PAYMENTS_MODE: process.env.NEXT_PUBLIC_PAYMENTS_MODE,
    NEXT_PUBLIC_RAZORPAY_KEY_ID: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
  });
  if (!parsed.success) {
    throw new Error(`Invalid public environment: ${formatIssues(parsed.error)}`);
  }
  cachedPublic = parsed.data;
  return cachedPublic;
}

/** Server-only secrets. Importing this from a client component fails the build. */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() must never run in the browser");
  }
  if (cachedServer) return cachedServer;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid server environment: ${formatIssues(parsed.error)}`);
  }
  cachedServer = parsed.data;
  return cachedServer;
}

/** True when checkout uses the simulated payment screen instead of Razorpay. */
export function isDemoPayments(): boolean {
  return publicEnv().NEXT_PUBLIC_PAYMENTS_MODE === "demo";
}
