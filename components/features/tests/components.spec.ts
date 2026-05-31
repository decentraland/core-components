import { test } from "./components"

test("features component", function ({ components }) {
  const FF_APP = "TestApp"
  const FF_TOGGLE = "TestFF"
  const FF_KEY = `${FF_APP}-${FF_TOGGLE}`

  describe("when checking a feature flag is enabled", () => {
    describe("and the feature flag is in the .env file", () => {
      describe("and the feature flag is enabled", () => {
        beforeEach(() => {
          const { config } = components
          jest.spyOn(config, "getString").mockResolvedValueOnce("1")
        })

        it("should return true", () => {
          const { features } = components
          return expect(features.getIsFeatureEnabled(FF_APP, FF_TOGGLE)).resolves.toBe(true)
        })
      })

      describe("and the feature flag is disabled", () => {
        beforeEach(() => {
          const { config } = components
          jest.spyOn(config, "getString").mockResolvedValueOnce("0")
        })

        it("should return false", () => {
          const { features } = components
          return expect(features.getIsFeatureEnabled(FF_APP, FF_TOGGLE)).resolves.toBe(false)
        })
      })
    })

    describe("and the feature flag is not in the .env file", () => {
      beforeEach(() => {
        const { features } = components
        jest.spyOn(features, "getEnvFeature").mockResolvedValueOnce(undefined)
      })

      describe("and the feature flag is fetched successfully from the features service", () => {
        describe("and the feature flag is enabled", () => {
          beforeEach(() => {
            const { fetch } = components
            jest.spyOn(fetch, "fetch").mockResolvedValueOnce({
              ok: true,
              json: jest.fn().mockResolvedValue({
                flags: { [FF_KEY]: true },
              }),
            } as any)
          })

          it("should return true", () => {
            const { features } = components
            return expect(features.getIsFeatureEnabled(FF_APP, FF_TOGGLE)).resolves.toBe(true)
          })
        })

        describe("and the feature flag is disabled", () => {
          beforeEach(() => {
            const { fetch } = components
            jest.spyOn(fetch, "fetch").mockResolvedValueOnce({
              ok: true,
              json: jest.fn().mockResolvedValueOnce({
                flags: {},
              }),
            } as any)
          })

          it("should return false", () => {
            const { features } = components
            return expect(features.getIsFeatureEnabled(FF_APP, FF_TOGGLE)).resolves.toBe(false)
          })
        })
      })

      describe("and the feature flag could not be fetched successfully from features service", () => {
        beforeEach(() => {
          const { fetch } = components
          jest.spyOn(fetch, "fetch").mockResolvedValueOnce({
            ok: false,
          } as any)
        })

        it("should return false", () => {
          const { features } = components
          return expect(features.getIsFeatureEnabled(FF_APP, FF_TOGGLE)).resolves.toBe(false)
        })
      })
    })
  })

  describe("when checking a feature flag variant", () => {
    describe("and the feature flag is enabled", () => {
      describe("and the feature flag has a variant", () => {
        const FF_VARIANT = {
          name: "TestFFVariant",
          payload: {
            type: "string",
            value: "1",
          },
          enabled: true,
        }

        beforeEach(() => {
          const { fetch } = components
          jest.spyOn(fetch, "fetch").mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValueOnce({
              flags: {
                [FF_KEY]: true,
              },
              variants: { [FF_KEY]: FF_VARIANT },
            }),
          } as any)
        })

        it("should return the variant data", () => {
          const { features } = components
          return expect(features.getFeatureVariant(FF_APP, FF_TOGGLE)).resolves.toBe(FF_VARIANT)
        })
      })

      describe("and the feature flag does not have a variant", () => {
        beforeEach(() => {
          const { fetch } = components
          jest.spyOn(fetch, "fetch").mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValueOnce({
              flags: {
                [FF_KEY]: true,
              },
              variants: {},
            }),
          } as any)
        })

        it("should return null", () => {
          const { features } = components
          return expect(features.getFeatureVariant(FF_APP, FF_TOGGLE)).resolves.toBe(null)
        })
      })
    })

    describe("and the feature flag is disabled", () => {
      beforeEach(() => {
        const { fetch } = components
        jest.spyOn(fetch, "fetch").mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce({
            flags: {},
          }),
        } as any)
      })

      it("should return null", () => {
        const { features } = components
        return expect(features.getFeatureVariant(FF_APP, FF_TOGGLE)).resolves.toBe(null)
      })
    })
  })
})
