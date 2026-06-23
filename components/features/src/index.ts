import { START_COMPONENT, STOP_COMPONENT } from "@well-known-components/interfaces"
import {
  FeatureFlagVariant,
  FeaturesComponentOptions,
  FeaturesComponents,
  FeaturesFlagsResponse,
  IFeaturesComponent
} from "./types"

export * from "./types"

const DEFAULT_REQUEST_TIMEOUT_MS = 10000
const DEFAULT_REFRESH_INTERVAL_MS = 4 * 60 * 1000

/**
 * Creates a scoped features component to fetch feature flags from a given application.
 *
 * Every request to the feature-flags service is bounded by a timeout
 * (`FF_REQUEST_TIMEOUT`, default 10s). Applications registered via
 * `options.apps` are preloaded on start and refreshed in the background every
 * `FF_REFRESH_INTERVAL` (default 4 minutes); their reads are served from an
 * in-memory cache. Concurrent requests for the same application are
 * de-duplicated: callers that arrive while a request is in flight wait for it.
 * @public
 */
export async function createFeaturesComponent(
  components: FeaturesComponents,
  referer: string,
  options: FeaturesComponentOptions = {}
): Promise<IFeaturesComponent> {
  const { config, fetch, logs } = components
  const FF_URL = (await config.getString("FF_URL")) ?? "https://feature-flags.decentraland.org"

  const logger = logs.getLogger("features")

  async function getValidatedConfigNumber(key: string, defaultValue: number): Promise<number> {
    const configuredValue = await config.getNumber(key)
    const isValid = typeof configuredValue === "number" && Number.isFinite(configuredValue) && configuredValue > 0
    if (configuredValue !== undefined && !isValid) {
      logger.warn(`${key} value "${configuredValue}" is invalid; using default ${defaultValue}ms`)
    }
    return isValid ? (configuredValue as number) : defaultValue
  }

  const requestTimeout = await getValidatedConfigNumber("FF_REQUEST_TIMEOUT", DEFAULT_REQUEST_TIMEOUT_MS)
  const refreshInterval = await getValidatedConfigNumber("FF_REFRESH_INTERVAL", DEFAULT_REFRESH_INTERVAL_MS)

  const registeredApps = new Set<string>(options.apps ?? [])
  const cachedFlagsByApp = new Map<string, FeaturesFlagsResponse>()
  const inFlightByApp = new Map<string, Promise<FeaturesFlagsResponse | null>>()
  let refreshTimer: NodeJS.Timeout | null = null

  async function getEnvFeature(app: string, feature: string): Promise<string | undefined> {
    return config.getString(`FF_${app}_${feature}`.toUpperCase())
  }

  async function requestFeatureFlags(app: string): Promise<FeaturesFlagsResponse | null> {
    try {
      const response = await fetch.fetch(`${FF_URL}/${app}.json`, {
        headers: {
          Referer: referer
        },
        timeout: requestTimeout
      })

      if (!response.ok) {
        // Release the undici body before discarding the response so its socket
        // isn't left checked out of the pool and its bytes buffered until GC.
        await response.body?.cancel().catch(() => {})
        throw new Error(`Could not fetch features service from ${FF_URL}`)
      }

      const flags = (await response.json()) as FeaturesFlagsResponse

      if (registeredApps.has(app)) {
        cachedFlagsByApp.set(app, flags)
      }

      return flags
    } catch (error) {
      logger.error(error instanceof Error ? error : new Error(String(error)))
      // On failure keep serving the last known value for registered apps.
      return cachedFlagsByApp.get(app) ?? null
    }
  }

  // De-duplicates concurrent fetches for the same application: callers that
  // arrive while a request is in flight await the same promise.
  function fetchFeatureFlags(app: string): Promise<FeaturesFlagsResponse | null> {
    const inFlight = inFlightByApp.get(app)
    if (inFlight) {
      return inFlight
    }

    const request = requestFeatureFlags(app).finally(() => {
      inFlightByApp.delete(app)
    })
    inFlightByApp.set(app, request)
    return request
  }

  async function getFlags(app: string): Promise<FeaturesFlagsResponse | null> {
    // If a request for this app is already in flight, wait for it to finish.
    const inFlight = inFlightByApp.get(app)
    if (inFlight) {
      return inFlight
    }

    // Registered apps are served from the continuously refreshed cache. The cache
    // only ever holds real responses, so a single `get` (instead of `has` + `get`)
    // tells us whether the value is present.
    if (registeredApps.has(app)) {
      const cached = cachedFlagsByApp.get(app)
      if (cached !== undefined) {
        return cached
      }
    }

    return fetchFeatureFlags(app)
  }

  async function getIsFeatureEnabled(app: string, feature: string): Promise<boolean> {
    const envFeatureFlag = await getEnvFeature(app, feature)
    if (envFeatureFlag) {
      return envFeatureFlag === "1"
    }

    const featureFlags = await getFlags(app)

    return !!featureFlags?.flags[`${app}-${feature}`]
  }

  async function getFeatureVariant(app: string, feature: string): Promise<FeatureFlagVariant | null> {
    const ffKey = `${app}-${feature}`
    const featureFlags = await getFlags(app)

    const variant = featureFlags?.variants?.[ffKey]
    if (variant && featureFlags?.flags[ffKey]) {
      return variant
    }

    return null
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([...registeredApps].map((app) => fetchFeatureFlags(app)))
  }

  async function start(): Promise<void> {
    if (registeredApps.size === 0) {
      return
    }

    // Preload the registered applications so the first reads are served from cache.
    await refreshAll()

    refreshTimer = setInterval(() => {
      refreshAll().catch((error) => {
        logger.error(error instanceof Error ? error : new Error(String(error)))
      })
    }, refreshInterval)
  }

  async function stop(): Promise<void> {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  }

  return {
    getEnvFeature,
    getIsFeatureEnabled,
    getFeatureVariant,
    [START_COMPONENT]: start,
    [STOP_COMPONENT]: stop
  }
}
