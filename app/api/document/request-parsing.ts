import { z } from "zod";

export const documentIdQuerySchema = z.object({
  id: z.string().min(1),
});

export const documentPostInputSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
  title: z.string(),
  kind: z.enum(["text", "code", "image", "sheet"]),
});

export const documentDeleteInputSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
});

export type DocumentIdQueryInput = z.infer<typeof documentIdQuerySchema>;
export type DocumentPostInput = z.infer<typeof documentPostInputSchema>;
export type DocumentDeleteInput = z.infer<typeof documentDeleteInputSchema>;

export function parseDocumentIdRequest(request: Request): DocumentIdQueryInput {
  const searchParams = new URL(request.url).searchParams;
  return documentIdQuerySchema.parse({
    id: searchParams.get("id"),
  });
}

export async function parseDocumentPostRequest(
  request: Request
): Promise<DocumentPostInput> {
  const searchParams = new URL(request.url).searchParams;
  const body = await request.json();
  const bodyObject =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  return documentPostInputSchema.parse({
    ...bodyObject,
    id: searchParams.get("id"),
  });
}

export function parseDocumentDeleteRequest(
  request: Request
): DocumentDeleteInput {
  const searchParams = new URL(request.url).searchParams;
  return documentDeleteInputSchema.parse({
    id: searchParams.get("id"),
    timestamp: searchParams.get("timestamp"),
  });
}
