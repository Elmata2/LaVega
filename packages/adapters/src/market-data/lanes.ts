export type FxRequest = { from: string; to: string; date?: string };
export type FxProviderResult = { rate: number; problems: string[] };
export type IdentifierRequest = { isin: string };
export type IdentifierMatch = { isin: string; ticker: string; exchange?: string; name?: string };
export type IdentifierProviderResult = { match: IdentifierMatch; problems: string[] };
