// The fixmeadrinkapp.com look, shared by the widget and the public pages.
// Every value is a token from fix-me-a-drink-web (styles/globals.css, which
// holds the Figma LS-25 variables, and lib/fonts.ts), copied under the same
// name. This file is the only place in the server that holds a raw colour,
// size or font value. The website is light only; the widget's dark theme is
// derived from these same tokens in widget.ts, never from new values.

/** Self-hosted on the Worker (public/fonts), the same variable fonts next/font serves on the site. */
export const FONT_FILES = {
  display: '/fonts/dm-sans-5.3.0-latin-wght.woff2',
  text: '/fonts/inter-5.3.0-latin-wght.woff2',
} as const

export const IMAGE_FILES = {
  /** Garçon with two peace signs (fix-me-a-drink-web public/redesign/garcon-peace.webp, 158 px). */
  peace: '/images/garcon-peace.webp',
  /** The top of Garçon looking up over an edge (public/redesign/garcon-peek.webp, 700 px). */
  peek: '/images/garcon-peek.webp',
  /** The recipe card's no-photo placeholder (public/redesign/recipe-placeholder.webp, shown at 32 px). */
  placeholder: '/images/recipe-placeholder.webp',
} as const

// The unicode-range of the Latin subset, as fontsource and next/font declare it.
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'

/** @font-face rules for DM Sans and Inter, served from `origin` ('' for same-origin pages). */
export function fontFaceCss(origin: string) {
  return `
  @font-face { font-family: "DM Sans Garcon"; font-style: normal; font-weight: 100 1000; font-display: swap; src: url("${origin}${FONT_FILES.display}") format("woff2"); unicode-range: ${LATIN}; }
  @font-face { font-family: "Inter Garcon"; font-style: normal; font-weight: 100 900; font-display: swap; src: url("${origin}${FONT_FILES.text}") format("woff2"); unicode-range: ${LATIN}; }`
}

/** Font stacks: the brand fonts, then the system stack Next.js falls back to. */
export const BRAND_FONTS = {
  // lib/fonts.ts `display` (DM Sans, --font-display): headings and the wordmark
  display: '"DM Sans Garcon", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  // lib/fonts.ts `sans` (Inter, --font-sans): interface and body text
  text: '"Inter Garcon", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
} as const

/** The host's font (MCP Apps --font-sans) or the system stack, for hosts that forbid custom fonts. */
export const SYSTEM_FONT = 'var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif)'

/**
 * The website tokens as CSS custom properties. Names are the site's; each
 * comment names the Figma variable or the site token the value comes from.
 */
export const TOKENS_CSS = `
  :root {
    /* surface (styles/globals.css) */
    --surface-0: #ffffff; /* surface/surface_0 */
    --surface-1: #f9f9fa; /* surface/surface_1 */
    --surface-2: #f4f4f6; /* surface/surface_2 */
    --surface-3: #ebecf0; /* surface/surface_3 */
    --surface-warning-high-em: #fcbf04; /* surface/warning_high_em */
    --surface-success-base-em-alpha: rgb(80 223 58 / 0.1); /* surface/success_base_em_alpha */
    --surface-warning-base-em-alpha: rgb(253 203 53 / 0.1); /* surface/warning_base_em_alpha */
    --surface-warning-overlay: #fff5d7; /* code-only: Plus badge on photos */
    --surface-primary-base-em-alpha: rgb(141 122 255 / 0.1); /* surface/primary_base_em_alpha */

    /* text */
    --fg-high-em: #0a0c11; /* text/high_em */
    --fg-med-em: #5b616d; /* text/med_em, also the mascot's grey */
    --fg-low-em: #636a74; /* text/low_em, AA-adjusted on the site */
    --fg-base-em: #c3c6cc; /* text/base_em */
    --fg-primary-high-em: #6635f2; /* text/primary_high_em: inline links */
    --fg-secondary-med-em: #ce00b6; /* text/secondary_med_em: footer "All ..." links */
    --fg-success-high-em: #237e15; /* text/success_high_em: success tags */
    --fg-warning-high-em: #8f6c01; /* text/warning_high_em: warning tags and notes */
    --fg-warning-overlay: #886702; /* code-only: Plus badge text on warning-overlay */

    /* outline */
    --outline-base-em: #f4f4f6; /* outline/base_em: site header rule */
    --outline-low-em: #ebecf0; /* outline/low_em: dividers */
    --outline-med-em: #dddfe4; /* outline/med_em: footer rule */
    --outline-primary-med-em: #bbb3ff; /* outline/primary_med_em: inline link underline */
    --outline-white-16: rgb(255 255 255 / 0.16); /* outline/white_16 */
    --focus-ring: #8d7aff; /* code-only focus ring */
    --focus-ring-width: 3px; /* code-only focus ring */

    /* spacing */
    --space-xxs: 2px; /* spacing/xxs */
    --space-xs: 4px; /* spacing/xs */
    --space-sm: 6px; /* spacing/sm */
    --space-md: 8px; /* spacing/md */
    --space-lg: 12px; /* spacing/lg */
    --space-xxl: 16px; /* spacing/xxl */
    --space-xxxl: 20px; /* spacing/xxxl */
    --space-4xl: 24px; /* spacing/4xl */
    --space-6xl: 32px; /* spacing/6xl */
    --space-7xl: 40px; /* spacing/7xl */
    --space-8xl: 48px; /* spacing/8xl */

    /* sizing */
    --size-icon-xs: 14px; /* sizing/icon/xs: Plus badge star */
    --size-icon-sm: 16px; /* sizing/icon/sm: icon button xs */
    --size-icon-lg: 20px; /* sizing/icon/lg */
    --size-icon-xxl: 24px; /* sizing/icon/xxl */
    --size-thumb: 64px; /* ingredient_card type_icon */
    --size-peek: 350px; /* GarconPeek width over an edge */
    --size-header: 72px; /* site_header height */
    --size-control-xs: 24px; /* tag xs height */
    --size-control-md: 40px; /* button md height */
    --size-control-lg: 48px; /* button lg height */

    /* radius */
    --radius-4: 4px; /* radius/border_radius_4: skeleton blocks */
    --radius-6: 6px; /* radius/border_radius_6: tags xs */
    --radius-8: 8px; /* radius/border_radius_8 */
    --radius-12: 12px; /* radius/border_radius_12: notes, text-only recipe row */
    --radius-16: 16px; /* radius/border_radius_16 */
    --radius-20: 20px; /* radius/border_radius_20: a row around a radius-12 thumb with 8 px padding */
    --radius-24: 24px; /* radius/border_radius_24: recipe card image */

    /* elevation */
    --shadow-e2: 0 3px 3px -1.5px rgb(0 0 0 / 0.04), 0 1px 1px -0.5px rgb(0 0 0 / 0.04); /* elevation/e2: recipe card image */
    --shadow-e3: 0 24px 24px -12px rgb(0 0 0 / 0.04), 0 3px 3px -1.5px rgb(0 0 0 / 0.04), 0 1px 1px -0.5px rgb(0 0 0 / 0.04); /* elevation/e3: recipe card image on hover */
    --shadow-special-drop: inset 0 -1px 3px -1px rgb(0 0 0 / 0.07), inset 0 2px 3px 0 rgb(255 255 255 / 0.07); /* special_drop: tags and notes */

    /* motion */
    --ease-enter: cubic-bezier(0.23, 1, 0.32, 1); /* code-only ease-enter */

    /* layout */
    --layout-reading: 768px; /* reading column */
    --layout-site: 1128px; /* header and footer content width */

    /* text styles: size / line height / tracking (web/font_primary) */
    --text-caption-1: 13px; --leading-caption-1: 18px; --tracking-caption-1: -0.13px; /* caption 1: tags */
    --text-caption-2: 14px; --leading-caption-2: 20px; --tracking-caption-2: -0.09px; /* caption 2: card notes, footer */
    --text-body-1: 15px; --leading-body-1: 22px; --tracking-body-1: -0.13px; /* body 1 */
    --text-para: 17px; --leading-para: 26px; --tracking-para: -0.22px; /* para: running text */
    --text-title-1: 17px; --leading-title-1: 26px; --tracking-title-1: -0.22px; /* title 1: text-only recipe row name */
    --text-title-2: 19px; --leading-title-2: 27px; --tracking-title-2: -0.3px; /* title 2: recipe card name */
    --text-heading-3: 32px; --leading-heading-3: 35px; --tracking-heading-3: -0.69px; /* heading 3, DM Sans */
    --text-heading-5: 52px; --leading-heading-5: 57.2px; --tracking-heading-5: -1.35px; /* heading 5, DM Sans: page h1 from 768 px */
    --text-wordmark-md: 23px; --leading-wordmark-md: 25px; --tracking-wordmark-md: -0.46px; /* logo wordmark md, DM Sans semibold */
    --text-wordmark-sm: 17px; --leading-wordmark-sm: 19px; --tracking-wordmark-sm: -0.35px; /* logo wordmark sm, DM Sans semibold */
  }`

/**
 * The Garçon mascot mark (fix-me-a-drink-web public/redesign/logo-mark.svg,
 * Figma 28397:11083) in currentColor, without the faint inner-shadow filter.
 */
export function mascotSvg(className: string) {
  return `<svg class="${className}" viewBox="0 0 34.16 32" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.67872 21.0703C6.93505 21.0368 12.7723 21.0453 12.8635 21.0724L12.8779 21.0903C12.9489 21.5682 12.9792 21.9885 12.9072 22.4724C12.78 23.3887 12.2915 24.2161 11.5505 24.7698C10.883 25.2583 10.0468 25.4575 9.23065 25.3226C8.43081 25.1882 7.71718 24.7413 7.24687 24.0805C6.59603 23.1725 6.50219 22.1429 6.67872 21.0703ZM21.4105 21.114C21.4179 21.0905 21.4273 21.0862 21.4461 21.0653C21.4824 21.0604 21.5311 21.0545 21.5762 21.0547C23.5754 21.0696 25.5755 21.0558 27.5749 21.06C27.5853 21.0699 27.5956 21.08 27.606 21.0898C27.7716 22.1799 27.6599 23.169 26.9876 24.078C26.4939 24.7551 25.7497 25.2064 24.9211 25.3307C22.4895 25.6801 20.9112 23.3595 21.4105 21.114ZM16.2824 0.0157036C16.4637 -0.0156354 17.1329 0.0137734 17.3488 0.0137505C18.5712 0.0101285 19.7935 0.0528801 21.0129 0.14168C21.7536 0.198479 22.5251 0.266243 23.2433 0.462969C24.2757 0.745719 25.3286 1.5341 25.5978 2.61629C25.7767 3.33563 25.7061 4.23735 25.7043 4.98934C25.7011 5.91537 25.7033 6.84167 25.7111 7.76766C26.3375 8.09441 26.3362 8.52247 26.3303 9.14656C26.3256 9.64376 26.2236 10.0457 25.718 10.2647C25.6671 10.2868 25.6601 10.3428 25.6535 10.3878C25.7164 10.5642 26.2222 10.7869 26.3986 10.8936C26.7058 11.0795 26.9943 11.2643 27.2863 11.4737C27.9467 11.9423 28.5686 12.4631 29.1457 13.0313C32.5324 16.3759 34.1274 21.2051 34.1525 25.8985L34.1515 27.9825C34.1532 29.1774 34.3007 30.2728 33.3801 31.1934C32.4527 32.1205 31.4333 31.9971 30.2472 31.9932H18.0607L7.55194 31.9923L4.28826 31.9932C3.78529 31.9935 2.94237 32.0186 2.466 31.9796C2.18162 31.9534 1.90244 31.8843 1.63885 31.7745C0.983709 31.4997 0.46673 30.9724 0.203303 30.3126C0.110083 30.0799 0.0494083 29.8354 0.0236159 29.586C-0.0180613 29.1974 0.011095 28.5313 0.0118972 28.13C0.0115985 27.3193 0.0033614 26.497 0.0128738 25.6876C0.0825917 19.7636 2.73034 13.7141 8.04608 10.7218C8.16072 10.6572 8.46758 10.5251 8.5158 10.4102C8.4812 10.2134 8.22025 10.1809 8.1076 10.0538C7.85572 9.76176 7.831 9.48422 7.82733 9.12508C7.82096 8.49595 7.82787 8.09954 8.44256 7.76277C8.47236 7.34022 8.45212 6.75382 8.45037 6.32332L8.45428 4.24422C8.45619 3.14527 8.37212 2.40845 9.16424 1.52059C10.1761 0.386566 11.6793 0.238488 13.1017 0.142657C13.7666 0.0945304 14.4325 0.0612354 15.0988 0.0420708C15.4766 0.030973 15.9127 0.0413686 16.2824 0.0157036ZM12.8644 21.0733C12.7733 21.0462 6.94101 21.0379 6.67987 21.0714C6.55201 21.0461 5.9251 21.0592 5.76287 21.0596L3.8078 21.0587C3.30857 22.7113 3.39732 24.5702 4.21991 26.1065C4.99502 27.5402 6.30306 28.6115 7.86151 29.0889C9.45512 29.5738 11.1771 29.3974 12.6389 28.5987C14.0945 27.8003 15.1749 26.4578 15.6447 24.8653C16.0075 23.621 15.9973 22.2973 15.6154 21.0587C15.2908 21.0596 12.9605 21.0423 12.8791 21.0919L12.8644 21.0733ZM30.3801 21.0636C30.0241 21.0601 27.7181 21.0212 27.6066 21.0899C27.5963 21.0801 27.5857 21.0705 27.5754 21.0606C25.5759 21.0565 23.5756 21.0697 21.5764 21.0548C21.5314 21.0546 21.4827 21.0607 21.4465 21.0655C21.4277 21.0864 21.4187 21.091 21.4113 21.1143C21.3964 21.0861 21.4069 21.1037 21.3713 21.0665C21.0873 21.044 20.6593 21.0585 20.3664 21.0596C19.7647 21.064 19.1624 21.0637 18.5607 21.0577C18.2146 22.2891 18.1211 23.3859 18.4221 24.6495C18.8039 26.2398 19.8056 27.6117 21.2043 28.4591C22.6148 29.3152 24.3095 29.5723 25.9103 29.1729C27.5209 28.7683 28.9041 27.7394 29.7551 26.3136C30.7706 24.622 30.8463 22.9237 30.3801 21.0636Z"/></svg>`
}

/** lucide-react icons as the site renders them (24 grid, stroke 2, round caps), in currentColor. */
function lucide(className: string, body: string, fill = 'none') {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
}

export const ICONS = {
  /** lucide Star: the Plus badge's leading icon (plus-badge.tsx), filled. */
  star: lucide(
    'star',
    '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    'currentColor'
  ),
  /** lucide ChevronLeft and ChevronRight, as in the recipe page's servings stepper. */
  chevronLeft: lucide('chevron', '<path d="m15 18-6-6 6-6"/>'),
  chevronRight: lucide('chevron', '<path d="m9 18 6-6-6-6"/>'),
} as const
