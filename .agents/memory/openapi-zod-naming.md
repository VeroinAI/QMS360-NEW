---
name: Orval zod export naming in api-zod
description: generated zod consts get operation-derived names; component schemas only contribute TypeScript types — name collisions cause TS2308
---

In `lib/api-zod`, the generated zod *values* are named from the **operationId** (`createIntegrationConnector` → `CreateIntegrationConnectorBody`, `PullConnectorDataBody`), not from the component schema they reference. Component schemas (`components/schemas`) only produce TypeScript **types**.

**Why:** naming a component schema exactly `<OperationId>Body` or `<OperationId>Response` makes both generated modules export the same name and codegen fails with TS2308; importing a component-named zod const fails with TS2693 "only refers to a type". Both cost a full edit/codegen cycle.

**How to apply:** name request/response component schemas anything EXCEPT the `<operationId>Body|Response|Params` pattern (e.g. `IntegrationConnectorCreateInput`), and import server-side zod validators by the operation-derived names. Separate existing quirks: no `format: uuid` / `type: integer` in the spec; and an endpoint that has BOTH a path `Id` parameter AND Page/Limit query params collides (a `...Params` zod const vs type export) — drop pagination from such endpoints or rename the path param away from `Id`.

Inline request-body objects also infer the colliding `<OperationId>Body` TypeScript name. Use named `*Input` component references even for small request bodies. The path/query `Params` collision is not limited to pagination: a single format query parameter can trigger it too; use the existing Accept-header download convention when appropriate.

When a path-plus-query contract is necessary, explicitly prefer the generated runtime validator from the server Zod barrel instead of changing generated files. The frontend client barrel can still expose its generated query-parameter type.

**Why:** Orval exports operation-derived Zod values alongside inferred TypeScript names through the same barrel, and TypeScript reports TS2308 even though each generated module is individually valid.
