// /api/check-payment.js
// Checks USDT TRC20 payment on Tron blockchain via TronGrid public API
// No API key required for basic usage (rate limit: 15 req/s)

const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRONGRID_BASE = 'https://api.trongrid.io';

// How long to look back for a payment (ms)
const LOOKBACK_MS = 30 * 60 * 1000; // 30 minutes

// Tolerance for amount matching (to handle rounding differences)
const AMOUNT_TOLERANCE = 0.02; // ±0.02 USDT

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { address, amount, uid } = req.body || {};

    if (!address || !amount || !uid) {
        return res.status(400).json({ error: 'Missing required fields: address, amount, uid' });
    }

    const expectedAmount = parseFloat(amount);
    if (isNaN(expectedAmount) || expectedAmount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    try {
        const found = await checkTRC20Payment(address, expectedAmount);
        if (found) {
            return res.status(200).json({ paid: true, txid: found.txid, confirmedAt: found.confirmedAt });
        } else {
            return res.status(200).json({ paid: false });
        }
    } catch (err) {
        console.error('[check-payment] Error:', err);
        return res.status(500).json({ error: 'Blockchain check failed', details: err.message });
    }
}

async function checkTRC20Payment(toAddress, expectedAmount) {
    const since = Date.now() - LOOKBACK_MS;

    // TronGrid: get TRC20 transfers TO our address
    const url = `${TRONGRID_BASE}/v1/accounts/${toAddress}/transactions/trc20` +
        `?limit=50` +
        `&contract_address=${USDT_TRC20_CONTRACT}` +
        `&only_to=true` +
        `&min_timestamp=${since}`;

    const resp = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            // Add TRON-PRO-API-KEY header if you have one (optional, increases rate limit)
            // 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY || ''
        }
    });

    if (!resp.ok) {
        throw new Error(`TronGrid responded with ${resp.status}`);
    }

    const data = await resp.json();
    const txs = data.data || [];

    for (const tx of txs) {
        // USDT TRC20 has 6 decimal places
        const receivedAmount = parseInt(tx.value || '0') / 1e6;
        const diff = Math.abs(receivedAmount - expectedAmount);

        if (diff <= AMOUNT_TOLERANCE) {
            return {
                txid: tx.transaction_id,
                confirmedAt: tx.block_timestamp,
                receivedAmount
            };
        }
    }

    return null;
}
