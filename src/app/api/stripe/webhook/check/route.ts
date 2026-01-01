import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/server/db';
import { jsonError } from '@/lib/server/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get('id');
  const pool = getDbPool();

  if (!eventId) {
    return jsonError(400, 'MISSING_ID', 'Missing id query parameter');
  }

  try {
    // Check if we received the specific event ID triggered by the check runner
    const result = await pool.query(
      `SELECT id FROM stripe_events 
       WHERE id = $1 AND type = 'payment_intent.created'
       LIMIT 1`,
      [eventId]
    );

    if (result.rowCount && result.rowCount > 0) {
      return NextResponse.json({ ok: true, message: 'Webhook check passed' });
    } else {
      // Return 404 to signal not found (runner will retry)
      return jsonError(404, 'EVENT_NOT_FOUND', 'Event not found yet');
    }
  } catch (error) {
    console.error('Webhook check error:', error);
    return jsonError(500, 'INTERNAL_ERROR', 'Database error during webhook check');
  }
}
