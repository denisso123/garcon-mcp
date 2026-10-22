import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { explainOutput, findOutput, recipeOutput, similarOutput } from '../src/schemas'
import { AGE_NOTE } from '../src/site'
import { bourbonBar, garibaldi, glossaryRoutes, mule, oldFashioned } from './data'
import { FakeApi, type FakeApiData, envelope, preview, recipe, setup, text, tool } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

const names = (cards: { name: string }[]) => cards.map((card) => card.name)

describe('find_cocktails_by_ingredients', () => {
  it('ranks drinks by fewest missing and leaves premium recipes out', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    const result = await tool(h, 'find_cocktails_by_ingredients', { ingredients: ['bourbon', 'sugar', 'bitters'] })
    const out = findOutput.parse(result.structuredContent)
    expect(out.cocktails[0]).toMatchObject({
      name: 'Old Fashioned',
      can_make_now: true,
      url: 'https://fixmeadrinkapp.com/recipes/old-fashioned',
    })
    expect(names(out.cocktails)).not.toContain('Rose Sour')
    expect(names(out.low_proof_options)).toEqual(['Garibaldi'])
    expect(out.bar.recognised.find((term) => term.you_said === 'bitters')?.one_of).toBe(true)
    expect(out.bar.recognised.find((term) => term.you_said === 'sugar')?.one_of).toBeUndefined()
    expect(result._meta?.images).toMatchObject({
      'https://fixmeadrinkapp.com/recipes/old-fashioned': oldFashioned.imageUrl,
    })
    expect(text(result).endsWith(AGE_NOTE)).toBe(true)
  })

  it('never lists a drink both as a cocktail and as a low-proof option, and fetches each recipe once', async () => {
    const spritz = recipe('aperol-soda', ['Aperol', 'Soda Water'], { strengthLevel: 'Low' })
    const fizz = recipe('orange-fizz', ['Orange Juice', 'Brut champagne/sparkling wine'], { strengthLevel: 'Low' })
    const h = setup(
      new FakeApi({
        catalogue: [preview(garibaldi), preview(spritz), preview(fizz)],
        recipes: [garibaldi, spritz, fizz],
        matches: { closeMatch: [preview(garibaldi), preview(spritz), preview(fizz)] },
      }),
      worker
    )
    const out = findOutput.parse(
      (await tool(h, 'find_cocktails_by_ingredients', { ingredients: ['aperol', 'orange juice'] })).structuredContent
    )
    const main = new Set(names(out.cocktails))
    expect(main.size).toBe(3)
    expect(names(out.low_proof_options).filter((name) => main.has(name))).toEqual([])
    for (const slug of ['garibaldi', 'aperol-soda', 'orange-fizz']) {
      expect(h.api.callsTo(`/cocktails/slug/${slug}`)).toHaveLength(1)
    }
  })

  it('lets an unspecified bottle cover one ingredient, and a pantry word cover all its forms', async () => {
    const perfect = recipe('perfect-martini', ['London dry gin', 'Sweet vermouth', 'Dry vermouth'])
    const sour = recipe('lime-sour', ['London dry gin', 'Lime Juice', 'Lime'])
    const h = setup(
      new FakeApi({
        recipes: [perfect, sour],
        matches: { readyToMake: [preview(perfect), preview(sour)] },
      }),
      worker
    )
    const out = findOutput.parse(
      (await tool(h, 'find_cocktails_by_ingredients', { ingredients: ['gin', 'vermouth', 'limes'] })).structuredContent
    )
    const martini = out.cocktails.find((card) => card.name === 'Perfect Martini')!
    expect(martini.have).toHaveLength(2)
    expect(martini.missing).toHaveLength(1)
    expect(martini.can_make_now).toBe(false)
    expect(out.cocktails.find((card) => card.name === 'Lime Sour')).toMatchObject({ missing: [], can_make_now: true })
  })

  it('compares every close candidate before truncating, so a drink missing only a garnish is not dropped', async () => {
    const close = Array.from({ length: 12 }, (_, i) =>
      recipe(`close-${i}`, ['Vodka', 'Lime Juice', `Rare liqueur ${i}`])
    )
    const garnishOnly = recipe('garnish-only', ['Vodka', 'Lime peel|garnish'])
    const h = setup(
      new FakeApi({
        recipes: [...close, garnishOnly],
        matches: { closeMatch: [...close, garnishOnly].map((item) => preview(item)) },
      }),
      worker
    )
    const out = findOutput.parse(
      (await tool(h, 'find_cocktails_by_ingredients', { ingredients: ['vodka', 'lime juice'] })).structuredContent
    )
    expect(out.cocktails[0]).toMatchObject({ name: 'Garnish Only', can_make_now: true, missing_garnish: ['Lime peel'] })
    expect(out.cocktails).toHaveLength(5)
  })

  it('stops comparing once later groups cannot beat the drinks already found', async () => {
    const ready = Array.from({ length: 6 }, (_, i) => recipe(`ready-${i}`, ['Vodka', 'Soda Water']))
    const almost = Array.from({ length: 20 }, (_, i) => recipe(`almost-${i}`, ['Vodka', `A${i}`, `B${i}`]))
    const h = setup(
      new FakeApi({
        recipes: [...ready, ...almost],
        matches: { readyToMake: ready.map((item) => preview(item)), almostThere: almost.map((item) => preview(item)) },
      }),
      worker
    )
    await tool(h, 'find_cocktails_by_ingredients', { ingredients: ['vodka', 'soda water'], strength: 'medium' })
    expect(h.api.callsTo('/cocktails/slug/').length).toBeLessThanOrEqual(8)
  })

  it('keeps the drinks it found when the low-proof options fail to load', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    h.api.override('/cocktails?', () => new Response('down', { status: 503 }))
    const result = await tool(h, 'find_cocktails_by_ingredients', { ingredients: ['bourbon', 'sugar', 'bitters'] })
    expect(result.isError).toBeFalsy()
    const out = findOutput.parse(result.structuredContent)
    expect(out.cocktails[0].name).toBe('Old Fashioned')
    expect(out.low_proof_options).toEqual([])
    expect(out.unavailable).toEqual(['low_proof_options'])
    expect(h.api.callsTo('/cocktails?')).toHaveLength(2)
    expect(text(result)).toContain('could not be loaded this time')
  })

  it('looks up at most 8 unfamiliar names per call and says which it skipped', async () => {
    const h = setup(new FakeApi(), worker)
    const unknown = Array.from({ length: 10 }, (_, i) => `mystery ${i}`)
    const out = findOutput.parse(
      (await tool(h, 'find_cocktails_by_ingredients', { ingredients: unknown })).structuredContent
    )
    expect(h.api.callsTo('/ingredients/search')).toHaveLength(8)
    expect(out.bar.not_checked).toEqual(['mystery 8', 'mystery 9'])
    expect(out.bar.not_recognised).toHaveLength(8)
  })

  it('treats inherited object keys as ordinary unknown words', async () => {
    const h = setup(new FakeApi(), worker)
    const result = await tool(h, 'find_cocktails_by_ingredients', { ingredients: ['constructor', '__proto__'] })
    expect(result.isError).toBeFalsy()
    expect(findOutput.parse(result.structuredContent).bar.not_recognised).toEqual(['constructor', '__proto__'])
  })

  it('rejects unknown arguments instead of dropping them', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    const result = await tool(h, 'find_cocktails_by_ingredients', { ingredients: ['gin'], strengthh: 'zero_or_low' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/strengthh/)
    expect(h.api.calls).toEqual([])
  })

  it('returns a readable error for an empty bar', async () => {
    const h = setup(new FakeApi(), worker)
    const result = await tool(h, 'find_cocktails_by_ingredients', { ingredients: [' , '] })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/at least one/)
  })
})

describe('get_cocktail_recipe', () => {
  it('returns a recipe and serves the second call from memory', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    const first = await tool(h, 'get_cocktail_recipe', { name: 'old fashioned' })
    expect(recipeOutput.parse(first.structuredContent).ingredients[0].name).toBe('Bourbon whiskey')
    expect(text(first).endsWith(AGE_NOTE)).toBe(true)
    const calls = h.api.calls.length
    await tool(h, 'get_cocktail_recipe', { name: 'Old Fashioned' })
    expect(h.api.calls).toHaveLength(calls)
  })

  it('matches a slug or recipe URL in any case and does not call it inexact', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    for (const name of ['Old-Fashioned', 'https://fixmeadrinkapp.com/recipes/OLD-FASHIONED']) {
      const out = recipeOutput.parse((await tool(h, 'get_cocktail_recipe', { name })).structuredContent)
      expect(out.name).toBe('Old Fashioned')
      expect(out.note).toBeUndefined()
    }
  })

  it('offers free alternatives for a premium recipe', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    const out = recipeOutput.parse((await tool(h, 'get_cocktail_recipe', { name: 'Rose Sour' })).structuredContent)
    expect(out.full_recipe_public).toBe(false)
    expect(names(out.free_alternatives ?? [])).toEqual(['Grapefruit Mule'])
  })

  it('keeps a premium recipe when its free alternatives fail to load', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    h.api.override('/cocktails/similar/', () => new Response('down', { status: 503 }))
    const result = await tool(h, 'get_cocktail_recipe', { name: 'Rose Sour' })
    expect(result.isError).toBeFalsy()
    const out = recipeOutput.parse(result.structuredContent)
    expect(out.name).toBe('Rose Sour')
    expect(out.unavailable).toEqual(['free_alternatives'])
  })

  it('says when no cocktail matches', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    const result = await tool(h, 'get_cocktail_recipe', { name: 'zzz qqq' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/No cocktail called "zzz qqq"/)
  })
})

describe('recipe lookup', () => {
  const daiquiris = [
    recipe('dry-daiquiri', ['Light rum'], { name: 'Dry Daiquiri' }),
    recipe('daiquiri-no-2', ['Light rum'], { name: 'Daiquiri No. 2', isLocked: true }),
    recipe('daiquiri', ['Light rum'], { name: 'Daiquiri', isLocked: true }),
    recipe('pink-daiquiri', ['Light rum'], { name: 'Pink Daiquiri' }),
    recipe('manhattan-sweet', ['Rye whiskey'], { name: 'Manhattan (Sweet)' }),
    recipe('black-manhattan', ['Rye whiskey'], { name: 'Black Manhattan' }),
  ]

  async function lookup(name: string, catalogue = daiquiris) {
    const h = setup(new FakeApi({ catalogue: catalogue.map((item) => preview(item)), recipes: daiquiris }), worker)
    return recipeOutput.parse((await tool(h, 'get_cocktail_recipe', { name })).structuredContent)
  }

  it('prefers the exact name, even when premium', async () => {
    expect(await lookup('daiquiri')).toMatchObject({ name: 'Daiquiri', full_recipe_public: false })
  })

  it('treats a qualified classic as the closest match and says so', async () => {
    const out = await lookup('manhattan')
    expect(out.name).toBe('Manhattan (Sweet)')
    expect(out.note).toMatch(/No recipe is named exactly "manhattan"/)
  })

  it('puts free recipes first among equally good matches', async () => {
    const out = await lookup('daiquiri', daiquiris.filter((item) => item.slug !== 'daiquiri'))
    expect([out.name, ...names(out.other_matches ?? [])]).toEqual(['Dry Daiquiri', 'Pink Daiquiri', 'Daiquiri No. 2'])
  })
})

describe('suggest_similar_cocktail', () => {
  function coffeeCatalogue(): FakeApiData {
    const source = recipe('espresso-martini-classic', ['Vodka', 'Espresso'], {
      name: 'Espresso Martini (Classic)',
      flavorNotes: ['Coffee'],
      baseSpirit: 'Vodka',
    })
    const coffeeLow = recipe('coffee-tonic', ['Espresso', 'Tonic Water'], { strengthLevel: 'Low', flavorNotes: ['Coffee'] })
    const fruityLow = recipe('berry-soda', ['Raspberry', 'Soda Water'], { strengthLevel: 'Low', flavorNotes: ['Fruity'] })
    const similar = Array.from({ length: 8 }, (_, i) => preview(recipe(`coffee-${i}`, ['Vodka'])))
    return {
      catalogue: [preview(source), preview(coffeeLow), preview(fruityLow)],
      similar: { [source.id]: similar },
    }
  }

  it('flags a non-exact source, caps the list and never calls an unrelated drink similar', async () => {
    const h = setup(new FakeApi(coffeeCatalogue()), worker)
    const result = await tool(h, 'suggest_similar_cocktail', { name: 'espresso martini' })
    const out = similarOutput.parse(result.structuredContent)
    expect(out.note).toMatch(/No recipe is named exactly "espresso martini"/)
    expect(out.suggestions).toHaveLength(5)
    expect(names(out.low_proof_options)).toEqual(['Coffee Tonic'])
    expect(text(result).endsWith(AGE_NOTE)).toBe(true)

    const low = similarOutput.parse(
      (await tool(h, 'suggest_similar_cocktail', { name: 'Espresso Martini (Classic)', low_proof: true }))
        .structuredContent
    )
    expect(low.note).toBeUndefined()
    expect(names(low.suggestions)).toEqual(['Coffee Tonic'])
  })

  it('puts free recipes first and loads the catalogue once', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    const out = similarOutput.parse(
      (await tool(h, 'suggest_similar_cocktail', { name: 'Old Fashioned' })).structuredContent
    )
    expect(out.suggestions.map((card) => card.full_recipe_public)).toEqual([true, false])
    expect(h.api.callsTo('/cocktails?')).toHaveLength(1)
  })
})

describe('explain_bar_term', () => {
  it('explains a glossary term with its steps and the age line', async () => {
    const h = setup(new FakeApi(), worker)
    for (const [path, handler] of Object.entries(glossaryRoutes)) h.api.override(path, handler)
    const result = await tool(h, 'explain_bar_term', { term: 'what is a dry shake?' })
    const out = explainOutput.parse(result.structuredContent)
    expect(out).toMatchObject({ name: 'Dry shake', url: 'https://fixmeadrinkapp.com/glossary/dry-shake' })
    expect(out.definition).toBe('Shaking without ice to foam egg white.')
    expect(out.how_to?.steps).toEqual(['Shake hard without ice', 'Add ice and shake again'])
    expect(text(result).endsWith(AGE_NOTE)).toBe(true)
  })

  it('suggests close names for an unknown term', async () => {
    const h = setup(new FakeApi(), worker)
    h.api.override('/glossary', () => envelope([{ slug: 'dry-shake', name: 'Dry shake', type: 'technique' }]))
    h.api.override('/ingredient-pages', () => envelope([]))
    const result = await tool(h, 'explain_bar_term', { term: 'dryness' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('Close matches: Dry shake')
  })
})

it('answers the same on the ChatGPT route', async () => {
  const h = setup(new FakeApi(bourbonBar()), worker)
  const result = await tool(h, 'get_cocktail_recipe', { name: mule.name }, '/chatgpt/mcp')
  expect(recipeOutput.parse(result.structuredContent).name).toBe(mule.name)
})
