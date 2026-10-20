// The `test` every spec imports. Compared with Playwright's own, each page here:
//   - cannot reach anything outside localhost (a stray real request is aborted, not sent),
//   - talks to a fake chain that the test can change (`chain`),
//   - fails the test if the page throws an uncaught error.
import { expect, test as base } from "@playwright/test";
import { emptyChain, mockChain, type ChainFixture } from "./rpc";

type Fixtures = {
  chain: ChainFixture;
};

export const test = base.extend<Fixtures>({
  // The callback is called `provide`, not Playwright's usual `use`, which the React hooks lint rule mistakes for a hook.
  chain: async ({}, provide) => {
    await provide(emptyChain());
  },

  page: async ({ page, chain }, provide) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    // Registered first, so every more specific route added later takes priority over it.
    await page.route(
      (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
      (route) => route.abort("blockedbyclient"),
    );
    await mockChain(page, chain);

    await provide(page);
    expect(uncaught, "uncaught errors in the page").toEqual([]);
  },
});

export { expect };
