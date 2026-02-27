"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import { getSlashCommandKeyAction } from "./slash-command-keydown";

export type SlashCommandType = "skill" | "other";

export interface SlashCommandItem {
  id: string;
  title: string;
  description: string;
  type: SlashCommandType;
}

interface SlashCommandHookReturn {
  isOpen: boolean;
  query: string;
  commands: SlashCommandItem[];
  filteredCommands: SlashCommandItem[];
  selectedIndex: number;
  isLoading: boolean;
  handleKeyDown: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    input: string,
    setInput: (v: string) => void,
    onCommandSelect?: (cmd: SlashCommandItem) => void
  ) => void;
  handleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSelectCommand: (
    command: SlashCommandItem,
    input: string,
    setInput: (v: string) => void,
    onCommandSelect?: (cmd: SlashCommandItem) => void
  ) => void;
  closeMenu: () => void;
  setSelectedIndex: (index: number) => void;
}

export function useSlashCommand(): SlashCommandHookReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Fetch only when the menu is open to save unnecessary requests
  const { data, isLoading } = useSWR<{ commands: SlashCommandItem[] }>(
    isOpen ? "/api/skills" : null,
    fetcher,
    {
      revalidateOnFocus: false, // Don't refetch just by focusing window
      dedupingInterval: 60_000, // Cache for a minute
    }
  );

  const commands = data?.commands || [];

  // Basic filtering based on the query
  const filteredCommands = commands.filter(
    (cmd) =>
      cmd.title.toLowerCase().includes(query.toLowerCase()) ||
      cmd.description.toLowerCase().includes(query.toLowerCase())
  );

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setSlashIndex(-1);
    setSelectedIndex(0);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const cursorPosition = e.target.selectionStart;

      // Check if there is a '/' before the cursor and it's either at the start of string or preceded by space/\n
      const textBeforeCursor = value.substring(0, cursorPosition);
      const lastSlashIndex = textBeforeCursor.lastIndexOf("/");

      if (lastSlashIndex !== -1) {
        // Check character before slash
        const charBeforeSlash =
          lastSlashIndex > 0 ? textBeforeCursor[lastSlashIndex - 1] : " ";
        if (
          charBeforeSlash === " " ||
          charBeforeSlash === "\n" ||
          lastSlashIndex === 0
        ) {
          // Extract the potential query
          const potentialQuery = textBeforeCursor.substring(lastSlashIndex + 1);

          // If the query contains space or newline, it means slash command is broken/completed
          if (!potentialQuery.includes(" ") && !potentialQuery.includes("\n")) {
            setIsOpen(true);
            setSlashIndex(lastSlashIndex);
            setQuery(potentialQuery);
            setSelectedIndex(0); // Reset selection on typing
            return;
          }
        }
      }

      // If we didn't return above, ensuring the menu is closed
      if (isOpen) {
        closeMenu();
      }
    },
    [isOpen, closeMenu]
  );

  const handleSelectCommand = useCallback(
    (
      command: SlashCommandItem,
      input: string,
      setInput: (v: string) => void,
      onCommandSelect?: (cmd: SlashCommandItem) => void
    ) => {
      if (slashIndex === -1) {
        return;
      }

      // Replace the `/{query}` part with the command execution syntax
      const textBeforeSlash = input.substring(0, slashIndex);
      // We want to replace from slash to the cursor where query ends
      const endOfQuery = slashIndex + 1 + query.length;
      const textAfterQuery = input.substring(endOfQuery);

      if (onCommandSelect) {
        onCommandSelect(command);
        setInput(textBeforeSlash + textAfterQuery);
      } else {
        const insertText = `@${command.id} `;
        const newValue = textBeforeSlash + insertText + textAfterQuery;
        setInput(newValue);
      }
      closeMenu();
    },
    [slashIndex, query, closeMenu]
  );

  const handleKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLTextAreaElement>,
      input: string,
      setInput: (v: string) => void,
      onCommandSelect?: (cmd: SlashCommandItem) => void
    ) => {
      const keyAction = getSlashCommandKeyAction({
        isOpen,
        key: e.key,
        filteredCount: filteredCommands.length,
        slashIndex,
        selectionStart: e.currentTarget.selectionStart,
      });

      if (keyAction.preventDefault) {
        e.preventDefault();
      }

      if (keyAction.action === "close") {
        closeMenu();
        return;
      }

      if (keyAction.action === "move-down") {
        setSelectedIndex(
          (prev) => (prev + 1) % Math.max(1, filteredCommands.length)
        );
        return;
      }

      if (keyAction.action === "move-up") {
        setSelectedIndex(
          (prev) =>
            (prev - 1 + filteredCommands.length) %
            Math.max(1, filteredCommands.length)
        );
        return;
      }

      if (keyAction.action === "select" && filteredCommands.length > 0) {
        handleSelectCommand(
          filteredCommands[selectedIndex],
          input,
          setInput,
          onCommandSelect
        );
        return;
      }
    },
    [
      isOpen,
      closeMenu,
      selectedIndex,
      filteredCommands,
      handleSelectCommand,
      slashIndex,
    ]
  );

  return {
    isOpen,
    query,
    commands,
    filteredCommands,
    selectedIndex,
    isLoading,
    handleKeyDown,
    handleChange,
    handleSelectCommand,
    closeMenu,
    setSelectedIndex,
  };
}
