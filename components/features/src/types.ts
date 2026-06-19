import { IBaseComponent, IConfigComponent, ILoggerComponent } from "@well-known-components/interfaces"
import { IFetchComponent } from "@dcl/core-commons"

/**
 * @public
 */
export type FeatureFlagVariant = {
  name: string
  payload: {
    type: string
    value: string
  }
  enabled: boolean
}

/**
 * @public
 */
export type FeaturesFlagsResponse = {
  flags: Record<string, boolean>
  variants: Record<string, FeatureFlagVariant>
}

/**
 * @public
 */
export type FeaturesComponents = {
  fetch: IFetchComponent
  logs: ILoggerComponent
  config: IConfigComponent
}

/**
 * Options for the features component.
 * @public
 */
export type FeaturesComponentOptions = {
  /**
   * Applications whose feature flags are preloaded on start and continuously
   * refreshed in the background. Reads for these applications are served from
   * the in-memory cache. Applications that are not registered are still
   * supported, but their flags are fetched on every call (with in-flight
   * de-duplication).
   */
  apps?: string[]
}

/**
 * @public
 */
export type IFeaturesComponent = IBaseComponent & {
  /**
   * Helper to get whether a feature flag is enabled or disabled.
   * It will first look into your env file for the feature flag, if it is not defined there,
   * it will look it in the requested and stored features data.
   * The env key will be determined from the application and the flag. For example, if the
   * application is "explorer" and the flag is "some-crazy-feature", it will look
   * for it as FF_EXPLORER_SOME_CRAZY_FEATURE.
   * @param app - Appplication name.
   * @param feature - Feature key without the application name prefix. For example for the "builder-feature".
   * @returns Whether the feature is enabled or not and its variant.
   */
  getEnvFeature(app: string, feature: string): Promise<string | undefined>
  getIsFeatureEnabled(app: string, feature: string): Promise<boolean>
  getFeatureVariant(app: string, feature: string): Promise<FeatureFlagVariant | null>
}

/**
 * @public
 */
export enum ApplicationName {
  EXPLORER = "explorer",
  BUILDER = "builder",
  MARKETPLACE = "marketplace",
  ACCOUNT = "account",
  DAO = "dao",
  DAPPS = "dapps",
  EVENTS = "events",
  LANDING = "landing",
  TEST = "test",
  CORE = "core"
}

/**
 * @public
 */
export type TestComponents = FeaturesComponents & {
  features: IFeaturesComponent
}
