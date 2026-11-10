import { MIN_RISK_ANSWERS } from "./thresholds.js";

export type RiskPoints = 1 | 2 | 3 | 4 | 5;

/** Five scenario questions, four options each, 1 = most loss-averse, 5 = most
 *  tolerant. A draft: the owner confirms the scale and its licence before
 *  launch. Launch must edit the UNVERIFIED marker in `source` AND the test that
 *  asserts it, together; a test fails while the licence is empty. */
export const RISK_SCALE: {
  id: "lavega-draft-1";
  source: string;
  licence: string;
  items: { id: string; options: { id: string; points: RiskPoints }[] }[];
} = {
  id: "lavega-draft-1",
  source: "UNVERIFIED: draft, owner confirms scale and licence before launch",
  licence: "LaVega original wording; no third-party questionnaire reproduced",
  items: [
    {
      id: "loss-20",
      options: [
        { id: "sell-all", points: 1 },
        { id: "sell-half", points: 2 },
        { id: "do-nothing", points: 4 },
        { id: "buy-more", points: 5 },
      ],
    },
    {
      id: "gain-vs-loss",
      options: [
        { id: "no-loss-small-gain", points: 1 },
        { id: "small-loss-medium-gain", points: 2 },
        { id: "medium-loss-big-gain", points: 4 },
        { id: "big-loss-huge-gain", points: 5 },
      ],
    },
    {
      id: "sleep",
      options: [
        { id: "worry-often", points: 1 },
        { id: "worry-sometimes", points: 2 },
        { id: "rarely-worry", points: 4 },
        { id: "never-worry", points: 5 },
      ],
    },
    {
      id: "friend-crash",
      options: [
        { id: "cash-out", points: 1 },
        { id: "wait-and-see", points: 3 },
        { id: "stay-invested", points: 4 },
        { id: "invest-more", points: 5 },
      ],
    },
    {
      id: "horizon-attitude",
      options: [
        { id: "need-it-soon", points: 1 },
        { id: "some-years", points: 2 },
        { id: "long-term", points: 4 },
        { id: "decades-no-need", points: 5 },
      ],
    },
  ],
};

/** `answers` maps an item id to the chosen option id. Unknown items and
 *  options are ignored. Mean of answered points, rounded half up. */
export function scoreTolerance(answers: Record<string, string>): {
  score: RiskPoints | null;
  answered: number;
} {
  const points: number[] = [];
  for (const item of RISK_SCALE.items) {
    const chosen = answers[item.id];
    const opt = item.options.find((o) => o.id === chosen);
    if (opt !== undefined) points.push(opt.points);
  }
  if (points.length < MIN_RISK_ANSWERS) return { score: null, answered: points.length };
  const mean = points.reduce((a, b) => a + b, 0) / points.length;
  const score = Math.min(5, Math.max(1, Math.floor(mean + 0.5))) as RiskPoints;
  return { score, answered: points.length };
}

export function toleranceBucket(score: RiskPoints): "conservative" | "balanced" | "aggressive" {
  return score <= 2 ? "conservative" : score === 3 ? "balanced" : "aggressive";
}
