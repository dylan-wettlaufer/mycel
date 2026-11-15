# Semantic orders fixture

This source-only React/TypeScript + Next.js App Router application is materialized
in a temporary repository by `semantic-application.test.mjs`. Files end in `.txt`
so indexing Mycel itself does not treat them as application source. No dependency
installation or framework runtime is needed.

Supported path:

`/orders → OrdersPage → OrdersPanel → listOrders → orders-sdk/client`

The API handler `GET /api/orders` calls the same operation. The source explicitly
declares feature `orders`, service operation `listOrders`, and data model `Order`.
The model's return-type usage does not establish READS or WRITES.

See [semantic graph rules](../../../../../docs/SEMANTIC_GRAPH.md) for boundaries.
