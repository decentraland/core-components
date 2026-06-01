import { START_COMPONENT, STOP_COMPONENT } from "@well-known-components/interfaces"
import { createFeaturesComponent } from "../src"
import { IFeaturesComponent } from "../src/types"

const FF_DEFAULT_URL = "https://feature-flags.decentraland.org"

function createLoggerMock() {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}

function okResponse(flags: Record<string, boolean>, variants: Record<string, unknown> = {}) {
  return { ok: true, json: jest.fn().mockResolvedValue({ flags, variants }) } as any
}

type BuildArgs = {
  strings?: Record<string, string | undefined>
  numbers?: Record<string, number | undefined>
  apps?: string[]
}

async function buildFeatures({ strings = {}, numbers = {}, apps }: BuildArgs = {}) {
  const logger = createLoggerMock()
  const fetchMock = jest.fn()
  const config = {
    getString: jest.fn(async (key: string) => strings[key]),
    getNumber: jest.fn(async (key: string) => numbers[key])
  }
  const features = await createFeaturesComponent(
    { config: config as any, logs: { getLogger: () => logger } as any, fetch: { fetch: fetchMock } as any },
    "REFERER",
    apps ? { apps } : {}
  )
  return { features, fetchMock, logger, config }
}

describe("when reading a flag that is not overridden in the environment", () => {
  let features: IFeaturesComponent
  let fetchMock: jest.Mock

  describe("and no request timeout is configured", () => {
    beforeEach(async () => {
      ;({ features, fetchMock } = await buildFeatures())
      fetchMock.mockResolvedValue(okResponse({ "dapps-x": true }))
    })

    it("should request the flags with the default 10s timeout", async () => {
      await features.getIsFeatureEnabled("dapps", "x")

      expect(fetchMock).toHaveBeenCalledWith(`${FF_DEFAULT_URL}/dapps.json`, expect.objectContaining({ timeout: 10000 }))
    })
  })

  describe("and a valid request timeout is configured", () => {
    beforeEach(async () => {
      ;({ features, fetchMock } = await buildFeatures({ numbers: { FF_REQUEST_TIMEOUT: 5000 } }))
      fetchMock.mockResolvedValue(okResponse({ "dapps-x": true }))
    })

    it("should request the flags with the configured timeout", async () => {
      await features.getIsFeatureEnabled("dapps", "x")

      expect(fetchMock).toHaveBeenCalledWith(`${FF_DEFAULT_URL}/dapps.json`, expect.objectContaining({ timeout: 5000 }))
    })
  })

  describe("and an invalid request timeout is configured", () => {
    let logger: ReturnType<typeof createLoggerMock>

    beforeEach(async () => {
      ;({ features, fetchMock, logger } = await buildFeatures({ numbers: { FF_REQUEST_TIMEOUT: -1 } }))
      fetchMock.mockResolvedValue(okResponse({ "dapps-x": true }))
    })

    it("should warn and fall back to the default timeout", async () => {
      await features.getIsFeatureEnabled("dapps", "x")

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("FF_REQUEST_TIMEOUT"))
      expect(fetchMock).toHaveBeenCalledWith(`${FF_DEFAULT_URL}/dapps.json`, expect.objectContaining({ timeout: 10000 }))
    })
  })
})

describe("when the flag is overridden in the environment", () => {
  let features: IFeaturesComponent
  let fetchMock: jest.Mock

  beforeEach(async () => {
    ;({ features, fetchMock } = await buildFeatures({ strings: { FF_DAPPS_X: "1" } }))
  })

  it("should resolve from the environment without hitting the feature-flags service", async () => {
    await expect(features.getIsFeatureEnabled("dapps", "x")).resolves.toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("when two reads for the same application happen concurrently", () => {
  let features: IFeaturesComponent
  let fetchMock: jest.Mock

  beforeEach(async () => {
    ;({ features, fetchMock } = await buildFeatures())
    fetchMock.mockResolvedValue(okResponse({ "dapps-x": true }, { "dapps-x": { name: "v", enabled: true, payload: {} } }))
  })

  it("should de-duplicate the in-flight request and fetch only once", async () => {
    await Promise.all([features.getIsFeatureEnabled("dapps", "x"), features.getFeatureVariant("dapps", "x")])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("when an application is not registered", () => {
  let features: IFeaturesComponent
  let fetchMock: jest.Mock

  beforeEach(async () => {
    ;({ features, fetchMock } = await buildFeatures())
    fetchMock.mockResolvedValue(okResponse({ "dapps-x": true }))
  })

  it("should fetch the flags on every (sequential) call", async () => {
    await features.getIsFeatureEnabled("dapps", "x")
    await features.getIsFeatureEnabled("dapps", "x")

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe("when an application is registered", () => {
  let features: IFeaturesComponent
  let fetchMock: jest.Mock
  let logger: ReturnType<typeof createLoggerMock>

  beforeEach(async () => {
    jest.useFakeTimers()
    ;({ features, fetchMock, logger } = await buildFeatures({ numbers: { FF_REFRESH_INTERVAL: 1000 }, apps: ["dapps"] }))
    fetchMock.mockResolvedValue(okResponse({ "dapps-x": true }))
    await features[START_COMPONENT]!({} as any)
  })

  afterEach(async () => {
    await features[STOP_COMPONENT]!()
    jest.useRealTimers()
  })

  it("should preload the flags on start", () => {
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  describe("and reads happen after start", () => {
    it("should serve them from cache without re-fetching", async () => {
      await features.getIsFeatureEnabled("dapps", "x")
      await features.getFeatureVariant("dapps", "x")

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe("and the refresh interval elapses", () => {
    it("should refresh the flags in the background", async () => {
      await jest.advanceTimersByTimeAsync(1000)

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe("and the component is stopped", () => {
    it("should stop refreshing", async () => {
      await features[STOP_COMPONENT]!()
      await jest.advanceTimersByTimeAsync(5000)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe("and a background refresh fails after a successful load", () => {
    beforeEach(async () => {
      fetchMock.mockRejectedValueOnce(new Error("service unavailable"))
      await jest.advanceTimersByTimeAsync(1000)
    })

    it("should keep serving the last cached value", async () => {
      await expect(features.getIsFeatureEnabled("dapps", "x")).resolves.toBe(true)
    })

    it("should log the refresh error", () => {
      expect(logger.error).toHaveBeenCalled()
    })
  })
})
