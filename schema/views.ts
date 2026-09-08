import { bigint, hex, onchainView, sql } from "ponder";
import { integer, jsonb, text } from "drizzle-orm/pg-core";
import {
  candidateDiscreteOrder,
  conditionalOrderGenerator,
  discreteOrder,
  orderStatusEnum,
  orderTypeEnum,
  transaction,
} from "./tables";

// Explicit column types keep computed fields filterable in Ponder GraphQL.
export const partOrder = onchainView("part_order", {
  orderUid: text("order_uid").notNull(),
  chainId: integer("chain_id").notNull(),
  conditionalOrderGeneratorId: text("conditional_order_generator_id").notNull(),
  status: text("status").notNull(),
  sellAmount: text("sell_amount").notNull(),
  buyAmount: text("buy_amount").notNull(),
  feeAmount: text("fee_amount").notNull(),
  validTo: integer("valid_to"),
  creationDate: bigint("creation_date").notNull(),
  executedSellAmount: bigint("executed_sell_amount"),
  executedBuyAmount: bigint("executed_buy_amount"),
  executedFee: bigint("executed_fee"),
  // Schedule order with a unique tie-breaker, unchanged by candidate promotion.
  sortKey: text("sort_key").notNull(),
}).as(sql`
  select order_uid, chain_id, conditional_order_generator_id, status::text,
    sell_amount, buy_amount, fee_amount, valid_to, creation_date,
    executed_sell_amount, executed_buy_amount, executed_fee,
    lpad(coalesce(valid_to, 0)::text, 10, '0') || ':' || order_uid || ':' || chain_id as sort_key
  from ${discreteOrder}
  union all
  select c.order_uid, c.chain_id, c.conditional_order_generator_id, 'unconfirmed'::text,
    c.sell_amount, c.buy_amount, c.fee_amount, c.valid_to, c.creation_date,
    null::numeric, null::numeric, null::numeric,
    lpad(coalesce(c.valid_to, 0)::text, 10, '0') || ':' || c.order_uid || ':' || c.chain_id
  from ${candidateDiscreteOrder} c
  left join ${discreteOrder} d on d.chain_id = c.chain_id and d.order_uid = c.order_uid
  where d.order_uid is null
`);

// Views cannot be Drizzle relation targets. Expose the parent count here so it
// uses the same deduplicated collection as the paginated parts endpoint.
export const programmaticOrder = onchainView("programmatic_order", {
  eventId: text("event_id").notNull(),
  chainId: integer("chain_id").notNull(),
  hash: hex("hash").notNull(),
  owner: hex("owner").notNull(),
  resolvedOwner: hex("resolved_owner"),
  orderType: orderTypeEnum("order_type").notNull(),
  status: orderStatusEnum("order_status").notNull(),
  updatedAtBlock: bigint("updated_at_block").notNull(),
  additionalData: jsonb("additional_data"),
  decodedParams: jsonb("decoded_params"),
  creationDate: bigint("creation_date").notNull(),
  partOrdersCount: integer("part_orders_count").notNull(),
}).as(sql`
  select g.event_id, g.chain_id, g.hash, g.owner, g.resolved_owner, g.order_type,
    g.order_status, g.updated_at_block, g.additional_data, g.decoded_params,
    tx.block_timestamp as creation_date,
    parts.part_orders_count
  from ${conditionalOrderGenerator} g
  inner join ${transaction} tx on tx.chain_id = g.chain_id and tx.hash = g.tx_hash
  cross join lateral (
    select count(*)::integer as part_orders_count from ${partOrder} p
    where p.chain_id = g.chain_id and p.conditional_order_generator_id = g.event_id
  ) parts
`);
