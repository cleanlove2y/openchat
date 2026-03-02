"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useEffect, useRef } from "react";
import { useDataStream } from "@/components/data-stream-provider";
import type { ChatMessage } from "@/lib/types";

export type UseAutoResumeParams = {
  autoResume: boolean;
  initialMessages: ChatMessage[];
  resumeStream: UseChatHelpers<ChatMessage>["resumeStream"];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  onResumeStart?: () => void;
  onResumeFinish?: () => void;
};

export function shouldResumeExistingStream({
  autoResume,
  initialMessages,
}: Pick<UseAutoResumeParams, "autoResume" | "initialMessages">) {
  return autoResume && initialMessages.at(-1)?.role === "user";
}

export function getAutoResumeAttemptKey(initialMessages: ChatMessage[]) {
  const lastMessage = initialMessages.at(-1);

  if (!lastMessage || lastMessage.role !== "user") {
    return null;
  }

  return `${lastMessage.id}:${lastMessage.role}`;
}

export function useAutoResume({
  autoResume,
  initialMessages,
  resumeStream,
  setMessages,
  onResumeStart,
  onResumeFinish,
}: UseAutoResumeParams) {
  const { dataStream } = useDataStream();
  const lastResumeAttemptKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldResumeExistingStream({ autoResume, initialMessages })) {
      return;
    }

    const resumeAttemptKey = getAutoResumeAttemptKey(initialMessages);

    if (!resumeAttemptKey) {
      return;
    }

    if (lastResumeAttemptKeyRef.current === resumeAttemptKey) {
      return;
    }

    lastResumeAttemptKeyRef.current = resumeAttemptKey;

    let cancelled = false;

    const resume = async () => {
      onResumeStart?.();

      try {
        await resumeStream();
      } finally {
        if (!cancelled) {
          onResumeFinish?.();
        }
      }
    };

    void resume();

    return () => {
      cancelled = true;
    };
  }, [autoResume, initialMessages, onResumeFinish, onResumeStart, resumeStream]);

  useEffect(() => {
    if (!dataStream) {
      return;
    }
    if (dataStream.length === 0) {
      return;
    }

    const dataPart = dataStream[0];

    if (dataPart.type === "data-appendMessage") {
      const message = JSON.parse(dataPart.data);
      setMessages([...initialMessages, message]);
    }
  }, [dataStream, initialMessages, setMessages]);
}
