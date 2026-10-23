import type { RawGlossaryPreview, RawGlossaryTerm, RawRecipe } from '../src/api-types'
import oldFashionedJson from './fixtures/old-fashioned.json'
import muleJson from './fixtures/grapefruit-mule.json'
import roseSourJson from './fixtures/rose-sour-locked.json'
import { type FakeApiData, envelope, preview, recipe } from './harness'

export const oldFashioned = oldFashionedJson as RawRecipe
export const mule = muleJson as RawRecipe
export const roseSour = roseSourJson as RawRecipe

export const garibaldi = recipe('garibaldi', ['Red Bitter Liqueur', 'Orange Juice'], {
  strengthLevel: 'Low',
  flavorNotes: ['Citrusy'],
})

/** A bar of bourbon, sugar and bitters against a small catalogue. */
export function bourbonBar(): FakeApiData {
  return {
    catalogue: [preview(oldFashioned), preview(mule), preview(roseSour), preview(garibaldi)],
    recipes: [oldFashioned, mule, roseSour, garibaldi],
    matches: {
      readyToMake: [preview(oldFashioned)],
      closeMatch: [preview(roseSour)],
      almostThere: [preview(mule), preview(garibaldi)],
    },
    similar: { [roseSour.id]: [preview(mule), preview(roseSour)], [oldFashioned.id]: [preview(mule), preview(roseSour)] },
  }
}

export const dryShakePreview: RawGlossaryPreview = { slug: 'dry-shake', name: 'Dry shake', type: 'technique', aliases: [] }

export const dryShake: RawGlossaryTerm = {
  ...dryShakePreview,
  shortDefinition: 'Shaking without ice to foam [[ingredient:egg-white]].',
  content: { how: { question: 'How do you dry shake?', steps: [{ text: 'shake hard without ice' }, { text: 'add ice and shake again' }] } },
  relatedTerms: [{ slug: 'reverse-dry-shake', name: 'Reverse dry shake', type: 'technique' }],
}

export const glossaryRoutes = {
  '/glossary/slug/dry-shake': () => envelope(dryShake),
  '/glossary': () => envelope([dryShakePreview]),
  '/ingredient-pages': () => envelope([]),
} as const
