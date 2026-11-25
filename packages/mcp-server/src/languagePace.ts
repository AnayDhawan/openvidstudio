/**
 * Narration pace by language.
 *
 * SCRIPT.md's 2.3-2.9 words/sec is an English number. The same beat holds a different number of
 * whitespace-separated words in Hindi, Spanish or German, so a word budget written for English is
 * wrong for them. Each measured language gets the English band scaled by r, the language's median
 * words/sec over English's, measured from real edge-tts audio on one parallel corpus:
 *
 *   band = [round1(2.3 * r), round1(2.9 * r)]
 *
 * scripts/measure-language-pace.mjs produces the measurements (scripts/fixtures/pace-measurements.json)
 * and scripts/tests/language-pace.test.mjs checks the ratios below against that file. Re-measure and
 * update both when edge-tts or a voice changes.
 *
 * A language with no measurement gets the English band and a note saying so, never a guess. A script
 * written without spaces has no word count to pace, so it throws.
 */

export interface PaceBand {
  /** The primary language subtag, lower-cased: "hi" for "hi-IN". */
  language: string;
  min: number;
  max: number;
  /** True when the band comes from audio measured for this language (English included). */
  measured: boolean;
  /** Set when measured is false: says that no measured band exists. */
  note?: string;
}

/** SCRIPT.md's band, which validate_beats has always enforced. */
export const ENGLISH_PACE_MIN = 2.3;
export const ENGLISH_PACE_MAX = 2.9;

/**
 * r per measured language, from pace-measurements.json (2026-11-25, edge-tts 7.3.1; voices
 * hi-IN-MadhurNeural, es-ES-AlvaroNeural, de-DE-ChristophNeural against en-US-AndrewNeural).
 */
const MEASURED_RATIOS: Readonly<Record<string, number>> = {
  hi: 0.7929,
  es: 0.9367,
  de: 0.8033,
};

/** Scripts written without spaces between words: a whitespace word count is a character count there. */
const SPACELESS = new Set(["zh", "ja", "th", "km", "lo", "my", "yue", "cmn", "zho", "jpn", "tha", "khm", "lao", "mya"]);

const LANGUAGE_TAG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$/;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function paceBandFor(language?: string): PaceBand {
  if (language !== undefined && !LANGUAGE_TAG.test(language)) {
    throw new Error(`language "${language}" is not a BCP-47 language tag such as "en", "hi" or "pt-BR".`);
  }
  const primary = (language ?? "en").split("-")[0]!.toLowerCase();

  if (primary === "en") return { language: "en", min: ENGLISH_PACE_MIN, max: ENGLISH_PACE_MAX, measured: true };

  if (SPACELESS.has(primary)) {
    throw new Error(
      `"${language}" counts characters, not words: it is written without spaces, so a words-per-second pace band ` +
        `does not apply and a word budget would be a guess. Beat lengths must be planned by hand, from a measured ` +
        `clip or a character rate you have checked.`,
    );
  }

  const r = MEASURED_RATIOS[primary];
  if (r !== undefined) {
    return { language: primary, min: round1(ENGLISH_PACE_MIN * r), max: round1(ENGLISH_PACE_MAX * r), measured: true };
  }

  return {
    language: primary,
    min: ENGLISH_PACE_MIN,
    max: ENGLISH_PACE_MAX,
    measured: false,
    note:
      `No measured pace band for "${language}", so the English ${ENGLISH_PACE_MIN}-${ENGLISH_PACE_MAX} words/sec band ` +
      `is used as a stand-in. Treat word budgets for it as a rough guide. NARRATION.md ("Pace by language") lists the ` +
      `measured languages and how to measure another.`,
  };
}
