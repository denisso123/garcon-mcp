// Response shapes of the public Garçon API, as observed on 2026-10-22 and as
// typed in fix-me-a-drink-web/lib/api.ts, lib/glossary-types.ts and
// lib/ingredient-pages.ts. Only the fields this server reads are listed.

export interface RawPreview {
  readonly id: string
  readonly slug?: string
  readonly name: string
  readonly imageUrl?: string
  readonly baseSpirit?: string
  readonly strengthLevel?: string
  readonly totalTime?: number
  readonly flavorNotes?: readonly string[]
  readonly ingredientCount?: number
  readonly isFree?: boolean
}

export interface RawRecipeIngredient {
  readonly amount?: number | null
  readonly unit?: string | null
  readonly optional?: boolean
  readonly ingredient: {
    readonly name: string
    readonly slug?: string
    readonly category?: string | null
    readonly groupCategory?: string | null
    readonly pageId?: string | null
  }
}

export interface RawLinkedItem {
  readonly key?: string
  readonly label: string
  readonly termSlug?: string | null
}

export interface RawRecipe {
  readonly isLocked: boolean
  readonly id: string
  readonly slug?: string
  readonly name: string
  readonly description?: string
  readonly imageUrl?: string
  readonly baseSpirit?: string
  readonly difficulty?: string
  readonly totalTime?: number
  readonly strengthLevel?: string
  readonly flavorNotes?: readonly string[]
  readonly ingredients?: readonly RawRecipeIngredient[]
  readonly instructions?: readonly {
    readonly step?: number
    readonly text: string
    readonly tip?: string
  }[]
  readonly glassware?: string
  readonly garnish?: string
  readonly ice?: string
  readonly servingDetails?: {
    readonly glassware?: RawLinkedItem | null
    readonly ice?: RawLinkedItem | null
    readonly garnish?: RawLinkedItem | string | null
  }
  readonly alcoholVolumePercentage?: number
  readonly isFree?: boolean
}

export interface RawMatchGroups {
  readonly readyToMake?: readonly RawPreview[]
  readonly closeMatch?: readonly RawPreview[]
  readonly almostThere?: readonly RawPreview[]
}

export interface RawIngredientOption {
  readonly id: string
  readonly name: string
  readonly slug?: string
  readonly category?: string | null
  readonly groupCategory?: string | null
}

export interface RawRecipeList {
  readonly cocktails: readonly RawPreview[]
  readonly totalPages: number
  readonly total: number
}

export interface RawGlossaryPreview {
  readonly slug: string
  readonly name: string
  readonly type: string
  readonly aliases?: readonly string[]
  readonly shortDefinition?: string
}

export interface RawGlossaryTerm extends RawGlossaryPreview {
  readonly pronunciation?: string | null
  readonly facts?: readonly { label: string; value: string }[]
  readonly content?: {
    readonly explanation?: readonly string[]
    readonly how?: {
      readonly question?: string
      readonly intro?: string
      readonly steps?: readonly { text: string }[]
    }
  }
  readonly relatedTerms?: readonly RawGlossaryPreview[]
}

export interface RawIngredientPagePreview {
  readonly slug: string
  readonly name: string
  readonly aliases?: readonly string[]
  readonly archetype?: string
  readonly definition?: string
}

export interface RawIngredientPage extends RawIngredientPagePreview {
  readonly content?: {
    readonly taste?: { notes?: readonly string[]; summary?: string }
    readonly madeFrom?: string
    readonly numbers?: { abvMin?: number; abvMax?: number }
    readonly substitutes?: readonly {
      readonly label?: string
      readonly pageSlug?: string
      readonly note?: string
      readonly ratio?: string
      readonly zeroProof?: boolean
      readonly rank?: number
    }[]
    readonly types?: readonly {
      label: string
      description?: string
      ingredientSlug?: string
    }[]
    readonly shelfLife?: { opened?: string; unopened?: string; storage?: string }
  }
  readonly parent?: { slug: string; name: string } | null
  readonly children?: readonly { slug: string; name: string }[]
  readonly cocktailCount?: number
  readonly cocktails?: readonly RawPreview[]
}
