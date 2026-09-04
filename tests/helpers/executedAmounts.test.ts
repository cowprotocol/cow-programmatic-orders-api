import { describe, expect, it, vi } from "vitest";
import type { Context } from "ponder:registry";

vi.mock("ponder:schema", () => ({
  conditionalOrderGenerator: {
    eventId: "eventId",
    chainId: "chainId",
    orderType: "orderType",
    status: "status",
    allCandidatesKnown: "allCandidatesKnown",
  },
  discreteOrder: {
    conditionalOrderGeneratorId: "conditionalOrderGeneratorId",
    chainId: "chainId",
    executedSellAmount: "executedSellAmount",
    executedBuyAmount: "executedBuyAmount",
    executedFee: "executedFee",
    status: "status",
  },
  candidateDiscreteOrder: {
    conditionalOrderGeneratorId: "conditionalOrderGeneratorId",
    chainId: "chainId",
  },
}));

vi.mock("ponder", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  // The aggregate fragments call .as(alias) — required so the three sum columns
  // get distinct names (see refreshTwapExecutionState).
  sql: vi.fn(() => ({ as: vi.fn((alias: string) => ({ alias })) })),
}));

import { refreshTwapExecutionState } from "../../src/application/helpers/executedAmounts";

function generator(
  eventId: string,
  overrides: Partial<{
    orderType: string;
    status: string;
    allCandidatesKnown: boolean;
  }> = {},
) {
  return {
    eventId,
    orderType: "TWAP",
    status: "Active",
    allCandidatesKnown: true,
    ...overrides,
  };
}

function totals(
  generatorId: string,
  overrides: Partial<{ partCount: number; openPartCount: number }> = {},
) {
  return {
    generatorId,
    executedSellAmount: "100",
    executedBuyAmount: "90",
    executedFee: "2",
    partCount: 2,
    openPartCount: 1,
    ...overrides,
  };
}

/** Fake context: the first select resolves the generator-type lookup, the
 *  second (with .groupBy) resolves the per-generator aggregate. */
function makeContext(
  generators: {
    eventId: string;
    orderType: string;
    status: string;
    allCandidatesKnown: boolean;
  }[],
  totals: {
    generatorId: string;
    executedSellAmount: string;
    executedBuyAmount: string;
    executedFee: string;
    partCount: number;
    openPartCount: number;
  }[],
  candidateGeneratorIds: string[] = [],
) {
  let selectCalls = 0;
  const groupBy = vi
    .fn()
    .mockResolvedValueOnce(totals)
    .mockResolvedValueOnce(
      candidateGeneratorIds.map((generatorId) => ({ generatorId })),
    );
  const where = vi.fn(() => {
    selectCalls++;
    if (selectCalls === 1) return Promise.resolve(generators);
    return { groupBy };
  });
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const set = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn(() => ({ set }));

  return {
    context: { db: { sql: { select }, update } } as unknown as Context,
    select,
    update,
    set,
  };
}

describe("refreshTwapExecutionState", () => {
  it("writes totals for TWAP parents and zeros for TWAP parents without parts", async () => {
    const { context, update, set } = makeContext(
      [generator("generator-a"), generator("generator-b")],
      [totals("generator-a")],
    );

    await refreshTwapExecutionState(
      context,
      100,
      ["generator-a", "generator-a", "generator-b"],
      123n,
    );

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, expect.anything(), { chainId: 100, eventId: "generator-a" });
    expect(update).toHaveBeenNthCalledWith(2, expect.anything(), { chainId: 100, eventId: "generator-b" });
    expect(set).toHaveBeenNthCalledWith(1, {
      additionalData: {
        executedSellAmount: "100",
        executedBuyAmount: "90",
        executedFee: "2",
      },
    });
    expect(set).toHaveBeenNthCalledWith(2, {
      additionalData: {
        executedSellAmount: "0",
        executedBuyAmount: "0",
        executedFee: "0",
      },
    });
  });

  it("skips non-TWAP parents entirely", async () => {
    const { context, select, update } = makeContext(
      [
        generator("generator-swap", {
          orderType: "PerpetualSwap",
          allCandidatesKnown: false,
        }),
      ],
      [],
    );

    await refreshTwapExecutionState(context, 100, ["generator-swap"], 123n);

    expect(select).toHaveBeenCalledTimes(1); // type lookup only, no aggregate
    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing without affected parents", async () => {
    const { context, select, update } = makeContext([], []);

    await refreshTwapExecutionState(context, 100, [], 123n);

    expect(select).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("completes an active TWAP without open parts or candidates", async () => {
    const { context, set } = makeContext(
      [generator("generator-a")],
      [totals("generator-a", { openPartCount: 0 })],
    );

    const completed = await refreshTwapExecutionState(
      context,
      100,
      ["generator-a"],
      123n,
    );

    expect(completed).toEqual(["generator-a"]);
    expect(set).toHaveBeenCalledWith({
      additionalData: {
        executedSellAmount: "100",
        executedBuyAmount: "90",
        executedFee: "2",
      },
      status: "Completed",
      lastPollResult: "executionState:allTerminal",
      updatedAtBlock: 123n,
    });
  });

  it("keeps a TWAP active while a candidate remains", async () => {
    const { context, set } = makeContext(
      [generator("generator-a")],
      [totals("generator-a", { partCount: 1, openPartCount: 0 })],
      ["generator-a"],
    );

    const completed = await refreshTwapExecutionState(
      context,
      100,
      ["generator-a"],
      123n,
    );

    expect(completed).toEqual([]);
    expect(set).toHaveBeenCalledWith({
      additionalData: {
        executedSellAmount: "100",
        executedBuyAmount: "90",
        executedFee: "2",
      },
    });
  });
});
