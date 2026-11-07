import { Cursor, type ModelSelection, type SDKModel } from "@cursor/sdk";
import type { PinnedModel } from "./types.js";

function prefersFastFalse(model: SDKModel): PinnedModel {
  const fast = model.parameters?.find((parameter) => parameter.id === "fast");
  const off = fast?.values.find((value) => value.value === "false");
  if (fast && off) {
    return { id: model.id, params: [{ id: fast.id, value: off.value }] };
  }
  return { id: model.id };
}

export function selectionFrom(model: PinnedModel): ModelSelection {
  return { id: model.id, params: model.params };
}

export async function pinModel(requested?: string): Promise<PinnedModel> {
  const models = await Cursor.models.list();
  if (models.length === 0) {
    throw new Error("Cursor.models.list() returned no models");
  }
  const wanted = requested || "composer-2.5";
  const match = models.find((model) => model.id === wanted || model.aliases?.includes(wanted));
  if (!match) {
    const ids = models.map((model) => model.id).join(", ");
    throw new Error(`Model ${wanted} is not in Cursor.models.list(). Catalog: ${ids}`);
  }
  if (match.id !== wanted && !requested) {
    throw new Error(`Refusing alias ${wanted}; catalog id is ${match.id}`);
  }
  return prefersFastFalse(match);
}
