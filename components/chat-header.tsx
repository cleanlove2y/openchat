"use client";

import { memo } from "react";
import type { VisibilityType } from "./visibility-selector";

type ChatHeaderProps = {
  chatId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
};

function PureChatHeader({
  chatId: _chatId,
  selectedVisibilityType: _selectedVisibilityType,
  isReadonly: _isReadonly,
}: ChatHeaderProps) {
  return (
    <div className="flex items-center gap-2 bg-background px-2 py-1.5 md:px-2">
      {/* 功能按钮已按需移除以保持极致简洁的视觉效果 */}
    </div>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return (
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly
  );
});
