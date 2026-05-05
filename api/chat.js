const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const MODELS = {
    tara:   { name: 'Тара',   system: `Ты — Тара, мастер традиционной школы тарологии...` },
    karma:  { name: 'Карма',  system: `Ты — Карма, кармолог...` },
    astra:  { name: 'Астра',  system: `Ты — Астра, астролог...` },
    eva:    { name: 'Ева',    system: `Ты — Ева, регрессолог...` },
    psyche: { name: 'Психея', system: `Ты — Психея, психолог...` },
    gera:   { name: 'Гера',   system: `Ты — Гера, нумеролог...` },
};

// Gemini использует OpenAI-совместимый endpoint
async function callGemini(messages, max_tokens, temperature) {
    const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GEMINI_KEY}`,
            },
            body: JSON.stringify({
                model: 'gemini-2.0-flash',
                messages,
                max_tokens,
                temperature,
            }),
        }
    );

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const error = new Error(err?.error?.message || 'Gemini error');
        error.status = response.status;
        throw error;
    }

    return response.json();
}

async function callGroq(messages, max_tokens, temperature) {
    const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_KEY}`,
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages,
                max_tokens,
                temperature,
            }),
        }
    );

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const error = new Error(err?.error?.message || 'Groq error');
        error.status = response.status;
        throw error;
    }

    return response.json();
}

export default async function handler(req, res) {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const { modelKey, history, max_tokens = 1024, temperature = 0.85 } = req.body;

    if (!history || !Array.isArray(history)) {
        return res.status(400).json({ error: 'Missing history' });
    }

    const model = MODELS[modelKey];
    if (!model) {
        return res.status(400).json({ error: 'Unknown model: ' + modelKey });
    }

    const messages = [
        { role: 'system', content: model.system },
        ...history,
    ];

    // Пробуем Gemini первым
    if (process.env.GEMINI_KEY) {
        try {
            const data = await callGemini(messages, max_tokens, temperature);
            return res.status(200).json({ ...data, _provider: 'gemini' });
        } catch (err) {
            // Падаем на Groq только при лимитах или серверных ошибках
            const shouldFallback = !err.status || err.status === 429 || err.status >= 500;
            if (!shouldFallback) {
                return res.status(err.status || 500).json({ error: err.message });
            }
            console.warn(`Gemini failed (${err.status}), falling back to Groq`);
        }
    }

    // Fallback — Groq
    try {
        const data = await callGroq(messages, max_tokens, temperature);
        return res.status(200).json({ ...data, _provider: 'groq' });
    } catch (err) {
        return res.status(500).json({ error: 'All providers failed: ' + err.message });
    }
}
