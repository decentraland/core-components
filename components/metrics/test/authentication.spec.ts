import { describeTestE2E } from "./harness/test-e2e-test-server"

describeTestE2E("Authenticated tests", ({ components, beforeStart }) => {
  beforeStart(async () => {
    process.env.WKC_METRICS_BEARER_TOKEN = "asd"
    process.env.WKC_METRICS_PUBLIC_PATH = "/a/metrics"
  })

  it("responds the /metrics endpoint with 404", async () => {
    const { fetch } = components
    const res = await fetch.fetch("/metrics")
    expect(res.status).toEqual(404)
  })

  it("responds the /a/metrics endpoint with 401", async () => {
    const { fetch } = components
    const res = await fetch.fetch("/a/metrics")
    expect(res.status).toEqual(401)
  })

  it("responds the /a/metrics endpoint with 200", async () => {
    const { fetch } = components
    const res = await fetch.fetch("/a/metrics", { headers: { authorization: "Bearer asd" } })
    expect(res.status).toEqual(200)
  })

  it("responds the /a/metrics endpoint with 401 with invalid token", async () => {
    const { fetch } = components
    const res = await fetch.fetch("/a/metrics", { headers: { authorization: "Bearer xxxxxxxxx" } })
    expect(res.status).toEqual(401)
  })
})
