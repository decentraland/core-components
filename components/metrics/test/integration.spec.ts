import { TestArguments } from "@well-known-components/test-helpers"
import { describeE2E } from "./harness/test-e2e-express-server"
import { describeTestE2E } from "./harness/test-e2e-test-server"
import { TestComponents } from "./harness/test-helpers"

const integrationSuite = ({ components, beforeStart }: TestArguments<TestComponents>) => {
  beforeStart(async () => {
    delete process.env.WKC_METRICS_BEARER_TOKEN
    delete process.env.WKC_METRICS_PUBLIC_PATH
  })

  it("responds the /metrics endpoint", async () => {
    const { fetch } = components
    const res = await fetch.fetch("/metrics")
    expect(res.status).toEqual(200)
  })
  it("response has test_counter", async () => {
    const { fetch } = components
    const res = await fetch.fetch("/metrics")
    const text = await res.text()
    expect(text.includes("test_counter")).toEqual(true)
  })
  it("http call count must be 2", async () => {
    const { metrics } = components
    const metric = await metrics.getValue("http_requests_total" as any)
    expect(metric.values).toEqual([
      {
        labels: {
          code: 200,
          handler: "/metrics",
          method: "GET",
        },
        value: 2,
      },
    ])
  })

  it("ping 1", async () => {
    const { metrics, fetch } = components
    {
      const metric = await metrics.getValue("test_counter")
      expect(metric.values).toEqual([])
    }
    await fetch.fetch("/ping")
    {
      const metric = await metrics.getValue("test_counter")
      expect(metric.values).toEqual([
        {
          labels: {
            pathname: "/ping",
          },
          value: 1,
        },
      ])
    }
  })

  it("register all kinds of metrics using endpoints without failing", async () => {
    const { fetch } = components
    await fetch.fetch("/histo")
    await fetch.fetch("/summ")
    await fetch.fetch("/increment")
    await fetch.fetch("/decrement")
    await fetch.fetch("/increment")
    await fetch.fetch("/ping")
    await fetch.fetch("/metrics")
  })

  it("resets all the metrics", async () => {
    const { metrics } = components
    metrics.resetAll()
    const metric = await metrics.getValue("http_requests_total" as any)
    expect(metric.values).toEqual([])
  })

  it("calls to unknown endpoints must register 404 errors", async () => {
    const { fetch, metrics } = components
    await fetch.fetch("/userasdasd")
    await fetch.fetch("/useradsfasdlfjk")
    await fetch.fetch("/useisd8fpeh")
    await fetch.fetch("/14387ylasdn")
    await fetch.fetch("/odifa708345l")
    await fetch.fetch("/asdiugapgylwe")
    const metric = await metrics.getValue("http_requests_total" as any)
    expect(metric.values).toEqual([{ value: 6, labels: { method: "GET", handler: "", code: 404 } }])
  })

  it("calls to /user/:userId", async () => {
    const { fetch, metrics } = components
    metrics.resetAll()
    await fetch.fetch("/users/1")
    await fetch.fetch("/users/2")
    await fetch.fetch("/users/2?something=a")
    await fetch.fetch("/users/3")
    await fetch.fetch("/users/3?a=1")
    await fetch.fetch("/users/3?a=2&b=3#test")
    await fetch.fetch("/users/3?a=2&b=3#test", { method: "post" })
  })

  it("http_requests_total must register only the router route, not the full url", async () => {
    const { metrics } = components
    const metric = await metrics.getValue("http_requests_total" as any)
    expect(metric.values).toEqual([
      {
        value: 6,
        labels: { method: "GET", handler: "/users/:userId", code: 200 },
      },
      {
        value: 1,
        labels: { method: "POST", handler: "/users/:userId", code: 200 },
      },
    ])
  })

  it("user_counter must register three metrics", async () => {
    const { metrics } = components
    const metric = await metrics.getValue("user_counter")
    expect(metric.values).toEqual([
      {
        value: 1,
        labels: { userId: "1" },
      },
      {
        value: 2,
        labels: { userId: "2" },
      },
      {
        value: 4,
        labels: { userId: "3" },
      },
    ])
  })
}

describeE2E("integration sanity tests using express server backend", integrationSuite)
describeTestE2E("integration sanity tests using test server", integrationSuite)
