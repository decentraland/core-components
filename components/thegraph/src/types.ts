export type Variables = Record<string, string[] | string | number | boolean | undefined>

export type Error = { message: string }

export type SubgraphResponse<T> = { data: T; errors?: Error[] | Error }

export type SubgraphProvider = string

export type PostQueryResponse<T> = [SubgraphProvider, SubgraphResponse<T>]

export interface ISubgraphComponent {
  /**
   * Query the subgraph using GraphQL
   * @param query - String version of a GraphQL query
   * @param variables - Any variables present on the query, if any
   * @returns Query result
   */
  query: <T>(query: string, variables?: Variables, remainingAttempts?: number) => Promise<T>
}

export namespace ISubgraphComponent {
  export type Composable = {
    subgraph: ISubgraphComponent
  }
}
