"use client";

import equal from "fast-deep-equal";
import {
  type MouseEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import useSWR from "swr";
import { useArtifact } from "@/hooks/use-artifact";
import type { Document } from "@/lib/db/schema";
import { cn, fetcher } from "@/lib/utils";
import type { ArtifactKind, UIArtifact } from "./artifact";
import { CodeEditor } from "./code-editor";
import { DocumentToolCall, DocumentToolResult } from "./document";
import { InlineDocumentSkeleton } from "./document-skeleton";
import { FileIcon, FullscreenIcon, ImageIcon, LoaderIcon } from "./icons";
import { ImageEditor } from "./image-editor";
import { SpreadsheetEditor } from "./sheet-editor";
import { Editor } from "./text-editor";

type DocumentPreviewProps = {
  isReadonly: boolean;
  result?: any;
  args?: any;
};

export function DocumentPreview({
  isReadonly,
  result,
  args,
}: DocumentPreviewProps) {
  const { artifact, setArtifact } = useArtifact();

  const { data: documents, isLoading: isDocumentsFetching } = useSWR<
    Document[]
  >(result ? `/api/document?id=${result.id}` : null, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const previewDocument = useMemo(() => documents?.at(-1), [documents]);
  const hitboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const boundingBox = hitboxRef.current?.getBoundingClientRect();

    if (artifact.documentId && boundingBox) {
      setArtifact((currentArtifact) => ({
        ...currentArtifact,
        boundingBox: {
          left: boundingBox.x,
          top: boundingBox.y,
          width: boundingBox.width,
          height: boundingBox.height,
        },
      }));
    }
  }, [artifact.documentId, setArtifact]);

  if (artifact.isVisible) {
    if (result) {
      return (
        <DocumentToolResult
          isReadonly={isReadonly}
          result={{ id: result.id, title: result.title, kind: result.kind }}
          type="create"
        />
      );
    }

    if (args) {
      return (
        <DocumentToolCall
          args={{ title: args.title, kind: args.kind }}
          isReadonly={isReadonly}
          type="create"
        />
      );
    }
  }

  if (isDocumentsFetching) {
    return <LoadingSkeleton artifactKind={result.kind ?? args.kind} />;
  }

  const document: Document | null = previewDocument
    ? previewDocument
    : artifact.status === "streaming"
      ? {
          title: artifact.title,
          kind: artifact.kind,
          content: artifact.content,
          id: artifact.documentId,
          createdAt: new Date(),
          userId: "noop",
        }
      : null;

  if (!document) {
    return <LoadingSkeleton artifactKind={artifact.kind} />;
  }

  return (
    <div className="group relative w-full max-w-full md:max-w-[800px] cursor-pointer transition-all duration-300 hover:scale-[1.005]">
      <div className="absolute -inset-0.5 rounded-2xl bg-linear-to-r from-zinc-200 to-zinc-100 opacity-20 blur-sm transition duration-1000 group-hover:opacity-40 group-hover:duration-200 dark:from-zinc-800 dark:to-zinc-900" />
      <div className="relative flex flex-col overflow-hidden rounded-2xl border border-zinc-200 shadow-xl transition-shadow duration-300 group-hover:shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <HitboxLayer
          hitboxRef={hitboxRef}
          result={result}
          setArtifact={setArtifact}
        />
        <DocumentHeader
          isStreaming={artifact.status === "streaming"}
          kind={document.kind}
          title={document.title}
        />
        <DocumentContent document={document} />
      </div>
    </div>
  );
}

const LoadingSkeleton = ({ artifactKind }: { artifactKind: ArtifactKind }) => (
  <div className="w-full max-w-full md:max-w-[800px] overflow-hidden rounded-2xl border border-zinc-200 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
    <div className="flex h-[57px] flex-row items-center justify-between gap-2 border-b p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex flex-row items-center gap-3">
        <div className="text-muted-foreground/50">
          <div className="size-4 animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <div className="h-4 w-24 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div>
        <FullscreenIcon className="opacity-20" />
      </div>
    </div>
    {artifactKind === "image" ? (
      <div className="bg-zinc-50 dark:bg-zinc-950">
        <div className="h-[257px] w-full animate-pulse bg-zinc-100 dark:bg-zinc-900" />
      </div>
    ) : (
      <div className="bg-zinc-50 p-8 pt-4 dark:bg-zinc-950">
        <InlineDocumentSkeleton />
      </div>
    )}
  </div>
);

const PureHitboxLayer = ({
  hitboxRef,
  result,
  setArtifact,
}: {
  hitboxRef: React.RefObject<HTMLDivElement>;
  result: any;
  setArtifact: (
    updaterFn: UIArtifact | ((currentArtifact: UIArtifact) => UIArtifact)
  ) => void;
}) => {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const boundingBox = event.currentTarget.getBoundingClientRect();

      setArtifact((artifact) =>
        artifact.status === "streaming"
          ? { ...artifact, isVisible: true }
          : {
              ...artifact,
              title: result.title,
              documentId: result.id,
              kind: result.kind,
              isVisible: true,
              boundingBox: {
                left: boundingBox.x,
                top: boundingBox.y,
                width: boundingBox.width,
                height: boundingBox.height,
              },
            }
      );
    },
    [setArtifact, result]
  );

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-20"
      onClick={handleClick}
      ref={hitboxRef}
      role="presentation"
    >
      <div className="flex w-full items-center justify-end p-3 px-4">
        <div className="rounded-full bg-zinc-100/50 p-2 text-zinc-500 backdrop-blur-sm transition-colors hover:bg-zinc-200/80 dark:bg-zinc-800/50 dark:text-zinc-400 dark:hover:bg-zinc-700/80">
          <FullscreenIcon />
        </div>
      </div>
    </div>
  );
};

const HitboxLayer = memo(PureHitboxLayer, (prevProps, nextProps) => {
  if (!equal(prevProps.result, nextProps.result)) {
    return false;
  }
  return true;
});

const PureDocumentHeader = ({
  title,
  kind,
  isStreaming,
}: {
  title: string;
  kind: ArtifactKind;
  isStreaming: boolean;
}) => (
  <div className="flex flex-row items-center justify-between gap-4 border-b bg-zinc-50/80 p-4 backdrop-blur-sm sm:px-5 dark:border-zinc-800 dark:bg-zinc-900/80">
    <div className="flex flex-row items-center gap-3 overflow-hidden min-w-0 text-sm font-medium">
      <div className="flex size-6 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-xs dark:bg-zinc-800 dark:ring-1 dark:ring-zinc-700">
        {isStreaming ? (
          <div className="animate-spin text-zinc-500 dark:text-zinc-400">
            <LoaderIcon />
          </div>
        ) : kind === "image" ? (
          <div className="text-blue-500 dark:text-blue-400">
            <ImageIcon />
          </div>
        ) : (
          <div className="text-zinc-600 dark:text-zinc-300">
            <FileIcon />
          </div>
        )}
      </div>
      <div className="truncate text-zinc-900 dark:text-zinc-100">{title}</div>
    </div>
    <div className="w-8 shrink-0" />
  </div>
);

const DocumentHeader = memo(PureDocumentHeader, (prevProps, nextProps) => {
  if (prevProps.title !== nextProps.title) {
    return false;
  }
  if (prevProps.isStreaming !== nextProps.isStreaming) {
    return false;
  }

  return true;
});

const DocumentContent = ({ document }: { document: Document }) => {
  const { artifact } = useArtifact();

  const containerClassName = cn(
    "relative h-[320px] overflow-hidden bg-white dark:bg-zinc-950",
    {
      "p-0": document.kind === "code" || document.kind === "sheet",
    }
  );

  const commonProps = {
    content: document.content ?? "",
    isCurrentVersion: true,
    currentVersionIndex: 0,
    status: artifact.status,
    saveContent: () => null,
    suggestions: [],
  };

  const handleSaveContent = () => null;

  return (
    <div className={containerClassName}>
      <div className="h-full overflow-hidden">
        <div
          className={cn({
            "p-6 sm:px-10 sm:py-12": document.kind === "text",
          })}
        >
          {document.kind === "text" ? (
            <Editor {...commonProps} onSaveContent={handleSaveContent} />
          ) : document.kind === "code" ? (
            <div className="relative flex w-full flex-1 min-h-[320px]">
              <div className="absolute inset-0">
                <CodeEditor
                  {...commonProps}
                  onSaveContent={handleSaveContent}
                />
              </div>
            </div>
          ) : document.kind === "sheet" ? (
            <div className="relative flex size-full min-h-[320px] p-4">
              <div className="absolute inset-0">
                <SpreadsheetEditor {...commonProps} />
              </div>
            </div>
          ) : document.kind === "image" ? (
            <ImageEditor
              content={document.content ?? ""}
              currentVersionIndex={0}
              isCurrentVersion={true}
              isInline={true}
              status={artifact.status}
              title={document.title}
            />
          ) : null}
        </div>
      </div>
      {document.kind === "text" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-white to-transparent dark:from-zinc-950" />
      )}
    </div>
  );
};
