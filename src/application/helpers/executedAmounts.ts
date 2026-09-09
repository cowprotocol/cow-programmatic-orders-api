import { and, eq, inArray, sql } from "ponder";
import {
  candidateDiscreteOrder,
  conditionalOrderGenerator,
  discreteOrder,
  type TwapAdditionalData,
} from "ponder:schema";
import type { Context } from "ponder:registry";

export const ZERO_TOTALS: TwapAdditionalData = {
  executedSellAmount: "0",
  executedBuyAmount: "0",
  executedFee: "0",
};

/** Rebuild TWAP parents' execution state after part-order writes.
 *  TWAP-only: every part sells the same token, so summing raw amounts is unit-safe
 *  (the orderbook reports executedFee in the sell token for sell orders). Other
 *  order types keep additionalData null — e.g. PerpetualSwap parts alternate
 *  direction, so a single sum would mix token units. */
export async function refreshTwapExecutionState(
  context: Context,
  chainId: number,
  generatorIds: string[],
  blockNumber: bigint,
): Promise<string[]> {
  const ids = [...new Set(generatorIds)];
  if (ids.length === 0) return [];

  const generators = (await context.db.sql
    .select({
      eventId: conditionalOrderGenerator.eventId,
      orderType: conditionalOrderGenerator.orderType,
      status: conditionalOrderGenerator.status,
      allCandidatesKnown: conditionalOrderGenerator.allCandidatesKnown,
    })
    .from(conditionalOrderGenerator)
    .where(
      and(
        eq(conditionalOrderGenerator.chainId, chainId),
        inArray(conditionalOrderGenerator.eventId, ids),
      ),
    )) as {
    eventId: string;
    orderType: string;
    status: string;
    allCandidatesKnown: boolean;
  }[];

  const twapIds = generators
    .filter((generator) => generator.orderType === "TWAP")
    .map((generator) => generator.eventId);
  if (twapIds.length === 0) return [];

  // The .as() aliases are load-bearing: drizzle does not auto-alias raw sql
  // fragments, so without them all three columns come back named "coalesce".
  // Ponder's context.db.sql maps result rows positionally via Object.values(row),
  // and the duplicate keys collapse — the fee sum landed in executedSellAmount
  // and the other two fields were dropped from the stored JSON.
  const rows = await context.db.sql
    .select({
      generatorId: discreteOrder.conditionalOrderGeneratorId,
      executedSellAmount: sql<string>`coalesce(sum(${discreteOrder.executedSellAmount}), 0)::text`.as("executed_sell_amount_sum"),
      executedBuyAmount: sql<string>`coalesce(sum(${discreteOrder.executedBuyAmount}), 0)::text`.as("executed_buy_amount_sum"),
      executedFee: sql<string>`coalesce(sum(${discreteOrder.executedFee}), 0)::text`.as("executed_fee_sum"),
      partCount: sql<number>`count(*)::int`.as("part_count"),
      openPartCount: sql<number>`count(*) filter (where ${discreteOrder.status} = 'open')::int`.as("open_part_count"),
    })
    .from(discreteOrder)
    .where(
      and(
        eq(discreteOrder.chainId, chainId),
        inArray(discreteOrder.conditionalOrderGeneratorId, twapIds),
      ),
    )
    .groupBy(discreteOrder.conditionalOrderGeneratorId);

  const totalsByGenerator = new Map(
    rows.map(({ generatorId, partCount, openPartCount, ...totals }) => [
      generatorId,
      { totals, partCount, openPartCount },
    ]),
  );

  const candidateGeneratorIds = new Set(
    (
      await context.db.sql
        .select({
          generatorId: candidateDiscreteOrder.conditionalOrderGeneratorId,
        })
        .from(candidateDiscreteOrder)
        .where(
          and(
            eq(candidateDiscreteOrder.chainId, chainId),
            inArray(candidateDiscreteOrder.conditionalOrderGeneratorId, twapIds),
          ),
        )
        .groupBy(candidateDiscreteOrder.conditionalOrderGeneratorId)
    ).map((row) => row.generatorId),
  );

  const completed: string[] = [];
  for (const generator of generators) {
    if (generator.orderType !== "TWAP") continue;

    const aggregate = totalsByGenerator.get(generator.eventId);
    const isComplete =
      generator.status === "Active" &&
      generator.allCandidatesKnown &&
      aggregate != null &&
      aggregate.partCount > 0 &&
      aggregate.openPartCount === 0 &&
      !candidateGeneratorIds.has(generator.eventId);
    // Orderbook reorg reconciliation can reopen a previously terminal part.
    const isReopened =
      generator.status === "Completed" &&
      ((aggregate?.openPartCount ?? 0) > 0 ||
        candidateGeneratorIds.has(generator.eventId));

    await context.db
      .update(conditionalOrderGenerator, { chainId, eventId: generator.eventId })
      .set({
        additionalData: aggregate?.totals ?? ZERO_TOTALS,
        ...(isComplete && {
          status: "Completed" as const,
          lastPollResult: "executionState:allTerminal",
          updatedAtBlock: blockNumber,
        }),
        ...(isReopened && {
          status: "Active" as const,
          lastPollResult: "executionState:reopened",
          updatedAtBlock: blockNumber,
        }),
      });

    if (isComplete) completed.push(generator.eventId);
  }

  return completed;
}
