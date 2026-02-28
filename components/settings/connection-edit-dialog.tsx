"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppTranslation } from "@/lib/i18n/hooks";
import {
  guessProviderFromUrl,
  PROVIDER_TEMPLATES,
  type ProviderTemplateId,
} from "@/lib/user-llm";

export type Connection = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  defaultModel: string | null;
  defaultTemperature: string | null;
  enabled: boolean;
  isDefault: boolean;
  hasApiKey: boolean;
  lastValidatedAt: string | null;
  lastValidationError: string | null;
  lastUsedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type ConnectionEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection?: Connection | null;
  onSave: () => void;
};

type ModelsResponse = {
  models?: Array<{ id: string }>;
  cause?: string;
  message?: string;
};

function parseApiError(
  payload: { cause?: string; message?: string } | null
): string {
  return payload?.cause || payload?.message || "Request failed";
}

export function ConnectionEditDialog({
  open,
  onOpenChange,
  connection,
  onSave,
}: ConnectionEditDialogProps) {
  const { t } = useAppTranslation("settings");
  const isEditing = Boolean(connection);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<ProviderTemplateId>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [enabled, setEnabled] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (connection) {
      setName(connection.name);
      setProvider(guessProviderFromUrl(connection.baseUrl));
      setBaseUrl(connection.baseUrl);
      setApiKey("");
      setModel(connection.defaultModel ?? "");
      setTemperature(connection.defaultTemperature ?? "0.7");
      setEnabled(connection.enabled);
      setIsDefault(connection.isDefault);
    } else {
      const template = PROVIDER_TEMPLATES.openai;
      setName(template.name);
      setProvider("openai");
      setBaseUrl(template.baseUrl);
      setApiKey("");
      setModel(template.defaultModel);
      setTemperature("0.7");
      setEnabled(true);
      setIsDefault(false);
    }

    setAvailableModels([]);
  }, [connection, open]);

  const providerOptions = useMemo(
    () =>
      Object.entries(PROVIDER_TEMPLATES) as [
        ProviderTemplateId,
        (typeof PROVIDER_TEMPLATES)[ProviderTemplateId],
      ][],
    []
  );

  const handleProviderChange = (value: string) => {
    const nextProvider = value as ProviderTemplateId;
    const template = PROVIDER_TEMPLATES[nextProvider];

    setProvider(nextProvider);

    if (!isEditing || baseUrl.length === 0) {
      setBaseUrl(template.baseUrl);
    }

    if (!isEditing) {
      setName(template.name);
      setModel(template.defaultModel);
    }
  };

  const handleFetchModels = async () => {
    if (!connection) {
      toast.info(t("connection.fetchAfterSave"));
      return;
    }

    setIsFetchingModels(true);

    try {
      const response = await fetch(
        `/api/user-llm/connections/${connection.id}/models`,
        {
          cache: "no-store",
        }
      );
      const payload = (await response
        .json()
        .catch(() => null)) as ModelsResponse | null;

      if (!response.ok) {
        throw new Error(parseApiError(payload));
      }

      const modelIds = Array.isArray(payload?.models)
        ? payload.models
            .map((item) => item.id)
            .filter((value): value is string => Boolean(value))
        : [];

      setAvailableModels(modelIds);

      if (!model && modelIds.length > 0) {
        setModel(modelIds[0]);
      }

      toast.success(
        t("connection.toast.modelsFetched", { count: modelIds.length })
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("connection.toast.saveError")
      );
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || !baseUrl.trim()) {
      toast.error(t("connection.toast.requiredFields"));
      return;
    }

    if (!isEditing && !apiKey.trim()) {
      toast.error(t("connection.toast.apiKeyRequired"));
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(
        connection
          ? `/api/user-llm/connections/${connection.id}`
          : "/api/user-llm/connections",
        {
          method: connection ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: name.trim(),
            provider,
            baseUrl: baseUrl.trim(),
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            defaultModel: model.trim() || null,
            defaultTemperature: temperature.trim() || null,
            enabled,
            isDefault,
            validate: true,
          }),
        }
      );

      const payload = (await response.json().catch(() => null)) as {
        cause?: string;
        message?: string;
      } | null;

      if (!response.ok) {
        throw new Error(parseApiError(payload));
      }

      toast.success(t("connection.toast.saved"));
      onSave();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("connection.toast.saveError")
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t("connection.editTitle") : t("connection.addTitle")}
          </DialogTitle>
          <DialogDescription>{t("connection.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="connection-provider">
              {t("connection.fields.provider")}
            </Label>
            <Select onValueChange={handleProviderChange} value={provider}>
              <SelectTrigger id="connection-provider">
                <SelectValue placeholder={t("connection.fields.provider")} />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map(([providerKey, template]) => (
                  <SelectItem key={providerKey} value={providerKey}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
            <div className="grid gap-2">
              <Label htmlFor="connection-name">
                {t("connection.fields.name")}
              </Label>
              <Input
                id="connection-name"
                onChange={(event) => setName(event.target.value)}
                placeholder={t("connection.placeholders.name")}
                value={name}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="connection-temperature">
                {t("connection.fields.temperature")}
              </Label>
              <Input
                id="connection-temperature"
                onChange={(event) => setTemperature(event.target.value)}
                placeholder="0.7"
                value={temperature}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="connection-base-url">
              {t("connection.fields.baseUrl")}
            </Label>
            <Input
              id="connection-base-url"
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              value={baseUrl}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="connection-api-key">
              {t("connection.fields.apiKey")}
            </Label>
            <Input
              id="connection-api-key"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                isEditing && connection?.hasApiKey
                  ? t("connection.placeholders.keepExistingKey")
                  : "sk-..."
              }
              type="password"
              value={apiKey}
            />
            {isEditing && connection?.hasApiKey && !apiKey && (
              <p className="text-xs text-muted-foreground">
                {t("connection.keepExistingKeyHint")}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="connection-model">
                {t("connection.fields.defaultModel")}
              </Label>
              {isEditing && (
                <Button
                  className="h-7 px-2 text-xs"
                  disabled={isFetchingModels}
                  onClick={handleFetchModels}
                  type="button"
                  variant="ghost"
                >
                  {isFetchingModels ? (
                    <Loader2 className="mr-1 size-3 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 size-3" />
                  )}
                  {t("connection.fetchModels")}
                </Button>
              )}
            </div>
            <Input
              id="connection-model"
              list="connection-model-options"
              onChange={(event) => setModel(event.target.value)}
              placeholder={t("connection.placeholders.model")}
              value={model}
            />
            <datalist id="connection-model-options">
              {availableModels.map((modelId) => (
                <option key={modelId} value={modelId} />
              ))}
            </datalist>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                checked={enabled}
                className="size-4 accent-foreground"
                onChange={(event) => setEnabled(event.target.checked)}
                type="checkbox"
              />
              {t("connection.fields.enabled")}
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                checked={isDefault}
                className="size-4 accent-foreground"
                onChange={(event) => setIsDefault(event.target.checked)}
                type="checkbox"
              />
              {t("connection.fields.isDefault")}
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            {t("actions.cancel")}
          </Button>
          <Button disabled={isSaving} onClick={handleSubmit} type="button">
            {isSaving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {t("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
