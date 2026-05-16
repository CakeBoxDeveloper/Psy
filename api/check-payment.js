// /api/check-payment.js
// Multi-chain payment checker — no API keys required
// Supported: USDT_TRC20, TRX, BTC, SOL, USDT_SOL, LTC, XRP, DOGE

const TRONGRID_BASE   = 'https://api.trongrid.io';
const BLOCKSTREAM     = 'https://blockstream.info/api';
const SOLANA_RPC      = 'https://api.mainnet-beta.solana.com';
const BLOCKCHAIR_BASE = 'https://api.blockchair.com';
const XRPL_BASE       = 'wss://xrplcluster.com'; // not used — we use HTTP
const XRPL_HTTP       = 'https://xrplcluster.com';
const DOGECHAIN       = 'https://dogechain.info/api/v1';

const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
// USDT on Solana (SPL) mint address
const USDT_SOL_MINT       = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

const LOOKBACK_MS = 30 * 60 * 1000; // 30 minutes

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { address, amount, uid, mode } = req.body || {};

    if (!address || !amount || !uid) {
        return res.status(400).json({ error: 'Missing required fields: address, amount, uid' });
    }

    const expectedAmount = parseFloat(amount);
    if (isNaN(expectedAmount) || expectedAmount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    try {
        let found = null;

        switch (mode) {
            case 'usdt_trc20': found = await checkTRC20(address, expectedAmount);    break;
            case 'trx_native': found = await checkTRX(address, expectedAmount);      break;
            case 'btc':        found = await checkBTC(address, expectedAmount);      break;
            case 'sol_native': found = await checkSOL(address, expectedAmount);      break;
            case 'usdt_sol':   found = await checkUSDTSol(address, expectedAmount);  break;
            case 'ltc':        found = await checkBlockchair('litecoin', address, expectedAmount, 1e8); break;
            case 'doge':       found = await checkDOGE(address, expectedAmount);     break;
            case 'xrp':        found = await checkXRP(address, expectedAmount);      break;
            default:           found = await checkTRC20(address, expectedAmount);    break;
        }

        if (found) {
            return res.status(200).json({ paid: true, txid: found.txid, confirmedAt: found.confirmedAt });
        }
        return res.status(200).json({ paid: false });

    } catch (err) {
        console.error('[check-payment]', mode, err.message);
        return res.status(500).json({ error: 'Blockchain check failed', details: err.message });
    }
}

// ── Helpers ───────────────────────────────────────────────

function tolerance(amount) {
    // 1% tolerance, minimum 0.01
    return Math.max(amount * 0.01, 0.01);
}

async function jsonFetch(url, opts = {}) {
    const resp = await fetch(url, { ...opts, headers: { 'Accept': 'application/json', ...(opts.headers || {}) } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
    return resp.json();
}

// ── USDT TRC20 ────────────────────────────────────────────

async function checkTRC20(toAddress, expectedAmount) {
    const since = Date.now() - LOOKBACK_MS;
    const url = `${TRONGRID_BASE}/v1/accounts/${toAddress}/transactions/trc20` +
        `?limit=50&contract_address=${USDT_TRC20_CONTRACT}&only_to=true&min_timestamp=${since}`;

    const data = await jsonFetch(url);
    for (const tx of (data.data || [])) {
        const received = parseInt(tx.value || '0') / 1e6; // USDT: 6 decimals
        if (Math.abs(received - expectedAmount) <= tolerance(expectedAmount)) {
            return { txid: tx.transaction_id, confirmedAt: tx.block_timestamp, received };
        }
    }
    return null;
}

// ── TRX native ────────────────────────────────────────────

async function checkTRX(toAddress, expectedAmount) {
    const since = Date.now() - LOOKBACK_MS;
    const url = `${TRONGRID_BASE}/v1/accounts/${toAddress}/transactions` +
        `?limit=50&only_to=true&min_timestamp=${since}`;

    const data = await jsonFetch(url);
    for (const tx of (data.data || [])) {
        const contract = tx.raw_data?.contract?.[0];
        if (contract?.type !== 'TransferContract') continue;
        const received = (contract.parameter?.value?.amount || 0) / 1e6;
        if (Math.abs(received - expectedAmount) <= tolerance(expectedAmount)) {
            return { txid: tx.txID, confirmedAt: tx.block_timestamp, received };
        }
    }
    return null;
}

// ── BTC — Blockstream (no key) ────────────────────────────

async function checkBTC(address, expectedAmount) {
    const data = await jsonFetch(`${BLOCKSTREAM}/address/${address}/txs`);
    const since = Date.now() - LOOKBACK_MS;

    for (const tx of (data || [])) {
        // Blockstream doesn't return timestamp for unconfirmed, skip those
        const ts = (tx.status?.block_time || 0) * 1000;
        if (ts < since) continue;

        // Sum outputs to our address
        const received = tx.vout
            .filter(o => o.scriptpubkey_address === address)
            .reduce((sum, o) => sum + o.value, 0) / 1e8; // satoshi → BTC

        if (Math.abs(received - expectedAmount) <= tolerance(expectedAmount)) {
            return { txid: tx.txid, confirmedAt: ts, received };
        }
    }
    return null;
}

// ── SOL native — Solana public RPC (no key) ───────────────

async function checkSOL(address, expectedAmount) {
    const since = Math.floor((Date.now() - LOOKBACK_MS) / 1000);

    // Get recent signatures
    const sigResp = await fetch(SOLANA_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'getSignaturesForAddress',
            params: [address, { limit: 30 }]
        })
    });
    const sigData = await sigResp.json();
    const sigs = (sigData.result || []).filter(s => !s.err && (s.blockTime || 0) >= since);

    for (const sig of sigs) {
        const txResp = await fetch(SOLANA_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1,
                method: 'getTransaction',
                params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
            })
        });
        const txData = await txResp.json();
        const tx = txData.result;
        if (!tx) continue;

        // Find our address index and check balance change
        const accounts = tx.transaction?.message?.accountKeys || [];
        const idx = accounts.findIndex(a => (a.pubkey || a) === address);
        if (idx === -1) continue;

        const pre  = tx.meta?.preBalances?.[idx]  || 0;
        const post = tx.meta?.postBalances?.[idx] || 0;
        const received = (post - pre) / 1e9; // lamports → SOL

        if (received > 0 && Math.abs(received - expectedAmount) <= tolerance(expectedAmount)) {
            return { txid: sig.signature, confirmedAt: (sig.blockTime || 0) * 1000, received };
        }
    }
    return null;
}

// ── USDT on Solana (SPL token) ────────────────────────────

async function checkUSDTSol(address, expectedAmount) {
    const since = Math.floor((Date.now() - LOOKBACK_MS) / 1000);

    // Get token accounts for USDT mint owned by address
    const ataResp = await fetch(SOLANA_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'getTokenAccountsByOwner',
            params: [address, { mint: USDT_SOL_MINT }, { encoding: 'jsonParsed' }]
        })
    });
    const ataData = await ataResp.json();
    const atas = (ataData.result?.value || []).map(a => a.pubkey);
    if (!atas.length) return null;

    // Check recent transactions on each ATA
    for (const ata of atas) {
        const sigResp = await fetch(SOLANA_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1,
                method: 'getSignaturesForAddress',
                params: [ata, { limit: 20 }]
            })
        });
        const sigData = await sigResp.json();
        const sigs = (sigData.result || []).filter(s => !s.err && (s.blockTime || 0) >= since);

        for (const sig of sigs) {
            const txResp = await fetch(SOLANA_RPC, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0', id: 1,
                    method: 'getTransaction',
                    params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
                })
            });
            const txData = await txResp.json();
            const tx = txData.result;
            if (!tx) continue;

            // Look for token balance changes on our ATA
            const postTokenBalances = tx.meta?.postTokenBalances || [];
            const preTokenBalances  = tx.meta?.preTokenBalances  || [];

            for (const post of postTokenBalances) {
                if (post.mint !== USDT_SOL_MINT) continue;
                const pre = preTokenBalances.find(p => p.accountIndex === post.accountIndex);
                const postAmt = parseFloat(post.uiTokenAmount?.uiAmountString || '0');
                const preAmt  = parseFloat(pre?.uiTokenAmount?.uiAmountString  || '0');
                const received = postAmt - preAmt;

                if (received > 0 && Math.abs(received - expectedAmount) <= tolerance(expectedAmount)) {
                    return { txid: sig.signature, confirmedAt: (sig.blockTime || 0) * 1000, received };
                }
            }
        }
    }
    return null;
}

// ── LTC — Blockchair (no key, 30 req/day free) ────────────

async function checkBlockchair(chain, address, expectedAmount, divisor) {
    const url = `${BLOCKCHAIR_BASE}/${chain}/dashboards/address/${address}?limit=10`;
    const data = await jsonFetch(url);
    const txids = data.data?.[address]?.transactions || [];
    const since = Date.now() - LOOKBACK_MS;

    for (const txid of txids.slice(0, 10)) {
        const txData = await jsonFetch(`${BLOCKCHAIR_BASE}/${chain}/dashboards/transaction/${txid}`);
        const tx = txData.data?.[txid];
        if (!tx) continue;

        const ts = new Date(tx.transaction?.time || 0).getTime();
        if (ts < since) continue;

        const received = (tx.outputs || [])
            .filter(o => o.recipient === address)
            .reduce((sum, o) => sum + (o.value || 0), 0) / divisor;

        if (Math.abs(received - expectedAmount) <= tolerance(expectedAmount)) {
            return { txid, confirmedAt: ts, received };
        }
    }
    return null;
}

// ── DOGE — Dogechain public API ───────────────────────────

async function checkDOGE(address, expectedAmount) {
    const data = await jsonFetch(`${DOGECHAIN}/address/transactions/${address}`);
    const txs = data.transactions || [];
    const since = Date.now() - LOOKBACK_MS;

    for (const tx of txs.slice(0, 20)) {
        const ts = (tx.time || 0) * 1000;
        if (ts < since) continue;

        const received = (tx.outputs || [])
            .filter(o => o.address === address)
            .reduce((sum, o) => sum + parseFloat(o.value || '0'), 0);

        if (Math.abs(received - expectedAmount) <= tolerance(expectedAmount)) {
            return { txid: tx.hash, confirmedAt: ts, received };
        }
    }
    return null;
}

// ── XRP — XRPL public HTTP API ────────────────────────────

async function checkXRP(address, expectedAmount) {
    const since = Date.now() - LOOKBACK_MS;

    const resp = await fetch(XRPL_HTTP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            method: 'account_tx',
            params: [{ account: address, limit: 30, forward: false }]
        })
    });
    const data = await resp.json();
    const txs = data.result?.transactions || [];

    for (const entry of txs) {
        const tx = entry.tx;
        if (!tx || tx.TransactionType !== 'Payment') continue;
        if (tx.Destination !== address) continue;

        // Ripple epoch starts 2000-01-01, Unix epoch 1970-01-01 → offset 946684800
        const ts = ((tx.date || 0) + 946684800) * 1000;
        if (ts < since) continue;

        // Amount can be string (XRP in drops) or object (IOU token)
        if (typeof tx.Amount !== 'string') continue; // skip IOU
        const received = parseInt(tx.Amount) / 1e6; // drops → XRP

        if (Math.abs(received - expectedAmount) <= tolerance(expectedAmount)) {
            return { txid: tx.hash, confirmedAt: ts, received };
        }
    }
    return null;
}
