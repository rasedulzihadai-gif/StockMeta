import type { AppSettingsDTO, AssetDTO } from "@/lib/types";
import type { ProviderStateDTO } from "@/lib/providers/registry";
import { listProviderStates } from "./providers";
import { getSettings, listAssets } from "./repo";

export interface InitialData {
  assets: AssetDTO[];
  providers: ProviderStateDTO[];
  settings: AppSettingsDTO;
}

export async function getInitialData(): Promise<InitialData> {
  const [assets, providers, settings] = await Promise.all([listAssets(), listProviderStates(), getSettings()]);
  return { assets, providers, settings };
}
