import { bindings, defineConfig } from "cf/config";

import * as entrypoint from "./src/index" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    compatibilityDate: "2026-10-23",
    domains: ["chord.taqib.dev"],
    entrypoint,
    env: {
      DB: bindings.d1({
        id: "95eb8bf6-74d3-46ca-9844-79c7314240ca",
        name: "juicetrybe-orders",
      }),
      MCP_BEARER_TOKEN: bindings.secret(),
      PAYSTACK_SECRET_KEY: bindings.secret(),
      PUBLIC_URL: bindings.text("https://chord.taqib.dev"),
    },
    name: "juicetrybe-orders",
    observability: { enabled: true },
  },
});
