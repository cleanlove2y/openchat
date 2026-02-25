import { expect, test } from "@playwright/test";

test.describe("i18n metadata assets", () => {
  test("does not redirect locale-prefixed opengraph image requests", async ({
    request,
    baseURL,
  }) => {
    const response = await request.get("/en/opengraph-image.png", {
      maxRedirects: 0,
    });

    expect([301, 302, 307, 308]).not.toContain(response.status());
    expect(response.headers().location).toBeUndefined();
    expect(response.url()).toBe(`${baseURL}/en/opengraph-image.png`);
  });
});
