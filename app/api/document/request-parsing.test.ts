import assert from "node:assert/strict";
import test from "node:test";
import { parseDocumentPostRequest } from "./request-parsing";

test("parseDocumentPostRequest prefers id from query string", async () => {
  const request = new Request("http://localhost/api/document?id=query-id", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "body-id",
      title: "title",
      content: "content",
      kind: "text",
    }),
  });

  const parsed = await parseDocumentPostRequest(request);

  assert.equal(parsed.id, "query-id");
});

test("parseDocumentPostRequest rejects body id when query id is missing", async () => {
  const request = new Request("http://localhost/api/document", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "body-only-id",
      title: "title",
      content: "content",
      kind: "text",
    }),
  });

  await assert.rejects(() => parseDocumentPostRequest(request));
});
