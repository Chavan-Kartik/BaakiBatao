import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createAdapterFactory, type CleanedWhere } from 'better-auth/adapters';

/**
 * better-auth on the single table.
 *
 * better-auth's models (`user`, `session`, `account`, `verification`) each get
 * a partition — `AUTH#<model>` — with the row id as the sort key, and the row's
 * fields as top-level attributes. Lookups by id are a `GetItem`; everything
 * else is a query over the model's partition filtered in this process, which
 * is the honest trade for a demo-scale user base against not standing up a
 * relational database next to an otherwise serverless system. Sessions carry
 * a DynamoDB `ttl` at their expiry, so the partition better-auth queries most
 * does not grow without bound.
 *
 * Joins are left to better-auth's own fallback (separate queries), which is
 * what it does for any adapter without native joins.
 */
export interface AuthAdapterConfig {
  readonly tableName: string;
  readonly client?: DynamoDBClient;
}

type Row = Record<string, unknown>;

export function dynamoAuthAdapter(config: AuthAdapterConfig) {
  const doc = DynamoDBDocumentClient.from(config.client ?? new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const table = config.tableName;
  const pk = (model: string) => `AUTH#${model}`;

  async function scanModel(model: string): Promise<Row[]> {
    const rows: Row[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await doc.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk(model) },
          ExclusiveStartKey: cursor,
        }),
      );
      for (const item of page.Items ?? []) rows.push(strip(item));
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    return rows;
  }

  async function byId(model: string, id: string): Promise<Row | null> {
    const out = await doc.send(new GetCommand({ TableName: table, Key: { pk: pk(model), sk: id } }));
    return out.Item ? strip(out.Item) : null;
  }

  async function select(model: string, where: CleanedWhere[]): Promise<Row[]> {
    const idOnly = where.length === 1 && where[0]!.field === 'id' && where[0]!.operator === 'eq';
    if (idOnly) {
      const row = await byId(model, String(where[0]!.value));
      return row ? [row] : [];
    }
    const rows = await scanModel(model);
    return rows.filter((row) => matches(row, where));
  }

  async function write(model: string, row: Row): Promise<void> {
    await doc.send(
      new PutCommand({
        TableName: table,
        Item: { ...row, pk: pk(model), sk: String(row['id']), ...ttlFor(model, row) },
      }),
    );
  }

  return createAdapterFactory({
    config: {
      adapterId: 'dynamodb',
      adapterName: 'DynamoDB single table',
      supportsJSON: true,
      supportsDates: false,
      supportsBooleans: true,
      supportsArrays: true,
      supportsNumericIds: false,
    },
    adapter: () => ({
      async create({ model, data }) {
        await write(model, data);
        return data;
      },

      async findOne({ model, where }) {
        const rows = await select(model, where);
        return (rows[0] ?? null) as never;
      },

      async findMany({ model, where, limit, sortBy, offset }) {
        let rows = where && where.length > 0 ? await select(model, where) : await scanModel(model);
        if (sortBy) {
          const dir = sortBy.direction === 'asc' ? 1 : -1;
          rows = rows.sort((a, b) => compare(a[sortBy.field], b[sortBy.field]) * dir);
        }
        if (offset) rows = rows.slice(offset);
        return rows.slice(0, limit) as never;
      },

      async update({ model, where, update }) {
        const rows = await select(model, where);
        const row = rows[0];
        if (!row) return null;
        const next = { ...row, ...(update as Row) };
        await write(model, next);
        return next as never;
      },

      async updateMany({ model, where, update }) {
        const rows = await select(model, where);
        for (const row of rows) await write(model, { ...row, ...update });
        return rows.length;
      },

      async delete({ model, where }) {
        const rows = await select(model, where);
        const row = rows[0];
        if (row) await doc.send(new DeleteCommand({ TableName: table, Key: { pk: pk(model), sk: String(row['id']) } }));
      },

      async deleteMany({ model, where }) {
        const rows = await select(model, where);
        for (const row of rows) {
          await doc.send(new DeleteCommand({ TableName: table, Key: { pk: pk(model), sk: String(row['id']) } }));
        }
        return rows.length;
      },

      async count({ model, where }) {
        const rows = where && where.length > 0 ? await select(model, where) : await scanModel(model);
        return rows.length;
      },
    }),
  });
}

/** Sessions and verification tokens expire on their own clock; let DynamoDB sweep them. */
function ttlFor(model: string, row: Row): { ttl?: number } {
  if (model !== 'session' && model !== 'verification') return {};
  const expiresAt = row['expiresAt'];
  const at = typeof expiresAt === 'string' ? Date.parse(expiresAt) : expiresAt instanceof Date ? expiresAt.getTime() : NaN;
  if (!Number.isFinite(at)) return {};
  // A day of grace past expiry, so a clock-skewed reader never sees a row vanish early.
  return { ttl: Math.floor(at / 1000) + 24 * 60 * 60 };
}

function strip(item: Row): Row {
  const { pk: _pk, sk: _sk, ttl: _ttl, ...row } = item;
  return row;
}

function matches(row: Row, where: CleanedWhere[]): boolean {
  if (where.length === 0) return true;
  let result = evaluate(row, where[0]!);
  for (const clause of where.slice(1)) {
    const hit = evaluate(row, clause);
    result = clause.connector === 'OR' ? result || hit : result && hit;
  }
  return result;
}

function evaluate(row: Row, clause: CleanedWhere): boolean {
  const actual = row[clause.field];
  const { value, operator } = clause;
  const fold = (v: unknown) => (clause.mode === 'insensitive' && typeof v === 'string' ? v.toLowerCase() : v);
  switch (operator) {
    case 'in':
      return Array.isArray(value) && (value as unknown[]).map(fold).includes(fold(actual));
    case 'not_in':
      return Array.isArray(value) && !(value as unknown[]).map(fold).includes(fold(actual));
    case 'contains':
      return typeof actual === 'string' && typeof value === 'string' && (fold(actual) as string).includes(fold(value) as string);
    case 'starts_with':
      return typeof actual === 'string' && typeof value === 'string' && (fold(actual) as string).startsWith(fold(value) as string);
    case 'ends_with':
      return typeof actual === 'string' && typeof value === 'string' && (fold(actual) as string).endsWith(fold(value) as string);
    case 'ne':
      return fold(actual) !== fold(value);
    case 'gt':
      return compare(actual, value) > 0;
    case 'gte':
      return compare(actual, value) >= 0;
    case 'lt':
      return compare(actual, value) < 0;
    case 'lte':
      return compare(actual, value) <= 0;
    default:
      if (value === null) return actual === null || actual === undefined;
      return fold(actual) === fold(value);
  }
}

/** Dates arrive as ISO strings (supportsDates: false), which compare correctly as strings. */
function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date) a = a.toISOString();
  if (b instanceof Date) b = b.toISOString();
  return String(a).localeCompare(String(b));
}
