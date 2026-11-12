import { renderToString } from "react-dom/server";
import Landing from "./views/Landing";
import { landingCopy } from "./landingCopy";
import type { Locale } from "./locale";

export { landingHead } from "./seoHead";

/** Landing markup for one locale. Built through `vite build --ssr` so defines,
 *  import.meta.env and CSS imports resolve as in the browser build. */
export function renderLanding(locale: Locale): string {
  return renderToString(<Landing locale={locale} onEnter={() => {}} />);
}

/** First text run of the landing <h1>, which the build self-checks look for in the output. */
export function heroFirstLine(locale: Locale): string {
  return landingCopy(locale).hero.lineOne;
}

export function faqQuestions(locale: Locale): string[] {
  return landingCopy(locale).faq.items.map((i) => i.q);
}
