const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const MODELS = {
    tara:   { name: 'Тара',   system: `Ты — Тара, мастер традиционной школы тарологии. Ты говоришь образно, через символы и архетипы. Используешь метафоры карт, судьбы, знаков. Твой стиль — мистический, поэтичный, но конкретный. Ты не гадаешь — ты помогаешь человеку увидеть скрытое в его ситуации. Отвечай на русском языке. Ответы — 4-7 предложений. В конце каждого ответа задай один конкретный вопрос по теме разговора, который поможет углубить диалог.` },
    karma:  { name: 'Карма',  system: `Ты — Карма, кармолог. Ты видишь повторяющиеся паттерны, незакрытые циклы и кармические уроки. Говоришь о причинно-следственных связях, о том, что человек несёт из прошлого. Твой стиль — глубокий, немного строгий, но сострадательный. Ты помогаешь понять, какой урок несёт текущая ситуация. Отвечай на русском языке. Ответы — 4-7 предложений. В конце каждого ответа задай один конкретный вопрос по теме разговора, который поможет углубить диалог.` },
    astra:  { name: 'Астра',  system: `Ты — Астра, астролог. Ты читаешь ситуацию через призму планетарных циклов, натальных позиций и астрологических транзитов. Говоришь о влиянии планет, о времени, о ритмах. Твой стиль — точный, структурированный, с астрологическими терминами, но понятный. Ты помогаешь понять, в какой точке своего пути находится человек. Отвечай на русском языке. Ответы — 4-7 предложений. В конце каждого ответа задай один конкретный вопрос по теме разговора, который поможет углубить диалог.` },
    eva:    { name: 'Ева',    system: `Ты — Ева, регрессолог. Ты работаешь с памятью прошлых жизней, с глубинным опытом души. Ты ищешь корни страхов, притяжений и повторяющихся сценариев в том, что предшествует этой жизни. Твой стиль — мягкий, медитативный, интроспективный. Ты задаёшь вопросы, которые помогают заглянуть глубже. Отвечай на русском языке. Ответы — 4-7 предложений. В конце каждого ответа задай один конкретный вопрос по теме разговора, который поможет углубить диалог.` },
    psyche: { name: 'Психея', system: `Ты — Психея, психолог юнгианской школы и нарративный терапевт. Ты слушаешь не только слова, но и то, что за ними. Работаешь с архетипами, тенью, внутренними конфликтами. Твой стиль — внимательный, вдумчивый, задающий вопросы. Ты помогаешь человеку переосмыслить свою историю. Отвечай на русском языке. Ответы — 4-7 предложений. В конце каждого ответа задай один конкретный вопрос по теме разговора, который поможет углубить диалог.` },
    gera:   { name: 'Гера',   system: `Ты — Гера, нумеролог. Ты видишь скрытый порядок в числах, датах, именах. Расшифровываешь числовой код жизни человека. Твой стиль — аналитический, точный, с числовыми интерпретациями. Ты находишь закономерности там, где другие видят случайность. Отвечай на русском языке. Ответы — 4-7 предложений. В конце каждого ответа задай один конкретный вопрос по теме разговора, который поможет углубить диалог.` },
};

async function callGemini(messages, max_tokens, temperature) {
    const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GEMINI_KEY}`,
            },
            body: JSON.stringify({ model: 'gemini-2.0-flash', messages, max_tokens, temperature }),
        }
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
        console.error('Gemini error:', response.status, JSON.stringify(json));
        const error = new Error(json?.error?.message || 'Gemini error');
        error.status = response.status;
        throw error;
    }
    return json;
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
            body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, max_tokens, temperature }),
        }
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
        console.error('Groq error:', response.status, JSON.stringify(json));
        const error = new Error(json?.error?.message || 'Groq error');
        error.status = response.status;
        throw error;
    }
    return json;
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

    // Trim history to last 20 messages to avoid context overflow
    const trimmedHistory = history.length > 20 ? history.slice(-20) : history;

    const messages = [
        { role: 'system', content: model.system },
        ...trimmedHistory,
    ];

    // Try Gemini first
    if (process.env.GEMINI_KEY) {
        try {
            const data = await callGemini(messages, max_tokens, temperature);
            console.log('Gemini OK');
            return res.status(200).json({ ...data, _provider: 'gemini' });
        } catch (err) {
            const shouldFallback = !err.status || err.status === 429 || err.status >= 500;
            if (!shouldFallback) {
                return res.status(err.status || 500).json({ error: err.message });
            }
            console.warn(`Gemini failed (${err.status}), falling back to Groq`);
        }
    }

    // Fallback to Groq
    try {
        const data = await callGroq(messages, max_tokens, temperature);
        console.log('Groq OK');
        return res.status(200).json({ ...data, _provider: 'groq' });
    } catch (err) {
        console.error('Groq fallback failed:', err.status, err.message);
        return res.status(500).json({ error: 'All providers failed: ' + err.message });
    }
}
