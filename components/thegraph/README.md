# @dcl/thegraph-component

A component used to query [thegraph](https://thegraph.com/)'s subgraphs over HTTP, with retries and timeouts.

It relies on the native-fetch `IFetchComponent` from [`@dcl/core-commons`](../../shared/commons) (no `node-fetch`).

## Installation

```bash
npm install @dcl/thegraph-component
```

## API

### Create

To create the component you'll have to supply the subgraph's url. You can get it from thegraph's site, for example: https://api.thegraph.com/subgraphs/name/decentraland/marketplace

```ts
import { createSubgraphComponent } from '@dcl/thegraph-component'

const url = 'https://api.thegraph.com/subgraphs/name/decentraland/marketplace'
await createSubgraphComponent({ config, logs, metrics, fetch }, url)
```

The `fetch` dependency is an `IFetchComponent` from `@dcl/core-commons` (e.g. created with `@dcl/fetch-component`). For the query timeout to abort the in-flight request, the fetch implementation must honor the `abortController` request option.

### Query

The main API is:

```ts
query: <T>(query: string, variables?: Variables, remainingAttempts?: number) => Promise<T>
```

So you can call it like this:

```ts
type Element = {
  id: string
  count: number
}

function getElementsQuery() {
  return `query getCollection($count: Number!) {
    elements(where: { count_gt: $count }) {
      id
      count
    }
  }`
}

await subgraph.query<{ elements: Element[] }>(getElementsQuery(), { count: 5 })
```

## Configuration

It supports the following ENV variables:

- `SUBGRAPH_COMPONENT_RETRIES`: How many retries per subgraph query. Defaults to `3`.
- `SUBGRAPH_COMPONENT_QUERY_TIMEOUT`: How long to wait until a connection is timed-out. Defaults to `10000`ms or 10 seconds.
- `SUBGRAPH_COMPONENT_TIMEOUT_INCREMENT`: How much time to add after each retry. The value will be multiplied for the attempt number. For example: if the increment is 10000, it'll wait 10s the first retry, 20s next, 30s, etc. Defaults to `10000`ms or 10 seconds.
- `SUBGRAPH_COMPONENT_BACKOFF`: How long to wait until a new query is tried after an unsuccessful one (retrying). Defaults to `500`ms.
- `SUBGRAPH_COMPONENT_AGENT_NAME`: The name of the agent that will be performing the graph requests. This agent name will be used to identify the graph requests using the user agent header. The crafted header will be: `Subgraph component / Agent Name`.
