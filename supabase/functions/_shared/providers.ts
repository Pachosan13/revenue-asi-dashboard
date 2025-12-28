// supabase/functions/_shared/providers.ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ProviderConfig = {
  provider: string;
  config: any;
};

export async function getChannelProvider(
  supabase: SupabaseClient,
  accountId: string,
  channel: "email" | "sms" | "voice" | "whatsapp"
): Promise<ProviderConfig | null> {
  const { data, error } = await supabase
    .from("account_provider_settings")
    .select("provider, config")
    .eq("account_id", accountId)
    .eq("channel", channel)
    .eq("is_default", true)
    .maybeSingle();

  if (error) {
    console.error("[getChannelProvider] error", error);
    return null;
  }

  if (!data) return null;

  return {
    provider: data.provider,
    config: data.config ?? {},
  };
}
