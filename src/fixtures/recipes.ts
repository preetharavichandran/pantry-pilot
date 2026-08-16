/** Shared CloudEvent fixtures shaped like RecipeHub starters (for seed + tests + Kafka E2E). */

export const FIXTURE_IDS = {
  oats: "11111111-1111-1111-1111-111111110001",
  milk: "11111111-1111-1111-1111-111111110002",
  banana: "11111111-1111-1111-1111-111111110003",
  egg: "11111111-1111-1111-1111-111111110004",
  bread: "11111111-1111-1111-1111-111111110005",
  butter: "11111111-1111-1111-1111-111111110006",
  rice: "11111111-1111-1111-1111-111111110009",
  lentils: "11111111-1111-1111-1111-11111111000a",
  onion: "11111111-1111-1111-1111-11111111000b",
  garlic: "11111111-1111-1111-1111-11111111000c",
  tomato: "11111111-1111-1111-1111-11111111000d",
  chicken: "11111111-1111-1111-1111-11111111000f",
  oil: "11111111-1111-1111-1111-111111110010",
  salt: "11111111-1111-1111-1111-111111110011",
  pepper: "11111111-1111-1111-1111-111111110012",
  pasta: "11111111-1111-1111-1111-111111110017",
  lemon: "11111111-1111-1111-1111-111111110019",
  oatmeal: "22222222-2222-2222-2222-222222220001",
  eggsToast: "22222222-2222-2222-2222-222222220002",
  dal: "22222222-2222-2222-2222-222222220004",
  pastaDinner: "22222222-2222-2222-2222-222222220005",
  chickenRice: "22222222-2222-2222-2222-222222220006",
} as const;

export type FixtureCloudEvent = {
  specversion: string;
  id: string;
  source: string;
  type: string;
  time: string;
  eventVersion: string;
  data: Record<string, unknown>;
};

export function recipeCreatedEvent(
  recipeId: string,
  title: string,
  slots: string[],
  ingredients: unknown[],
  eventId = `seed-${recipeId}`,
): FixtureCloudEvent {
  return {
    specversion: "1.0",
    id: eventId,
    source: "urn:lifeatlas:pantry-pilot:fixtures",
    type: "lifeatlas.recipe.created",
    time: new Date().toISOString(),
    eventVersion: "1.0",
    data: {
      recipeId,
      title,
      author: "RecipeHub",
      creatorId: null,
      mealSlots: slots,
      ingredients,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function starterProjectionEvents(eventIdPrefix = "seed"): FixtureCloudEvent[] {
  const { FIXTURE_IDS: id } = { FIXTURE_IDS };
  const eid = (recipeId: string) => `${eventIdPrefix}-${recipeId}`;
  return [
    recipeCreatedEvent(
      id.oatmeal,
      "Weekday oatmeal",
      ["breakfast"],
      [
        { ingredientId: id.oats, name: "Oats", quantity: 60, unit: "g" },
        { ingredientId: id.milk, name: "Milk", quantity: 250, unit: "ml" },
        { ingredientId: id.banana, name: "Banana", quantity: 1, unit: "pcs" },
      ],
      eid(id.oatmeal),
    ),
    recipeCreatedEvent(
      id.eggsToast,
      "Eggs on toast",
      ["breakfast"],
      [
        { ingredientId: id.egg, name: "Egg", quantity: 2, unit: "pcs" },
        { ingredientId: id.bread, name: "Bread", quantity: 2, unit: "pcs" },
        { ingredientId: id.butter, name: "Butter", quantity: 10, unit: "g" },
      ],
      eid(id.eggsToast),
    ),
    recipeCreatedEvent(
      id.pastaDinner,
      "Tomato garlic pasta",
      ["dinner"],
      [
        { ingredientId: id.pasta, name: "Pasta", quantity: 200, unit: "g" },
        { ingredientId: id.tomato, name: "Tomato", quantity: 3, unit: "pcs" },
        { ingredientId: id.garlic, name: "Garlic", quantity: 3, unit: "pcs" },
        { ingredientId: id.oil, name: "Olive oil", quantity: 20, unit: "ml" },
        { ingredientId: id.salt, name: "Salt", quantity: 3, unit: "g" },
        { ingredientId: id.pepper, name: "Black pepper", quantity: 1, unit: "g" },
      ],
      eid(id.pastaDinner),
    ),
    recipeCreatedEvent(
      id.chickenRice,
      "Chicken and rice bowl",
      ["dinner"],
      [
        { ingredientId: id.chicken, name: "Chicken", quantity: 300, unit: "g" },
        { ingredientId: id.rice, name: "Rice", quantity: 150, unit: "g" },
        { ingredientId: id.oil, name: "Olive oil", quantity: 15, unit: "ml" },
        { ingredientId: id.salt, name: "Salt", quantity: 3, unit: "g" },
        { ingredientId: id.lemon, name: "Lemon", quantity: 1, unit: "pcs" },
      ],
      eid(id.chickenRice),
    ),
    recipeCreatedEvent(
      id.dal,
      "Simple dal and rice",
      ["dinner"],
      [
        { ingredientId: id.lentils, name: "Lentils", quantity: 150, unit: "g" },
        { ingredientId: id.rice, name: "Rice", quantity: 150, unit: "g" },
        { ingredientId: id.onion, name: "Onion", quantity: 1, unit: "pcs" },
        { ingredientId: id.garlic, name: "Garlic", quantity: 2, unit: "pcs" },
      ],
      eid(id.dal),
    ),
  ];
}
