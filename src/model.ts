import { Cursor, type ModelSelection } from "@cursor/sdk";
import type { PinnedModel } from "./types.js";

/** Resolve a catalog id and turn fast mode off when the model has that switch. */
export async function pinModel(requested: string): Promise<PinnedModel> {
  const models = await Cursor.models.list();
  const match = models.find((model) => model.id === requested);
  if (!match) {
    throw new Error(`${requested} is not a catalog id. Catalog: ${models.map((model) => model.id).join(", ")}`);
  }
  const fast = match.parameters?.find((parameter) => parameter.id === "fast");
  const off = fast?.values.find((entry) => entry.value === "false");
  return fast && off ? { id: match.id, params: [{ id: fast.id, value: off.value }] } : { id: match.id };
}

export function selection(model: PinnedModel): ModelSelection {
  return { id: model.id, params: model.params };
}
