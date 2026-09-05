---
name: Orval zod export naming in api-zod
description: generated zod consts get operation-derived names; component schemas only contribute TypeScript types — name collisions cause TS2308
---

In `lib/api-zod`, the generated zod *values* are named from the **operationId** (`createIntegrationConnector` → `CreateIntegrationConnectorBody`, `PullConnectorDataBody`), not from the component schema they reference. Component schemas (`components/schemas`) only produce TypeScript **types**.

**Why:** naming a component schema exactly `<OperationId>Body` or `<OperationId>Response` makes both generated modules export the same name and codegen fails with TS2308; importing a component-named zod const fails with TS2693 "only refers to a type". Both cost a full edit/codegen cycle.

**How to apply:** name request/response component schemas anything EXCEPT the `<operationId>Body|Response|Params` pattern (e.g. `IntegrationConnectorCreateInput`), and import server-side zod validators by the operation-derived names. Separate existing quirk: no `format: uuid` / `type: integer` in the spec.
