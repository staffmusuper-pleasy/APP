import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MatchProviderMapping = {
  match_id: string;
  provider: string;
  provider_match_id: string;
};

/**
 * Resolve a stable provider-specific identifier for a given match.
 *
 * Replaces the legacy team-name + date matching with a direct lookup against
 * match_provider_ids. Returns null when the mapping is not yet known.
 */
export const resolveMatchProviderId = createServerFn({ method: "POST" })
  .inputValidator((input: { matchId: string; provider: string }) => {
    if (!input?.matchId || !input?.provider) {
      throw new Error("matchId and provider are required");
    }
    return input;
  })
  .handler(async ({ data }): Promise<MatchProviderMapping | null> => {
    const { data: row, error } = await supabaseAdmin
      .from("match_provider_ids")
      .select("match_id, provider, provider_match_id")
      .eq("match_id", data.matchId)
      .eq("provider", data.provider)
      .maybeSingle();
    if (error) throw error;
    return row as MatchProviderMapping | null;
  });
