import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, getViewConfig, PgDialect } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { graphql, sql } from "ponder";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../ponder.schema";

const client = new PGlite();
const db = drizzle(client, { casing: "snake_case" });
const dialect = new PgDialect({ casing: "snake_case" });
let app: Hono;

beforeAll(async () => {
  // Use the production column types and view definitions in a fresh PostgreSQL database.
  for (const table of [schema.discreteOrder, schema.candidateDiscreteOrder, schema.conditionalOrderGenerator, schema.transaction]) {
    const { name, columns } = getTableConfig(table);
    const definitions = columns.map((column) =>
      `${dialect.sqlToQuery(sql`${column}`).sql.split('.').at(-1)} ${column.columnType === "PgEnumColumn" ? "text" : column.getSQLType()}`,
    );
    await client.exec(`create table "${name}" (${definitions.join(", ")})`);
  }
  for (const view of [schema.partOrder, schema.programmaticOrder]) {
    const { name, query } = getViewConfig(view);
    if (!query) throw new Error("The view query is missing");
    await client.exec(`create view "${name}" as ${dialect.sqlToQuery(query).sql}`);
  }
  vi.stubGlobal("PONDER_DATABASE", {
    readonlyQB: { raw: db, wrap: (query: (database: typeof db) => Promise<unknown>) => query(db) },
  });
  app = new Hono();
  app.use("/graphql", graphql({ db: db as never, schema }));
});

beforeEach(async () => {
  await client.exec("truncate discrete_order, candidate_discrete_order, conditional_order_generator, transaction");
  await client.exec(`
    insert into transaction (hash, chain_id, block_timestamp) values ('0x01', 100, 1000);
    insert into conditional_order_generator
      (event_id, chain_id, hash, owner, resolved_owner, order_type, order_status, updated_at_block, tx_hash)
      values ('parent', 100, '0x02', '0x03', '0x03', 'TWAP', 'Active', 1, '0x01');
  `);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await client.close();
});

async function insertPart(orderUid: string, validTo: number, status?: string, chainId = 100, parent = "parent") {
  const table = status ? "discrete_order" : "candidate_discrete_order";
  await client.query(`insert into ${table}
    (order_uid, chain_id, conditional_order_generator_id, sell_amount, buy_amount, fee_amount, valid_to, creation_date${status ? ", status, executed_sell_amount" : ""})
    values ($1, $2, $3, '10', '5', '0', $4, 1000${status ? ", $5, 10" : ""})`,
    [orderUid, chainId, parent, validTo, ...(status ? [status] : [])]);
}

async function queryPage(offset = 0, direction = "asc", status?: string) {
  const response = await app.request("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query($offset: Int!, $direction: String!, $status: String) {
        partOrders(where: {chainId: 100, conditionalOrderGeneratorId: "parent", status: $status},
          limit: 2, offset: $offset, orderBy: "sortKey", orderDirection: $direction) {
          items { orderUid status executedSellAmount }
          totalCount
          pageInfo { hasNextPage hasPreviousPage }
        }
        programmaticOrders(where: {chainId: 100, eventId: "parent"}) {
          items { partOrdersCount }
        }
      }`,
      variables: { offset, direction, status },
    }),
  });
  const body = await response.json() as {
    errors?: unknown;
    data: {
      partOrders: {
        items: { orderUid: string; status: string; executedSellAmount: string | null }[];
        totalCount: number;
      };
      programmaticOrders: { items: { partOrdersCount: number }[] };
    };
  };
  expect(body.errors).toBeUndefined();
  return body.data;
}

describe("unified part orders GraphQL", () => {
  it("supports Ponder SQL-client view dependency discovery", async () => {
    // Use the installed runtime parser: PostgreSQL accepting a view is not enough.
    const parserUrl = new URL("../../node_modules/ponder/dist/esm/utils/sql-parse.js", import.meta.url).href;
    const { getSQLQueryRelations } = await import(/* @vite-ignore */ parserUrl) as {
      getSQLQueryRelations: (query: string) => Promise<Set<string>>;
    };
    for (const [view, expected] of [
      [schema.partOrder, ["discrete_order", "candidate_discrete_order"]],
      [schema.programmaticOrder, ["conditional_order_generator", "transaction", "part_order"]],
    ] as const) {
      const { query } = getViewConfig(view);
      if (!query) throw new Error("The view query is missing");
      expect(await getSQLQueryRelations(dialect.sqlToQuery(query).sql)).toEqual(new Set(expected));
    }
  });

  it("returns an empty page and zero parent count before candidates are discovered", async () => {
    const result = await queryPage();
    expect(result.partOrders).toMatchObject({
      items: [], totalCount: 0,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
    expect(result.programmaticOrders.items).toEqual([{ partOrdersCount: 0 }]);
  });

  it("paginates both sources on the server with exact counts and stable ordering", async () => {
    await insertPart("b", 2000);
    await insertPart("a", 2000, "fulfilled");
    await insertPart("c", 3000);
    await insertPart("other-chain", 1000, "open", 1);
    await insertPart("other-parent", 1000, "open", 100, "other");
    const first = await queryPage();
    expect(first.partOrders).toMatchObject({
      items: [{ orderUid: "a", status: "fulfilled" }, { orderUid: "b", status: "unconfirmed", executedSellAmount: null }],
      totalCount: 3,
      pageInfo: { hasNextPage: true, hasPreviousPage: false },
    });
    expect(first.programmaticOrders.items).toEqual([{ partOrdersCount: 3 }]);
    const second = await queryPage(2);
    expect(second.partOrders).toMatchObject({
      items: [{ orderUid: "c" }], totalCount: 3,
      pageInfo: { hasNextPage: false, hasPreviousPage: true },
    });
    expect((await queryPage(0, "desc")).partOrders.items.map((item: { orderUid: string }) => item.orderUid)).toEqual(["c", "b"]);
    expect((await queryPage(4)).partOrders.items).toEqual([]);
  });

  it("prefers the discrete row without changing the count or page when a candidate is promoted", async () => {
    await insertPart("a", 2000);
    await insertPart("b", 3000);
    expect((await queryPage()).partOrders.totalCount).toBe(2);
    await insertPart("a", 2000, "fulfilled");
    // Even if both tables contain the UID, only the confirmed row is returned.
    const promoted = await queryPage();
    expect(promoted.partOrders).toMatchObject({
      items: [{ orderUid: "a", status: "fulfilled", executedSellAmount: "10" }, { orderUid: "b" }], totalCount: 2,
    });
    expect(promoted.programmaticOrders.items).toEqual([{ partOrdersCount: 2 }]);
    await client.exec("delete from candidate_discrete_order where order_uid = 'a'");
    expect(await queryPage()).toEqual(promoted);
  });

  it("filters unconfirmed separately from open and scopes deduplication to the chain", async () => {
    await insertPart("a", 2000);
    await insertPart("a", 2000, "fulfilled", 1);
    await insertPart("b", 3000, "open");
    expect((await queryPage(0, "asc", "unconfirmed")).partOrders).toMatchObject({
      items: [{ orderUid: "a", status: "unconfirmed" }], totalCount: 1,
    });
    expect((await queryPage(0, "asc", "open")).partOrders).toMatchObject({
      items: [{ orderUid: "b", status: "open" }], totalCount: 1,
    });
  });
});
