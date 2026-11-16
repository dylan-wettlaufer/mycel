# Behaviour tracing fixture

The application fixture is `OrderForm.tsx`, `submit.ts`, `app/`, `services/`,
`db/`, the manifest, and `prisma/schema.prisma`. Tests materialize `.txt` sources
into an ordinary temporary repository without installing or executing its code.

The form has a nested submission handler and title/preview state. The native fetch
client branches between GET preview and POST creation. Next handlers call service
functions which use a directly imported PrismaClient instance. All five supported
CRUD methods occur in the service module. The schema proves the Order delegate.

`Form.tsx` and `client.ts` are smaller binding-only fixtures for inline and named
event callbacks, independent of framework metadata. Application tests exclude
those two files. Negative and incremental test variants are written at runtime.

The supported paths are:

`form.onSubmit → handleSubmit → submitOrder → fetch → GET /api/orders → GET → listOrders → Order.findMany → Order`

`form.onSubmit → handleSubmit → submitOrder → fetch → POST /api/orders → POST → createOrder → Order.create → Order`

See [behaviour tracing](../../../../../docs/BEHAVIOUR_TRACING.md) for boundary
codes, unsupported protocols, and query limits. These are possible static reference
paths, not a runtime timeline or argument/data-flow proof.
