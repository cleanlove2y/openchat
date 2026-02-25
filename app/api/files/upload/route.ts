import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAuthedApiRoute } from "@/app/api/_shared/authed-route";

function getBlobFilename(file: Blob): string | null {
  const maybeName = (file as { name?: unknown }).name;
  return typeof maybeName === "string" ? maybeName : null;
}

// Use Blob instead of File since File is not available in Node.js environment
const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: "File size should be less than 5MB",
    })
    // Update the file type based on the kind of files you want to accept
    .refine((file) => ["image/jpeg", "image/png"].includes(file.type), {
      message: "File type should be JPEG or PNG",
    }),
});

const postHandler = async ({
  request,
}: {
  request: Request;
}) => {
  if (request.body === null) {
    return new Response("Request body is empty", { status: 400 });
  }

  try {
    const formData = await request.formData();
    const fileField = formData.get("file");

    if (!(fileField instanceof Blob)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const file = fileField;

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(", ");

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const filename = getBlobFilename(file) ?? "upload.bin";
    const fileBuffer = await file.arrayBuffer();

    try {
      const data = await put(`${filename}`, fileBuffer, {
        access: "public",
      });

      return NextResponse.json(data);
    } catch (_error) {
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
};

export const POST = createAuthedApiRoute({
    route: "/api/files/upload",
    method: "POST",
    unauthorizedResponse: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    audit: {
      action: "file.upload",
      resourceType: "blob",
      getMetadata: async (requestForAudit) => {
        try {
          const formData = await requestForAudit.formData();
          const file = formData.get("file");

          if (!(file instanceof Blob)) {
            return {
              filePresent: false,
            };
          }

          const filename = getBlobFilename(file);

          return {
            filePresent: true,
            filename:
              typeof filename === "string"
                ? {
                    length: filename.length,
                  }
                : null,
            size: file.size,
            mediaType: file.type,
          };
        } catch (_) {
          return undefined;
        }
      },
    },
    handler: postHandler,
  });

