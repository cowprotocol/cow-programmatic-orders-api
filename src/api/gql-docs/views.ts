import {
  DocMap,
  generatePageDocs,
  generateQueryDocs,
} from "ponder-enrich-gql-docs-middleware";
import { conditionalOrderGeneratorDocs } from "./conditional-order-generator";

export const viewDocs: DocMap = {
  partOrder:
    "A known part from discreteOrder or candidateDiscreteOrder. For each (chainId, orderUid), the discrete row takes precedence. The view has no separate storage.",
  "partOrder.orderUid": "CoW Protocol order UID. Together with chainId, identifies a unique part.",
  "partOrder.chainId": "EVM chain ID.",
  "partOrder.conditionalOrderGeneratorId": "The parent generator's eventId.",
  "partOrder.status":
    "open, fulfilled, unfilled, expired, cancelled, or unconfirmed. unconfirmed means a known candidate without a discrete row, including future scheduled parts. It does not guarantee that the part is currently executable. Other values come from discreteOrder.status.",
  "partOrder.sellAmount": "Requested sell amount as a decimal string in raw token units.",
  "partOrder.buyAmount": "Minimum buy amount as a decimal string in raw token units.",
  "partOrder.feeAmount": "Fee amount as a decimal string in raw token units.",
  "partOrder.validTo": "Expiration time in Unix seconds (UTC), as a JSON number. Null if unknown.",
  "partOrder.creationDate":
    "Observation time in Unix seconds (UTC), as a decimal string. Precomputed parts use the parent event timestamp. Use sortKey for deterministic pagination.",
  "partOrder.executedSellAmount": "Executed sell amount in raw token units, as a decimal string. Null for candidates or unavailable execution data.",
  "partOrder.executedBuyAmount": "Executed buy amount in raw token units, as a decimal string. Null for candidates or unavailable execution data.",
  "partOrder.executedFee": "Executed fee in raw token units, as a decimal string. Null for candidates or unavailable execution data.",
  "partOrder.sortKey":
    "Deterministic sort key: validTo padded to ten digits (zero if null), then orderUid and chainId, separated by colons. UID and chain break expiration ties. The key stays unchanged during candidate promotion when these values stay unchanged. Use orderBy: sortKey with an explicit orderDirection.",

  programmaticOrder:
    "A generator view with its creation timestamp and the count of all known parts. It shares the generator's status and sync cursor. The view has no separate storage.",
  "programmaticOrder.eventId": conditionalOrderGeneratorDocs["conditionalOrderGenerator.eventId"],
  "programmaticOrder.chainId": conditionalOrderGeneratorDocs["conditionalOrderGenerator.chainId"],
  "programmaticOrder.hash": conditionalOrderGeneratorDocs["conditionalOrderGenerator.hash"],
  "programmaticOrder.owner": conditionalOrderGeneratorDocs["conditionalOrderGenerator.owner"],
  "programmaticOrder.resolvedOwner": conditionalOrderGeneratorDocs["conditionalOrderGenerator.resolvedOwner"],
  "programmaticOrder.orderType": conditionalOrderGeneratorDocs["conditionalOrderGenerator.orderType"],
  "programmaticOrder.status": conditionalOrderGeneratorDocs["conditionalOrderGenerator.status"],
  "programmaticOrder.updatedAtBlock": conditionalOrderGeneratorDocs["conditionalOrderGenerator.updatedAtBlock"],
  "programmaticOrder.additionalData": conditionalOrderGeneratorDocs["conditionalOrderGenerator.additionalData"],
  "programmaticOrder.decodedParams": conditionalOrderGeneratorDocs["conditionalOrderGenerator.decodedParams"],
  "programmaticOrder.creationDate": "Parent transaction block timestamp in Unix seconds (UTC), as a decimal string.",
  "programmaticOrder.partOrdersCount":
    "Count of unique known parts for this generator and chain in partOrders, including unconfirmed candidates. Zero before discovery. Not necessarily the configured TWAP part count.",

  ...generatePageDocs("partOrder", "known part order"),
  ...generateQueryDocs("partOrder", "known part order"),
  ...generatePageDocs("programmaticOrder", "programmatic order"),
  ...generateQueryDocs("programmaticOrder", "programmatic order"),
};
