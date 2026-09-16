import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { sql } from "ponder";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { candidateDiscreteOrder, conditionalOrderGenerator } from "../../ponder.schema";
import { ponder } from "../__mocks__/ponder-registry";
import { TimeoutError } from "../../src/application/helpers/withTimeout";
import { BALANCE_ERC20, KIND_SELL } from "../../src/application/helpers/orderUid";
import "../../src/application/handlers/block/orderDiscoveryPoller";
import config from "../../ponder.config";

const handler = ponder.on.mock.calls.find(([name]) => name === "OrderDiscoveryPoller:block")![1];
const client = new PGlite();
const statements: string[] = [];
const db = drizzle(client, { casing: "snake_case", logger: { logQuery: (query) => statements.push(query) } });
const multicall = vi.fn();
const address = "0x0000000000000000000000000000000000000001";
const bytes32 = `0x${"00".repeat(32)}`;
const order = {
  sellToken: address, buyToken: address, receiver: address,
  sellAmount: 10n, buyAmount: 5n, feeAmount: 0n, validTo: 1999,
  appData: bytes32, kind: KIND_SELL, partiallyFillable: false,
  sellTokenBalance: BALANCE_ERC20, buyTokenBalance: BALANCE_ERC20,
};
const run = () => handler({
  event: { block: { number: 100n, timestamp: 1000n } },
  context: { chain: { id: 43114 }, db: { sql: db }, client: { multicall } },
});

beforeAll(async () => {
  const dialect = new PgDialect({ casing: "snake_case" });
  for (const table of [conditionalOrderGenerator, candidateDiscreteOrder]) {
    const { name, columns, primaryKeys } = getTableConfig(table);
    const definitions = columns.map((column) =>
      `${dialect.sqlToQuery(sql`${column}`).sql.split('.').at(-1)} ${column.columnType === "PgEnumColumn" ? "text" : column.getSQLType()}`,
    );
    definitions.push(`primary key (${primaryKeys[0]!.columns.map((c) => `"${c.name}"`).join(", ")})`);
    await client.exec(`create table "${name}" (${definitions.join(", ")})`);
  }
});

beforeEach(async () => {
  await client.exec("truncate conditional_order_generator, candidate_discrete_order");
  statements.length = 0;
  multicall.mockReset();
  multicall.mockImplementation(async ({ contracts }) => contracts.map(() => ({ status: "success", result: [order, "0x"] })));
});
afterAll(() => client.close());

async function seed(id: string, type = "PerpetualSwap", handlerAddress = address, chainId = 43114) {
  await client.query(`insert into conditional_order_generator
    (event_id, chain_id, owner, handler, salt, static_input, order_type, order_status,
     all_candidates_known, next_check_block, last_check_block, consecutive_try_next_block, updated_at_block)
    values ($1, $2, $3, $4, $5, '0x', $6, 'Active', false, 0, 0, 0, 1)`,
    [id, chainId, address, handlerAddress, bytes32, type]);
}

it("batches 200 successes, deduplicates UIDs, and leaves the same generator ID on other chains untouched", async () => {
  for (let i = 0; i < 200; i++) await seed(`generator-${i}`);
  await seed("generator-0", "PerpetualSwap", address, 42161);
  statements.length = 0;
  await run();
  expect(statements.filter((q) => /^(insert|update)/.test(q))).toHaveLength(3);
  expect((await client.query("select * from candidate_discrete_order")).rows).toHaveLength(1);
  expect((await client.query("select * from conditional_order_generator where chain_id = 43114 and last_check_block = 100")).rows).toHaveLength(200);
  expect((await client.query("select updated_at_block from conditional_order_generator where chain_id = 42161")).rows[0]).toEqual({ updated_at_block: "1" });
  statements.length = 0;
  await client.exec("update conditional_order_generator set next_check_block = 0, updated_at_block = 2 where chain_id = 43114");
  await run();
  expect((await client.query("select * from candidate_discrete_order")).rows).toHaveLength(1);
  expect((await client.query("select * from conditional_order_generator where updated_at_block != 2 and chain_id = 43114")).rows).toHaveLength(0);
});

it("marks only single-shot successes complete for discovery", async () => {
  await seed("single", "GoodAfterTime");
  await seed("recurring");
  await run();
  const { rows } = await client.query("select event_id, all_candidates_known, next_check_block from conditional_order_generator order by event_id");
  expect(rows).toEqual([
    { event_id: "recurring", all_candidates_known: false, next_check_block: "136" },
    { event_id: "single", all_candidates_known: true, next_check_block: "136" },
  ]);
});

it("keeps transient failure backoff separate from successful batch updates", async () => {
  await seed("success");
  await seed("failure");
  await client.exec("update conditional_order_generator set last_check_block = 1 where event_id = 'failure'");
  multicall.mockResolvedValue([
    { status: "success", result: [order, "0x"] },
    { status: "failure", error: new Error("temporary") },
  ]);
  await run();
  const { rows } = await client.query("select event_id, last_poll_result, consecutive_try_next_block from conditional_order_generator order by event_id");
  expect(rows).toEqual([
    { event_id: "failure", last_poll_result: "tryNextBlock", consecutive_try_next_block: 1 },
    { event_id: "success", last_poll_result: "success", consecutive_try_next_block: 0 },
  ]);
});

it("does not call RPC for an empty batch or write after a timeout", async () => {
  await run();
  expect(multicall).not.toHaveBeenCalled();
  await seed("supported");
  statements.length = 0;
  multicall.mockRejectedValue(new TimeoutError("test", 1));
  await run();
  expect(statements.filter((q) => /^(insert|update)/.test(q))).toHaveLength(0);
});

it("targets five-second status checks and sixty-second discovery", () => {
  expect(config.blocks.CandidateConfirmer.chain.arbitrum?.interval).toBe(17);
  expect(config.blocks.OrderStatusTracker.chain.arbitrum?.interval).toBe(17);
  expect(config.blocks.OrderDiscoveryPoller.chain.arbitrum?.interval).toBe(200);
  expect(config.blocks.CandidateConfirmer.chain.avalanche?.interval).toBe(5);
  expect(config.blocks.OrderDiscoveryPoller.chain.avalanche?.interval).toBe(55);
  expect(config.blocks.CandidateConfirmer.chain.mainnet?.interval).toBe(1);
});
