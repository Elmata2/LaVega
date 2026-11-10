import { publicScenarioTable } from "@lavega/core";
import { useAppLocale } from "../appLocale.js";
import Card from "../components/ui/Card.js";
import { Table, TableWrap, Td, Th } from "../components/ui/Table.js";
import { goalsCopy, planFmt } from "../copy/plan/index.js";

/** The public illustration: the same fixed table for everyone. No inputs, no
 *  variants, nothing derived from the user. The caption says what it is. */
export default function ScenarioTable({ id }: { id?: string }) {
  const [locale] = useAppLocale();
  const c = goalsCopy[locale].scenario;
  const fmt = planFmt(locale);
  const t = publicScenarioTable();
  const cell = (gross: number, cost: number) =>
    t.cells.find((x) => x.grossRate === gross && x.costRate === cost)!;
  return (
    <Card
      as="section"
      id={id}
      tabIndex={-1}
      aria-label={c.title}
      data-testid="plan-scenario"
      className="outline-none"
    >
      <h3 className="m-0 mb-2">{c.title}</h3>
      <p className="m-0 mb-2 text-muted text-[0.85rem]">{c.caption}</p>
      <p className="m-0 mb-3 text-[0.85rem]">{c.assumptions(t, fmt)}</p>
      <TableWrap>
        <Table data-testid="plan-scenario-table">
          <thead>
            <tr>
              <Th scope="col">
                {c.grossLabel} / {c.costLabel}
              </Th>
              {t.costs.map((cost) => (
                <Th key={cost} scope="col" numeric>
                  {fmt.pct(cost)}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.grossRates.map((gross) => (
              <tr key={gross}>
                <Th scope="row">{fmt.pct(gross)}</Th>
                {t.costs.map((cost) => {
                  const end = fmt.eur(cell(gross, cost).endCents);
                  return (
                    <Td key={cost} numeric>
                      <span aria-hidden="true">{end}</span>
                      <span className="sr-only">{c.cell(fmt.pct(gross), fmt.pct(cost), end)}</span>
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}
