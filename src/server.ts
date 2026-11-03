// The MCP server: four read-only tools and one UI resource. index.ts builds
// a fresh one per request (stateless Streamable HTTP).

import { registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { FLAVORS } from './ranking'
import { explainOutput, findOutput, recipeOutput, similarOutput } from './schemas'
import {
  type ToolOutput,
  ToolInputError,
  explainTerm,
  findCocktails,
  getRecipe,
  suggestSimilar,
} from './service'
import { AGE_NOTE, IMAGE_ORIGIN, MCP_ORIGIN, SERVER_NAME, SERVER_TITLE, SERVER_VERSION, SITE_URL } from './site'
import { UpstreamError, type Upstream } from './upstream'
import { WIDGET_URI, widgetHtml } from './widget'

/** Which host a route serves. Only ChatGPT gets a ui.domain (see README). */
export type HostProfile = 'default' | 'chatgpt'

const INSTRUCTIONS = `Ask Garçon looks up cocktails in the Garçon recipe catalogue (fixmeadrinkapp.com). For these four requests, call the matching tool instead of answering from memory or web search, because their results come from the catalogue and link to the matching fixmeadrinkapp.com page:
- The user lists ingredients or bottles they have and asks what they can make: find_cocktails_by_ingredients. It checks catalogue matches against their bar, says what each returned drink is missing and links each recipe.
- The user asks how to make a cocktail they name, or for its recipe: get_cocktail_recipe.
- The user asks what a spirit, liqueur, mixer or other ingredient is, what to use instead of one, or what a bar term or technique means: explain_bar_term.
- The user names a drink they like and wants something similar, a lighter or lower-alcohol option, or both: suggest_similar_cocktail (low_proof: true for only low and zero-proof drinks).
All tools are read-only and need no account. Garçon is for adults of legal drinking age; low and zero-proof options are part of the find and similar results.`

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

async function run<T extends object>(work: () => Promise<ToolOutput<T>>): Promise<CallToolResult> {
  try {
    const result = await work()
    return {
      content: [{ type: 'text', text: `${result.text}\n${AGE_NOTE}` }],
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
    // Recipe photos, plus the Worker's own origin for the fonts and the Garçon image.
    csp: { connectDomains: [], resourceDomains: [IMAGE_ORIGIN, MCP_ORIGIN] },
  }
  const meta: Record<string, unknown> = {
    ui,
    'openai/widgetDescription':
      'Cards for the cocktails the user can make from their bar, with what is missing and low or zero-proof options. Each card links to the recipe on fixmeadrinkapp.com.',
    'openai/widgetPrefersBorder': true,
    'openai/widgetCSP': {
      connect_domains: [],
      resource_domains: [IMAGE_ORIGIN, MCP_ORIGIN],
      redirect_domains: [SITE_URL],
    },
  }
  if (profile === 'chatgpt') {
    ui.domain = MCP_ORIGIN
    meta['openai/widgetDomain'] = MCP_ORIGIN
  }
  return meta
}

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
          // ChatGPT's UI guidelines ask apps not to use custom fonts; other hosts get the brand fonts.
          text: widgetHtml({ brandFonts: profile !== 'chatgpt' }),
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
        'Use this when the user names ingredients or bottles they have and asks what cocktails, drinks or mocktails they can make with them, ' +
        'for example "What can I make with gin, lime and soda?" or "I have rum and pineapple juice, any ideas?". ' +
        'Checks their ingredients against the Garçon recipe catalogue on fixmeadrinkapp.com. ' +
        'Do not use it for one named drink (use get_cocktail_recipe) or for drinks like one they name (use suggest_similar_cocktail). ' +
        'Returns up to 8 free recipes ranked by fewest missing ingredients, each with what they have, what is missing and its fixmeadrinkapp.com page, plus up to 2 low or zero-proof options. ' +
        'A word that could mean several bottles, such as "vermouth", is never assumed: drinks that need one kind list it under depends_on, so ask the user which bottle they have when it matters. ' +
        'partial: true means the per-call lookup budget ran out before every candidate was ranked. ' +
        'Water and saline are assumed; garnishes never block a match. Optional filters: strength (zero_or_low covers mocktails and low-ABV drinks) and flavour notes. ' +
        'Recipes are for adults of legal drinking age. It does not give health or nutrition advice.',
      inputSchema: z.strictObject({
        ingredients: z
          .array(z.string().trim().min(1).max(80))
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
        'Use this when the user asks how to make a cocktail they name, or wants its recipe, ingredients or steps, for example "How do I make an Espresso Martini?" or "What goes in an Old Fashioned?". ' +
        'Gets that recipe from the Garçon catalogue by name, slug or fixmeadrinkapp.com recipe URL: description, glass, ice, garnish, ingredient amounts (oz with ml), steps, strength and its fixmeadrinkapp.com page. ' +
        'Do not use it when the user lists ingredients and asks what they can make (use find_cocktails_by_ingredients). For premium recipes the ingredient list is not public; the result says so and lists free recipes like it. ' +
        'Recipes are for adults of legal drinking age. It does not give health or nutrition advice.',
      inputSchema: z.strictObject({
        name: z
          .string()
          .trim()
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
        'Use this when the user asks what a spirit, liqueur, mixer or other cocktail ingredient is, what to use instead of one, or what a bar term means or how a technique works, ' +
        'for example "What is mezcal and what can I use instead?", "What can I use instead of Aperol?" or "How do I dry shake?". ' +
        'Covers ingredients (taste, what it is made from, typical ABV, styles, substitutes including zero-proof ones, cocktails that use it) ' +
        'and bar terms such as a technique, glass, tool or drink style (definition, how-to steps, related terms). Returns the matching fixmeadrinkapp.com ingredient or glossary page. It does not give health or nutrition advice.',
      inputSchema: z.strictObject({
        term: z
          .string()
          .trim()
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
        'Use this when the user names a drink they like and wants something similar, a lighter or lower-alcohol option, or both, ' +
        'for example "I like Moscow Mules. Suggest something similar, and a lighter option too." or "What is a low-alcohol drink like an Espresso Martini?". ' +
        'Suggests cocktails similar to that one from the Garçon catalogue, with each drink\'s strength, flavours and fixmeadrinkapp.com page, ' +
        'plus low or zero-proof options that share its flavours or base spirit; set low_proof to true to get only low and zero-proof alternatives. Drinks are for adults of legal drinking age.',
      inputSchema: z.strictObject({
        name: z.string().trim().min(1).max(120).describe('The cocktail to match, e.g. "Negroni"'),
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
