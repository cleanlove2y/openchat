"use client";

import {
  AlertCircle,
  CheckCircle2,
  Globe,
  Loader2,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR, { mutate } from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAppTranslation } from "@/lib/i18n/hooks";
import { getProviderDisplayName } from "@/lib/user-llm";
import { cn } from "@/lib/utils";
import {
  type Connection,
  ConnectionEditDialog,
} from "./connection-edit-dialog";

type ConnectionsResponse = {
  connections: Connection[];
};

const connectionsKey = "/api/user-llm/connections";

async function fetchConnections(url: string): Promise<ConnectionsResponse> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as
    | ConnectionsResponse
    | { cause?: string; message?: string }
    | null;

  if (!response.ok) {
    const errorMessage =
      payload && "cause" in payload
        ? payload.cause || payload.message
        : payload && "message" in payload
          ? payload.message
          : "Failed to load connections";
    throw new Error(errorMessage);
  }

  return payload as ConnectionsResponse;
}

export function ConnectionsManagementCard() {
  const { t } = useAppTranslation("settings");
  const { data, error, isLoading } = useSWR(connectionsKey, fetchConnections);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedConnection, setSelectedConnection] =
    useState<Connection | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingDefaultId, setSavingDefaultId] = useState<string | null>(null);

  const connections = data?.connections ?? [];

  const refresh = async () => {
    await mutate(connectionsKey);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);

    try {
      const response = await fetch(`/api/user-llm/connections/${id}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as {
        cause?: string;
        message?: string;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.cause || payload?.message || "Delete failed");
      }

      toast.success(t("connection.toast.deleted"));
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("connection.toast.deleteError")
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetDefault = async (connection: Connection) => {
    if (connection.isDefault) {
      return;
    }

    setSavingDefaultId(connection.id);

    try {
      const response = await fetch(
        `/api/user-llm/connections/${connection.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ isDefault: true, validate: false }),
        }
      );
      const payload = (await response.json().catch(() => null)) as {
        cause?: string;
        message?: string;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.cause || payload?.message || "Update failed");
      }

      toast.success(t("connection.toast.defaultUpdated"));
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("connection.toast.defaultError")
      );
    } finally {
      setSavingDefaultId(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div className="space-y-1">
            <CardTitle>{t("connection.title")}</CardTitle>
            <CardDescription>{t("connection.subtitle")}</CardDescription>
          </div>
          <Button
            className="w-full gap-2 sm:w-auto"
            onClick={() => {
              setSelectedConnection(null);
              setDialogOpen(true);
            }}
            type="button"
          >
            <Plus className="size-4" />
            {t("connection.add")}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {error.message}
            </div>
          ) : connections.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center text-sm text-muted-foreground">
              <Globe className="size-8 opacity-70" />
              <p>{t("connection.empty")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {connections.map((connection) => (
                <div
                  className={cn(
                    "rounded-xl border p-4 transition-colors",
                    connection.isDefault && "border-primary/40 bg-primary/5"
                  )}
                  key={connection.id}
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm md:text-base">
                          {connection.name}
                        </span>
                        {connection.isDefault && (
                          <Badge variant="secondary">
                            {t("connection.badges.default")}
                          </Badge>
                        )}
                        {connection.enabled ? (
                          <Badge variant="outline">
                            {t("connection.badges.enabled")}
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            {t("connection.badges.disabled")}
                          </Badge>
                        )}
                        {connection.lastValidationError ? (
                          <AlertCircle className="size-4 text-destructive" />
                        ) : (
                          <CheckCircle2 className="size-4 text-green-600" />
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:text-sm">
                        <span>
                          {getProviderDisplayName(connection.provider)}
                        </span>
                        <span>•</span>
                        <span className="max-w-[220px] truncate">
                          {connection.baseUrl}
                        </span>
                        <span>•</span>
                        <span>
                          {connection.defaultModel ||
                            t("connection.noDefaultModel")}
                        </span>
                      </div>

                      {connection.lastValidationError && (
                        <p className="text-xs text-destructive md:text-sm">
                          {connection.lastValidationError}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-1">
                      <Button
                        disabled={
                          connection.isDefault ||
                          savingDefaultId === connection.id
                        }
                        onClick={() => handleSetDefault(connection)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        {savingDefaultId === connection.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Star
                            className={cn(
                              "size-4",
                              connection.isDefault &&
                                "fill-current text-yellow-500"
                            )}
                          />
                        )}
                      </Button>
                      <Button
                        onClick={() => {
                          setSelectedConnection(connection);
                          setDialogOpen(true);
                        }}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        className="text-destructive hover:text-destructive"
                        disabled={deletingId === connection.id}
                        onClick={() => handleDelete(connection.id)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        {deletingId === connection.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConnectionEditDialog
        connection={selectedConnection}
        onOpenChange={setDialogOpen}
        onSave={refresh}
        open={dialogOpen}
      />
    </>
  );
}
