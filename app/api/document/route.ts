import {
  type AuthenticatedSession,
  createAuthedApiRoute,
} from "@/app/api/_shared/authed-route";
import {
  deleteDocumentsByIdAfterTimestamp,
  getDocumentsById,
  saveDocument,
} from "@/lib/db/queries";
import { OpenChatError } from "@/lib/errors";
import {
  type DocumentDeleteInput,
  type DocumentIdQueryInput,
  type DocumentPostInput,
  parseDocumentDeleteRequest,
  parseDocumentIdRequest,
  parseDocumentPostRequest,
} from "./request-parsing";

const getHandler = async ({
  session,
  input,
}: {
  session: AuthenticatedSession;
  input: DocumentIdQueryInput;
}) => {
  const { id } = input;

  const documents = await getDocumentsById({ id });

  const [document] = documents;

  if (!document) {
    return new OpenChatError("not_found:document").toResponse();
  }

  if (document.userId !== session.user.id) {
    return new OpenChatError("forbidden:document").toResponse();
  }

  return Response.json(documents, { status: 200 });
};

const postHandler = async ({
  session,
  input,
}: {
  session: AuthenticatedSession;
  input: DocumentPostInput;
}) => {
  const { id, content, title, kind } = input;

  const documents = await getDocumentsById({ id });

  if (documents.length > 0) {
    const [doc] = documents;

    if (doc.userId !== session.user.id) {
      return new OpenChatError("forbidden:document").toResponse();
    }
  }

  const document = await saveDocument({
    id,
    content,
    title,
    kind,
    userId: session.user.id,
  });

  return Response.json(document, { status: 200 });
};

const deleteHandler = async ({
  session,
  input,
}: {
  session: AuthenticatedSession;
  input: DocumentDeleteInput;
}) => {
  const { id, timestamp } = input;

  const documents = await getDocumentsById({ id });

  const [document] = documents;

  if (document.userId !== session.user.id) {
    return new OpenChatError("forbidden:document").toResponse();
  }

  const documentsDeleted = await deleteDocumentsByIdAfterTimestamp({
    id,
    timestamp: new Date(timestamp),
  });

  return Response.json(documentsDeleted, { status: 200 });
};

export const GET = createAuthedApiRoute<DocumentIdQueryInput>({
  route: "/api/document",
  method: "GET",
  unauthorizedErrorCode: "unauthorized:document",
  badRequestErrorCode: "bad_request:api",
  parseRequest: parseDocumentIdRequest,
  handler: getHandler,
});

export const POST = createAuthedApiRoute<DocumentPostInput>({
  route: "/api/document",
  method: "POST",
  unauthorizedErrorCode: "not_found:document",
  badRequestErrorCode: "bad_request:api",
  parseRequest: parseDocumentPostRequest,
  audit: {
    action: "document.save",
    resourceType: "document",
    getResourceId: (requestForAudit) =>
      new URL(requestForAudit.url).searchParams.get("id") ?? undefined,
    getMetadata: async (requestForAudit) => {
      try {
        const body = (await requestForAudit.json()) as {
          kind?: unknown;
          title?: unknown;
        };

        return {
          kind: typeof body.kind === "string" ? body.kind : null,
          title:
            typeof body.title === "string"
              ? { length: body.title.length }
              : null,
        };
      } catch (_) {
        return undefined;
      }
    },
  },
  handler: postHandler,
});

export const DELETE = createAuthedApiRoute<DocumentDeleteInput>({
  route: "/api/document",
  method: "DELETE",
  unauthorizedErrorCode: "unauthorized:document",
  badRequestErrorCode: "bad_request:api",
  parseRequest: parseDocumentDeleteRequest,
  audit: {
    action: "document.delete_after",
    resourceType: "document",
    getResourceId: (requestForAudit) =>
      new URL(requestForAudit.url).searchParams.get("id") ?? undefined,
    getMetadata: (requestForAudit) => {
      const searchParams = new URL(requestForAudit.url).searchParams;
      return {
        timestamp: searchParams.get("timestamp"),
      };
    },
  },
  handler: deleteHandler,
});
