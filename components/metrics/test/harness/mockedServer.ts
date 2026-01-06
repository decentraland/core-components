import { Router } from "@well-known-components/http-server"
import { TestComponents } from "./test-helpers"

// handlers arguments only type what they need, to make unit testing easier
export type PingComponents = Pick<TestComponents, "metrics">
export async function pingHandler(context: { url: URL; components: PingComponents }) {
  const {
    url,
    components: { metrics },
  } = context

  metrics.increment("test_counter", {
    pathname: url.pathname,
  })

  return {
    body: url.pathname,
  }
}

// handlers arguments only type what they need, to make unit testing easier
export type HistoComponents = Pick<TestComponents, "metrics">
export async function histoHandler(context: { url: URL; components: PingComponents }) {
  const {
    url,
    components: { metrics },
  } = context

  metrics.observe(
    "test_histogram",
    {
      pathname: url.pathname,
    },
    Math.random()
  )

  return {
    body: url.pathname,
  }
}

// handlers arguments only type what they need, to make unit testing easier
export type SummComponents = Pick<TestComponents, "metrics">
export async function summHandler(context: { url: URL; components: PingComponents }) {
  const {
    url,
    components: { metrics },
  } = context

  metrics.observe(
    "test_summary",
    {
      pathname: url.pathname,
    },
    Math.random()
  )

  return {
    body: url.pathname,
  }
}
// handlers arguments only type what they need, to make unit testing easier
export type DecrementComponents = Pick<TestComponents, "metrics">
export async function decrementHandler(context: { url: URL; components: PingComponents }) {
  const {
    url,
    components: { metrics },
  } = context

  metrics.decrement("test_gauge", {
    pathname: url.pathname,
  })

  return {
    body: url.pathname,
  }
}
// handlers arguments only type what they need, to make unit testing easier
export type IncrementComponents = Pick<TestComponents, "metrics">
export async function incrementHandler(context: { url: URL; components: PingComponents }) {
  const {
    url,
    components: { metrics },
  } = context

  metrics.increment("test_gauge", {
    pathname: url.pathname,
  })

  return {
    body: url.pathname,
  }
}
// handlers arguments only type what they need, to make unit testing easier
export type UserIdComponents = Pick<TestComponents, "metrics">
export async function userIdHandler(context: { url: URL; components: PingComponents; params: { userId: string } }) {
  const {
    url,
    components: { metrics },
    params: { userId },
  } = context

  metrics.increment("user_counter", { userId })
  metrics.observe("test_gauge", { pathname: url.pathname }, userId.length)

  return {
    body: url.pathname,
  }
}

export function mockedRouter() {
  const router = new Router<{ components: TestComponents }>()

  router.get("/ping", pingHandler)
  router.get("/histo", histoHandler)
  router.get("/summ", summHandler)
  router.get("/increment", incrementHandler)
  router.get("/decrement", decrementHandler)
  router.get("/users/:userId", userIdHandler)
  router.post("/users/:userId", userIdHandler)

  return router.middleware()
}
