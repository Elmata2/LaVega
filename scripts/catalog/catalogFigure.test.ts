import { describe, expect, it } from "vitest";
import {
  buildFigurePrompt,
  FIGURE_TOOL,
  parseFigureReply,
  type FigureRequest,
} from "./catalogFigure.js";

const feeText = [
  "Tarieven ING Creditcard",
  "De ING Creditcard kost € 4,00 per maand voor het houden van de kaart.",
  "Een geldopname in het buitenland kost € 40,00 per transactie.",
].join("\n");

const req = (over: Partial<FigureRequest> = {}): FigureRequest => ({
  product: "ING Creditcard",
  issuer: "ING Bank N.V.",
  field: "accountFee",
  sourceUrl: "https://www.ing.nl/tarieven",
  text: feeText,
  ...over,
});

const feeReply = {
  value: 4,
  period: "maand",
  conditions: "Geldt voor het houden van de kaart.",
  conditionsKnown: true,
  quote: "De ING Creditcard kost € 4,00 per maand voor het houden van de kaart.",
};

describe("parseFigureReply", () => {
  it("a monthly fee with a verbatim quote is parsed with its period", () => {
    expect(parseFigureReply(feeReply, req())).toEqual({
      value: 4,
      period: "maand",
      conditions: "Geldt voor het houden van de kaart.",
      conditionsKnown: true,
      quote: feeReply.quote,
    });
  });

  it("a fee without a period is rejected", () => {
    const { period: _p, ...noPeriod } = feeReply;
    expect(parseFigureReply(noPeriod, req())).toBeNull();
  });

  it("a quote that is not in the text is rejected", () => {
    expect(
      parseFigureReply(
        { ...feeReply, quote: "De ING Creditcard kost € 4,00 per maand en dat is veel." },
        req(),
      ),
    ).toBeNull();
  });

  it("a quote for the amount 40 does not yield a fee of 4", () => {
    expect(
      parseFigureReply(
        {
          ...feeReply,
          quote: "Een geldopname in het buitenland kost € 40,00 per transactie.",
        },
        req(),
      ),
    ).toBeNull();
  });

  it("points per euro are parsed with a points quote", () => {
    const text = "Met de ING Creditcard Extra spaar je 2 punten per euro die je uitgeeft.";
    const r = parseFigureReply(
      {
        value: 2,
        conditions: "Op alle aankopen.",
        conditionsKnown: true,
        quote: "spaar je 2 punten per euro die je uitgeeft.",
      },
      req({ field: "pointsPerEuro", text }),
    );
    expect(r).toMatchObject({ value: 2, conditionsKnown: true });
    expect(r?.period).toBeUndefined();
  });

  it("cashback is parsed with a cashback quote", () => {
    const text = "Met de Gold Card krijg je 1,5% cashback op al je aankopen.";
    const r = parseFigureReply(
      {
        value: 1.5,
        conditions: "Op alle aankopen.",
        conditionsKnown: true,
        quote: "krijg je 1,5% cashback op al je aankopen.",
      },
      req({ field: "cashbackPct", text }),
    );
    expect(r).toMatchObject({ value: 1.5 });
  });

  it("a reply without known conditions is not covered", () => {
    expect(parseFigureReply({ ...feeReply, conditionsKnown: false }, req())).toMatchObject({
      value: 4,
      conditionsKnown: false,
    });
    expect(
      parseFigureReply({ ...feeReply, conditions: null, conditionsKnown: true }, req()),
    ).toMatchObject({ conditions: null, conditionsKnown: false });
  });

  it("no conditions are claimed only with the stated basis", () => {
    expect(
      parseFigureReply(
        { ...feeReply, conditions: null, conditionsKnown: true, unconditionalBasis: "stated" },
        req(),
      ),
    ).toMatchObject({ conditions: null, conditionsKnown: true });
  });

  it("a quote from a shared document must name the product", () => {
    const text = "ING Go kost € 4,00 per maand. ING More kost € 9,00 per maand.";
    const r = parseFigureReply(
      {
        ...feeReply,
        quote: "ING More kost € 9,00 per maand.",
        value: 9,
      },
      req({ product: "ING Go", issuer: "ING", text, siblings: ["ING More"] }),
    );
    expect(r).toBeNull();
  });

  it("a reported fee of 0 is rejected, whatever the quote", () => {
    const text = "Jaarbijdrage: gratis. Kosten per maand: € 0,00 voor de ING Creditcard.";
    for (const quote of [
      "Jaarbijdrage: gratis",
      "Kosten per maand: € 0,00 voor de ING Creditcard",
    ]) {
      expect(
        parseFigureReply(
          {
            value: 0,
            period: "maand",
            conditions: null,
            conditionsKnown: true,
            unconditionalBasis: "stated",
            quote,
          },
          req({ text }),
        ),
        quote,
      ).toBeNull();
    }
  });

  it("a malformed reply is rejected", () => {
    expect(parseFigureReply(null, req())).toBeNull();
    expect(parseFigureReply({ ...feeReply, value: "4" }, req())).toBeNull();
    expect(parseFigureReply({ ...feeReply, value: -1 }, req())).toBeNull();
    expect(parseFigureReply({ ...feeReply, period: "week" }, req())).toBeNull();
  });
});

describe("buildFigurePrompt", () => {
  it("the prompt names the product, the issuer and the field in plain words", () => {
    const { system, user } = buildFigurePrompt(req());
    expect(user).toContain("ING Creditcard");
    expect(user).toContain("ING Bank N.V.");
    expect(system).toContain("fee");
    expect(system).toContain(FIGURE_TOOL.name);
    expect(system).toMatch(/promotion|promotional|first-year/i);
    expect(system).toMatch(/do not call the tool/i);
    expect(buildFigurePrompt(req({ field: "pointsPerEuro" })).system).toContain("points");
    expect(buildFigurePrompt(req({ field: "cashbackPct" })).system).toContain("cashback");
  });

  it("the fee prompt asks for a non-zero fee only and says free is not reported", () => {
    const { system } = buildFigurePrompt(req());
    expect(system).toMatch(/only when the document states a non-zero amount/i);
    expect(system).toMatch(/free or states no fee, do not call the tool/i);
    expect(buildFigurePrompt(req({ field: "pointsPerEuro" })).system).not.toMatch(/non-zero/i);
  });

  it("the tool is named report_figure", () => {
    expect(FIGURE_TOOL.name).toBe("report_figure");
  });
});

describe("the neighbour product and the points rate", () => {
  it("the user message lists the other products of the issuer and asks for the name", () => {
    const { user } = buildFigurePrompt(
      req({ others: ["ING Creditcard Platinum"], requireName: true }),
    );
    expect(user).toContain("Other products of the same issuer: ING Creditcard Platinum");
    expect(user).toContain("MUST include the header, row label or name that names ING Creditcard");
    expect(buildFigurePrompt(req()).user).not.toContain("MUST include");
  });

  it("the points prompt says how a rate per another amount is read, and no longer says never convert", () => {
    const { system } = buildFigurePrompt(req({ field: "pointsPerEuro" }));
    expect(system).toMatch(/divided\s+by that amount/);
    expect(system).not.toMatch(/never compute, convert/i);
  });

  it("1 punt per € 2 is read as 0.5 and not as 1", () => {
    const doc = "Met de Kaart spaar je 1 punt per € 2 besteed. Punten zijn onbeperkt geldig.";
    const r = req({ field: "pointsPerEuro", text: doc });
    const body = {
      conditions: "Punten zijn onbeperkt geldig",
      conditionsKnown: true,
      quote: "spaar je 1 punt per € 2 besteed",
    };
    expect(parseFigureReply({ ...body, value: 1 }, r)).toBeNull();
    expect(parseFigureReply({ ...body, value: 0.5 }, r)).toMatchObject({ value: 0.5 });
  });
});
