import { createConfigComponent } from "@well-known-components/env-config-provider"
import { IFetchComponent } from "@dcl/core-commons"
import { createLogComponent } from "@well-known-components/logger"
import { createRunner } from "@well-known-components/test-helpers"
import { createFeaturesComponent } from "../src"
import { TestComponents } from "../src/types"

/**
 * Behaves like Jest "describe" function, used to describe a test for a
 * use case, it creates a whole new program and components to run an
 * isolated test.
 *
 * State is persistent within the steps of the test.
 */
export const test = createRunner<TestComponents>({
  async main({ startComponents }) {
    await startComponents()
  },
  async initComponents(): Promise<TestComponents> {
    const config = createConfigComponent(process.env, {})
    const logs = await createLogComponent({})
    const fetcher: IFetchComponent = {
      async fetch() {
        return {} as any
      },
    }

    const features = await createFeaturesComponent(
      {
        fetch: fetcher,
        logs,
        config,
      },
      "REFERENCE_SERVER_URL"
    )

    return {
      fetch: fetcher,
      logs,
      config,
      features,
    }
  },
})
