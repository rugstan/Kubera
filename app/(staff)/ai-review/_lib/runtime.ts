import "server-only";
import type { AuthServices } from "@/lib/auth/server";
import { demoReviewStore } from "@/lib/ai/review/demo";
import { reviewStore } from "@/lib/ai/review/server";
import type { ReviewStore } from "@/lib/ai/review/types";

/**
 * The review store for the signed-in session: the Supabase-backed store in a
 * real deployment, the illustrative demo conversations in fake-auth mode,
 * null when Supabase is not configured.
 */
export function reviewStoreFor(services: Pick<AuthServices, "mode">): ReviewStore | null {
  return services.mode === "fake" ? demoReviewStore() : reviewStore();
}
