// The two skeptic opening sentences, defined once (prove-the-review-covered-the-diff
// design §4).
//
// The skeptic assembler (`lib/prompts/review-skeptics.mjs`) opens each prompt
// with one of these as a whole line, and the settle meter's `roleOf`
// (`lib/settle-meter.mjs`) attributes a spawn by the same line. Both import this
// module, and the direction matters: the meter must not import the assembler,
// whose imports reach `node:crypto`, outside the hooks module's Node-free walk.
//
// Imports nothing.

/** Each skeptic's published first sentence and the label the settle meter draws. */
export const SKEPTIC_ROLES = Object.freeze([
  Object.freeze({ skeptic: 'refute', sentence: 'You are a skeptical code reviewer.', label: 'refute' }),
  Object.freeze({ skeptic: 'second-opinion', sentence: 'You are an independent reviewer giving a second opinion.', label: 'second opinion' })
])
