/**
 * Read-only RecipeHub client. Writes stay on RecipeHub (no proxy).
 * Week 1: stub-friendly; callers may use later for pantry ingredient pickers.
 */
export type RecipeHubIngredient = {
  id: string;
  name: string;
  defaultUnit?: string;
};

export type RecipeHubRecipeSummary = {
  id: string;
  title: string;
  author?: string | null;
};

export interface RecipeHubClient {
  listIngredients(params?: { q?: string; take?: number }): Promise<RecipeHubIngredient[]>;
  listRecipes(params?: { take?: number }): Promise<RecipeHubRecipeSummary[]>;
  getRecipe(id: string): Promise<RecipeHubRecipeSummary | null>;
}

export class HttpRecipeHubClient implements RecipeHubClient {
  constructor(private readonly baseUrl: string) {}

  async listIngredients(params?: { q?: string; take?: number }): Promise<RecipeHubIngredient[]> {
    const url = new URL("/ingredients", this.baseUrl);
    if (params?.q) url.searchParams.set("q", params.q);
    if (params?.take) url.searchParams.set("take", String(params.take));
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`RecipeHub listIngredients failed: ${res.status}`);
    }
    const body = (await res.json()) as unknown;
    return normalizeList(body) as RecipeHubIngredient[];
  }

  async listRecipes(params?: { take?: number }): Promise<RecipeHubRecipeSummary[]> {
    const url = new URL("/recipes", this.baseUrl);
    if (params?.take) url.searchParams.set("take", String(params.take));
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`RecipeHub listRecipes failed: ${res.status}`);
    }
    const body = (await res.json()) as unknown;
    return normalizeList(body) as RecipeHubRecipeSummary[];
  }

  async getRecipe(id: string): Promise<RecipeHubRecipeSummary | null> {
    const res = await fetch(new URL(`/recipes/${id}`, this.baseUrl));
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`RecipeHub getRecipe failed: ${res.status}`);
    }
    return (await res.json()) as RecipeHubRecipeSummary;
  }
}

function normalizeList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)) {
    return (body as { items: unknown[] }).items;
  }
  return [];
}
