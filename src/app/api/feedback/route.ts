import { NextRequest, NextResponse } from 'next/server';

interface FeedbackPayload {
    message: string;
    puzzleLabel: string;
    failed: boolean;
    attempts: number;
    timeMs: number;
    optimalMoves: number;
    attemptScores: number[]; // Progress per life (how many correct moves before failing)
    rating: number | null;   // Optional 1-5 star rating
}

// Simple in-memory rate limiting (resets on server restart)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 5; // max requests
const RATE_WINDOW = 60 * 1000; // per minute

function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now > entry.resetTime) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
        return false;
    }

    if (entry.count >= RATE_LIMIT) {
        return true;
    }

    entry.count++;
    return false;
}

function formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export async function POST(request: NextRequest) {
    const webhookUrl = process.env.DISCORD_FEEDBACK_WEBHOOK_URL;

    if (!webhookUrl) {
        console.error('DISCORD_FEEDBACK_WEBHOOK_URL not configured');
        return NextResponse.json(
            { error: 'Feedback not configured' },
            { status: 500 }
        );
    }

    // Rate limiting
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
        request.headers.get('x-real-ip') ||
        'unknown';

    if (isRateLimited(ip)) {
        return NextResponse.json(
            { error: 'Too many requests. Please wait before sending more feedback.' },
            { status: 429 }
        );
    }

    try {
        const body: FeedbackPayload = await request.json();

        // Validate
        if ((!body.message || body.message.trim().length === 0) && !body.rating) {
            return NextResponse.json(
                { error: 'Message or rating is required' },
                { status: 400 }
            );
        }

        if (body.message.length > 1000) {
            return NextResponse.json(
                { error: 'Message too long (max 1000 characters)' },
                { status: 400 }
            );
        }

        // Generate progress bars like the share card
        const generateProgressBars = (): string => {
            if (!body.attemptScores || body.attemptScores.length === 0) {
                if (body.failed) {
                    return '⬛'.repeat(body.optimalMoves);
                } else {
                    return '🟩'.repeat(body.optimalMoves) + '🏆';
                }
            }

            const rows: string[] = [];

            // Failed attempts
            for (const score of body.attemptScores) {
                const filledBlocks = Math.min(score, body.optimalMoves - 1);
                const remainingBlocks = body.optimalMoves - filledBlocks - 1;
                rows.push('🟥'.repeat(filledBlocks) + '❌' + '⬛'.repeat(remainingBlocks));
            }

            // If won, add the winning row
            if (!body.failed) {
                rows.push('🟩'.repeat(body.optimalMoves) + '🏆');
            }

            return rows.join('\n');
        };

        // Build Discord embed
        const embed = {
            description: `**${body.puzzleLabel}**\n${body.failed ? 'Failed' : 'Won'} | ${formatTime(body.timeMs)}`,
            color: body.failed ? 0xEF476F : 0x6AAA64, // Red for failed, green for success
            fields: [
                {
                    name: 'Message',
                    value: (body.message && body.message.trim().length > 0) ? body.message.trim().substring(0, 1000) : '(No message)',
                    inline: false,
                },
                ...(body.rating ? [{
                    name: 'Rating',
                    value: '⭐'.repeat(body.rating) + '☆'.repeat(5 - body.rating),
                    inline: false,
                }] : []),
                {
                    name: 'Attempts',
                    value: generateProgressBars(),
                    inline: false,
                },
            ],
            timestamp: new Date().toISOString(),
        };

        const discordPayload = {
            embeds: [embed],
        };

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(discordPayload),
        });

        if (!response.ok) {
            console.error('Discord webhook failed:', response.status, await response.text());
            return NextResponse.json(
                { error: 'Failed to send feedback' },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Feedback error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
