import { ensureDbSchema, getDbPool } from './db';

export type OidcAccount = {
  provider: string;
  providerAccountId: string;
  email?: string | null;
  name?: string | null;
  imageUrl?: string | null;
};

export async function getProviderForUser(userId: string): Promise<string | null> {
  const pool = getDbPool();
  const res = await pool.query<{ provider: string }>(
    'select provider from oidc_accounts where user_id=$1',
    [userId]
  );
  const providers = new Set(
    res.rows
      .map((row) => row.provider)
      .filter((provider): provider is string => typeof provider === 'string' && provider.length > 0)
  );
  if (providers.size === 1) {
    return providers.values().next().value ?? null;
  }
  return null;
}

export async function upsertUserForOidcAccount(account: OidcAccount): Promise<string> {
  await ensureDbSchema();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{ user_id: string }>(
      'select user_id from oidc_accounts where provider=$1 and provider_account_id=$2',
      [account.provider, account.providerAccountId]
    );

    if (existing.rowCount) {
      const userId = existing.rows[0].user_id;
      await client.query(
        'update users set email=coalesce($2, email), name=coalesce($3, name), image_url=coalesce($4, image_url), updated_at=now() where id=$1',
        [userId, account.email ?? null, account.name ?? null, account.imageUrl ?? null]
      );
      await client.query('COMMIT');
      return userId;
    }

    let userId: string | null = null;

    if (account.email) {
      const byEmail = await client.query<{ id: string }>('select id from users where email=$1', [account.email]);
      if (byEmail.rowCount) {
        userId = byEmail.rows[0].id;
      }
    }

    if (!userId) {
      const created = await client.query<{ id: string }>(
        'insert into users (email, name, image_url) values ($1, $2, $3) returning id',
        [account.email ?? null, account.name ?? null, account.imageUrl ?? null]
      );
      userId = created.rows[0].id;
    } else {
      await client.query(
        'update users set name=coalesce($2, name), image_url=coalesce($3, image_url), updated_at=now() where id=$1',
        [userId, account.name ?? null, account.imageUrl ?? null]
      );
    }

    await client.query(
      'insert into oidc_accounts (provider, provider_account_id, user_id) values ($1, $2, $3) on conflict do nothing',
      [account.provider, account.providerAccountId, userId]
    );

    await client.query('COMMIT');
    return userId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
