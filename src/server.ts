// Builds the MCP server: four read-only tools and one UI resource. A fresh
// server is built per request (stateless Streamable HTTP).

import { registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { FLAVORS } from './ranking'
import {
  type ToolOutput,
  ToolInputError,
  explainTerm,
  findCocktails,
  getRecipe,
  suggestSimilar,
} from './service'
import { IMAGE_ORIGIN, MCP_ORIGIN, SERVER_NAME, SERVER_TITLE, SERVER_VERSION, SITE_URL } from './site'
import { UpstreamError, type Upstream } from './upstream'
import { WIDGET_HTML, WIDGET_URI } from './widget'

/** Which host a route serves. Only ChatGPT gets a ui.domain (see README). */
export type HostProfile = 'default' | 'chatgpt'

export const INSTRUCTIONS = `Ask Garçon looks up cocktails in the Garçon recipe catalogue (fixmeadrinkapp.com): drinks you can make from the ingredients you have, full recipes, explanations of spirits, ingredients and bar terms, and similar drinks. All tools are read-only and need no account. Results link to the matching page on fixmeadrinkapp.com. Garçon is for adults of legal drinking age; low and zero-proof options are part of the find and similar results.`

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

// ---------------------------------------------------------------- schemas

const cardShape = {
  name: z.string(),
  url: z.string().describe('Canonical recipe page on fixmeadrinkapp.com'),
  strength: z.string().describe('Non Alcoholic, Low, Medium, Strong or Very Strong'),
  flavors: z.array(z.string()),
  base_spirit: z.string().optional(),
  minutes: z.number().optional(),
}

const matchCard = z.object({
  ...cardShape,
  have: z.array(z.string()).describe('Recipe ingredients covered by your bar'),
  missing: z.array(z.string()).describe('Required ingredients you do not have'),
  missing_garnish: z.array(z.string()).optional(),
  can_make_now: z.boolean(),
})

const findOutput = z.object({
  bar: z.object({
    recognised: z.array(z.object({ you_said: z.string(), matched_as: z.array(z.string()) })),
    not_recognised: z.array(z.string()),
    assumed_staples: z.array(z.string()),
  }),
  cocktails: z.array(matchCard),
  low_proof_options: z.array(matchCard),
  note: z.string().optional(),
  more_ideas_url: z.string(),
})

const linkShape = z.object({ name: z.string(), url: z.string() })

const recipeOutput = z.object({
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
  ingredients: z.array(
    z.object({ amount: z.string(), name: z.string(), optional: z.boolean().optional() })
  ),
  steps: z.array(z.string()),
  note: z.string().optional().describe('Set when no recipe has exactly the requested name'),
  other_matches: z.array(linkShape).optional(),
  free_alternatives: z.array(z.object(cardShape)).optional(),
})

const similarCard = z.object({ ...cardShape, full_recipe_public: z.boolean() })

const similarOutput = z.object({
  source: linkShape,
  suggestions: z.array(similarCard),
  low_proof_options: z.array(similarCard),
  note: z.string().optional(),
})

const explainOutput = z.object({
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
  related: z.array(linkShape),
  example_cocktails: z.array(linkShape).optional(),
  also_matches: z.array(linkShape).optional(),
})

// ----------------------------------------------------------------- helpers

async function run<T extends object>(work: () => Promise<ToolOutput<T>>): Promise<CallToolResult> {
  try {
    const result = await work()
    return {
      content: [{ type: 'text', text: result.text }],
      structuredContent: result.structured as Record<string, unknown>,
      ...(result.meta ? { _meta: result.meta } : {}),
    }
  } catch (error) {
    if (error instanceof ToolInputError || error instanceof UpstreamError) {
      return { isError: true, content: [{ type: 'text', text: error.message }] }
    }
    console.error('tool failed', error instanceof Error ? error.message : String(error))
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Something went wrong while looking that up. Try again, or browse the recipes at https://fixmeadrinkapp.com/recipes.',
        },
      ],
    }
  }
}

function widgetResourceMeta(profile: HostProfile) {
  const ui: Record<string, unknown> = {
    prefersBorder: true,
    csp: { connectDomains: [], resourceDomains: [IMAGE_ORIGIN] },
  }
  const meta: Record<string, unknown> = {
    ui,
    'openai/widgetDescription':
      'Cards for the cocktails the user can make from their bar, with what is missing and low or zero-proof options. Each card links to the recipe on fixmeadrinkapp.com.',
    'openai/widgetPrefersBorder': true,
    'openai/widgetCSP': {
      connect_domains: [],
      resource_domains: [IMAGE_ORIGIN],
      redirect_domains: [SITE_URL],
    },
  }
  if (profile === 'chatgpt') {
    ui.domain = MCP_ORIGIN
    meta['openai/widgetDomain'] = MCP_ORIGIN
  }
  return meta
}

// ------------------------------------------------------------------ server

export function createServer(up: Upstream, profile: HostProfile = 'default') {
  const server = new McpServer(
    { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION, websiteUrl: SITE_URL },
    { instructions: INSTRUCTIONS }
  )

  registerAppResource(
    server,
    'Cocktail list',
    WIDGET_URI,
    {
      description: 'Card list for find_cocktails_by_ingredients results.',
      _meta: widgetResourceMeta(profile),
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: 'text/html;profile=mcp-app',
          text: WIDGET_HTML,
          _meta: widgetResourceMeta(profile),
        },
      ],
    })
  )

  registerAppTool(
    server,
    'find_cocktails_by_ingredients',
    {
      title: 'Find cocktails from your ingredients',
      description:
        'Finds cocktails the user can make from the bottles and ingredients they already have, using the Garçon recipe catalogue. ' +
        'Use it when the user lists what is in their bar, fridge or cabinet and asks what they can make. ' +
        'Returns up to 8 free recipes ranked by fewest missing ingredients, each with what they have, what is missing and its fixmeadrinkapp.com page, plus up to 2 low or zero-proof options. ' +
        'Water and saline are assumed; garnishes never block a match. Optional filters: strength (zero_or_low covers mocktails and low-ABV drinks) and flavour notes. ' +
        'Recipes are for adults of legal drinking age. It does not give health or nutrition advice.',
      inputSchema: z.object({
        ingredients: z
          .array(z.string().min(1).max(80))
          .min(1)
          .max(25)
          .describe('What the user has, in their own words, one item each, e.g. ["gin", "limes", "simple syrup"]'),
        strength: z
          .enum(['zero_or_low', 'medium', 'strong'])
          .optional()
          .describe('zero_or_low for mocktails and low-ABV drinks; omit for any strength'),
        flavors: z
          .array(z.enum(FLAVORS))
          .max(5)
          .optional()
          .describe('Flavour notes to prefer; a drink matches if it has any of them'),
        limit: z.number().int().min(1).max(8).optional().describe('How many drinks to return (default 5)'),
      }),
      outputSchema: findOutput,
      annotations: { title: 'Find cocktails from your ingredients', ...READ_ONLY },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        'openai/outputTemplate': WIDGET_URI,
        'openai/toolInvocation/invoking': 'Checking your bar…',
        'openai/toolInvocation/invoked': 'Drinks found',
      },
    },
    async (args) => run(() => findCocktails(up, args))
  )

  server.registerTool(
    'get_cocktail_recipe',
    {
      title: 'Get a cocktail recipe',
      description:
        'Gets one cocktail recipe from the Garçon catalogue by name or recipe slug: description, glass, ice, garnish, ingredient amounts (oz with ml), steps, strength and its fixmeadrinkapp.com page. ' +
        'Use it when the user asks how to make a specific drink. For premium recipes the ingredient list is not public; the result says so and lists free recipes like it. ' +
        'Recipes are for adults of legal drinking age. It does not give health or nutrition advice.',
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .max(120)
          .describe('Cocktail name ("Espresso Martini"), slug ("espresso-martini") or fixmeadrinkapp.com recipe URL'),
      }),
      outputSchema: recipeOutput,
      annotations: { title: 'Get a cocktail recipe', ...READ_ONLY },
      _meta: {
        'openai/toolInvocation/invoking': 'Pulling the recipe…',
        'openai/toolInvocation/invoked': 'Recipe ready',
      },
    },
    async (args) => run(() => getRecipe(up, args))
  )

  server.registerTool(
    'explain_bar_term',
    {
      title: 'Explain a spirit, ingredient or bar term',
      description:
        'Explains a spirit, liqueur, mixer or other cocktail ingredient (taste, what it is made from, typical ABV, styles, substitutes including zero-proof ones, cocktails that use it), ' +
        'or a bar term such as a technique, glass, tool or drink style (definition, how-to steps, related terms). ' +
        'Use it when the user asks what something is or how a technique works. Returns the matching fixmeadrinkapp.com ingredient or glossary page. It does not give health or nutrition advice.',
      inputSchema: z.object({
        term: z
          .string()
          .min(1)
          .max(80)
          .describe('The thing to explain, e.g. "mezcal", "Aperol", "dry shake", "coupe glass"'),
      }),
      outputSchema: explainOutput,
      annotations: { title: 'Explain a spirit, ingredient or bar term', ...READ_ONLY },
      _meta: {
        'openai/toolInvocation/invoking': 'Looking it up…',
        'openai/toolInvocation/invoked': 'Explained',
      },
    },
    async (args) => run(() => explainTerm(up, args))
  )

  server.registerTool(
    'suggest_similar_cocktail',
    {
      title: 'Suggest similar cocktails',
      description:
        'Suggests cocktails similar to one the user names, from the Garçon catalogue, with each drink\'s strength, flavours and fixmeadrinkapp.com page. ' +
        'Always includes low or zero-proof options that share its flavours; set low_proof to true to get only low and zero-proof alternatives. ' +
        'Use it when the user liked a drink and wants something like it, or wants a lighter version. Drinks are for adults of legal drinking age.',
      inputSchema: z.object({
        name: z.string().min(1).max(120).describe('The cocktail to match, e.g. "Negroni"'),
        low_proof: z.boolean().optional().describe('True to suggest only low and zero-proof drinks'),
      }),
      outputSchema: similarOutput,
      annotations: { title: 'Suggest similar cocktails', ...READ_ONLY },
      _meta: {
        'openai/toolInvocation/invoking': 'Finding drinks like it…',
        'openai/toolInvocation/invoked': 'Suggestions ready',
      },
    },
    async (args) => run(() => suggestSimilar(up, args))
  )

  return server
}
