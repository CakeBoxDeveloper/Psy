const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const { messages, max_tokens = 1024, temperature = 0.85 } = req.body;
    if (!messages) return res.status(400).json({ error: 'Missing messages' });

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages,
                max_tokens,
                temperature
            })
        });
        const data = await response.json();
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
}
