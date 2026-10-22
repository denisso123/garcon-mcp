// Output schemas of the four tools. The MCP server publishes them, and the
// TypeScript types the service builds are inferred from them.

import * as z from 'zod'

const link = z.object({ name: z.string(), url: z.string() })

const cocktailCard = z.object({
  name: z.string(),
  url: z.string().describe('Canonical recipe page on fixmeadrinkapp.com'),
  strength: z.string().describe('Non Alcoholic, Low, Medium, Strong or Very Strong'),
  flavors: z.array(z.string()),
  base_spirit: z.string().optional(),
  minutes: z.number().optional(),
})

const matchCard = cocktailCard.extend({
  have: z.array(z.string()).describe('Recipe ingredients your bar definitely covers'),
  missing: z.array(z.string()).describe('Required ingredients you do not have'),
  depends_on: z
    .array(z.object({ ingredient: z.string(), you_said: z.string() }))
    .optional()
    .describe('Ingredients a vague word may cover: the drink works only if your <you_said> is this <ingredient>'),
  missing_garnish: z.array(z.string()).optional(),
  can_make_now: z.boolean().describe('True only when nothing is missing and nothing depends on which bottle you have'),
})

const resolvedTerm = z.object({
  you_said: z.string(),
  matched_as: z.array(z.string()).describe('Catalogue names this word definitely covers'),
  could_be: z
    .array(z.string())
    .optional()
    .describe('One bottle that may be any of these; a recipe that needs one shows it under depends_on, never under have'),
  single_bottle: z
    .literal(true)
    .optional()
    .describe('matched_as are substitutes from one bottle: it covers at most one of them in a recipe'),
})

export const findOutput = z.object({
  bar: z.object({
    recognised: z.array(resolvedTerm),
    not_recognised: z.array(z.string()),
    not_checked: z
      .array(z.string())
      .optional()
      .describe('Unfamiliar names left unchecked because of the per-request lookup limit'),
    assumed_staples: z.array(z.string()),
  }),
  cocktails: z.array(matchCard),
  low_proof_options: z.array(matchCard),
  note: z.string().optional(),
  unavailable: z
    .array(z.literal('low_proof_options'))
    .optional()
    .describe('Parts of the answer that could not be loaded this time'),
  more_ideas_url: z.string(),
  partial: z
    .literal(true)
    .optional()
    .describe('Set when the per-call lookup budget ran out before every recipe that could rank higher was checked'),
})

export const recipeOutput = z.object({
  name: z.string(),
  url: z.string(),
  full_recipe_public: z.boolean(),
  description: z.string(),
  strength: z.string(),
  flavors: z.array(z.string()),
  base_spirit: z.string().optional(),
  abv_percent: z.number().optional(),
  difficulty: z.string().optional(),
  minutes: z.number().optional(),
  glass: z.string().optional(),
  ice: z.string().optional(),
  garnish: z.string().optional(),
  ingredients: z.array(z.object({ amount: z.string(), name: z.string(), optional: z.boolean().optional() })),
  steps: z.array(z.string()),
  note: z.string().optional().describe('Set when no recipe has exactly the requested name'),
  other_matches: z.array(link).optional(),
  free_alternatives: z.array(cocktailCard).optional(),
  unavailable: z
    .array(z.literal('free_alternatives'))
    .optional()
    .describe('Parts of the answer that could not be loaded this time'),
})

const similarCard = cocktailCard.extend({ full_recipe_public: z.boolean() })

export const similarOutput = z.object({
  source: link,
  suggestions: z.array(similarCard),
  low_proof_options: z.array(similarCard),
  note: z.string().optional().describe('Set when no recipe has exactly the requested name'),
})

export const explainOutput = z.object({
  name: z.string(),
  kind: z.string(),
  url: z.string(),
  definition: z.string(),
  details: z.array(z.object({ label: z.string(), value: z.string() })),
  how_to: z.object({ question: z.string(), steps: z.array(z.string()) }).optional(),
  substitutes: z
    .array(
      z.object({
        name: z.string(),
        note: z.string().optional(),
        zero_proof: z.boolean(),
        url: z.string().optional(),
      })
    )
    .optional(),
  related: z.array(link),
  example_cocktails: z.array(link).optional(),
  also_matches: z.array(link).optional(),
})

export type CocktailCard = z.infer<typeof cocktailCard>
export type MatchCard = z.infer<typeof matchCard>
export type ResolvedTerm = z.infer<typeof resolvedTerm>
export type FindOutput = z.infer<typeof findOutput>
export type RecipeOutput = z.infer<typeof recipeOutput>
export type SimilarCard = z.infer<typeof similarCard>
export type SimilarOutput = z.infer<typeof similarOutput>
export type ExplainOutput = z.infer<typeof explainOutput>
export type Link = z.infer<typeof link>
