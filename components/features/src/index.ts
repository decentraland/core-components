import { FeatureFlagVariant, FeaturesFlagsResponse, FeaturesComponents, IFeaturesComponent } from "./types"

export * from "./types"

/**
 * Creates a scoped features component to fetch features flag from a given application.
 * @public
 */
export async function createFeaturesComponent(
  components: FeaturesComponents,
  referer: string
): Promise<IFeaturesComponent> {
  const { config, fetch, logs } = components
  const FF_URL = (await config.getString("FF_URL")) ?? "https://feature-flags.decentraland.org"

  const logger = logs.getLogger("features")

  async function getEnvFeature(app: string, feature: string): Promise<string | undefined> {
    return config.getString(`FF_${app}_${feature}`.toUpperCase())
  }

  async function fetchFeatureFlags(app: string): Promise<FeaturesFlagsResponse | null> {
    try {
      const response = await fetch.fetch(`${FF_URL}/${app}.json`, {
        headers: {
          Referer: referer,
        },
      })

      if (response.ok) {
        return (await response.json()) as FeaturesFlagsResponse
      } else {
        throw new Error(`Could not fetch features service from ${FF_URL}`)
      }
    } catch (error) {
      logger.error(error instanceof Error ? error : new Error(String(error)))
    }

    return null
  }

  async function getIsFeatureEnabled(app: string, feature: string): Promise<boolean> {
    const envFeatureFlag = await getEnvFeature(app, feature)
    if (envFeatureFlag) {
      return envFeatureFlag === "1"
    }

    const featureFlags = await fetchFeatureFlags(app)

    return !!featureFlags?.flags[`${app}-${feature}`]
  }

  async function getFeatureVariant(app: string, feature: string): Promise<FeatureFlagVariant | null> {
    const ffKey = `${app}-${feature}`
    const featureFlags = await fetchFeatureFlags(app)

    if (featureFlags?.flags[ffKey] && featureFlags?.variants[ffKey]) {
      return featureFlags.variants[ffKey]
    }

    return null
  }

  return {
    getEnvFeature,
    getIsFeatureEnabled,
    getFeatureVariant,
  }
}
