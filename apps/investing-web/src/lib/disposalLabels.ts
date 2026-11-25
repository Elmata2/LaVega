import {
  validateDisposalLabels,
  type DisposalLabelCategory,
  type DisposalLabelEntry,
} from "@lavega/core";

export async function fetchDisposalLabels(): Promise<DisposalLabelEntry[]> {
  try {
    const response = await fetch("/api/investing/disposal-labels");
    if (!response.ok) return [];
    const body = (await response.json()) as { entries?: unknown };
    return validateDisposalLabels(body.entries);
  } catch {
    return [];
  }
}

export async function saveDisposalLabels(
  entries: readonly DisposalLabelEntry[],
): Promise<boolean> {
  try {
    const response = await fetch("/api/investing/disposal-labels", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function withDisposalLabel(
  entries: readonly DisposalLabelEntry[],
  disposalId: string,
  category: DisposalLabelCategory,
  note?: string,
  updatedAt?: string,
): DisposalLabelEntry[] {
  const rest = entries.filter((entry) => entry.disposalId !== disposalId);
  const trimmedNote = note?.trim() ?? "";
  return [
    ...rest,
    {
      disposalId,
      category,
      ...(trimmedNote ? { note: trimmedNote } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    },
  ];
}

export function withoutDisposalLabel(
  entries: readonly DisposalLabelEntry[],
  disposalId: string,
): DisposalLabelEntry[] {
  return entries.filter((entry) => entry.disposalId !== disposalId);
}
