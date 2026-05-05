const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const VOICES = {
    tara:   { name: 'ru-RU-Wavenet-C', pitch: 0,    speakingRate: 0.95 },
    karma:  { name: 'ru-RU-Wavenet-A', pitch: -2,   speakingRate: 0.90 },
    astra:  { name: 'ru-RU-Wavenet-E', pitch: 1,    speakingRate: 1.0  },
    eva:    { name: 'ru-RU-Wavenet-C', pitch: -1,   speakingRate: 0.88 },
    psyche: { name: 'ru-RU-Wavenet-A', pitch: 0,    speakingRate: 0.93 },
    gera:   { name: 'ru-RU-Wavenet-E', pitch: 2,    speakingRate: 1.0  },
};

export default async function handler(req, res) {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const { text, modelKey } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });

    const voice = VOICES[modelKey] || VOICES.tara;

    const response = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: { text },
                voice: {
                    languageCode: 'ru-RU',
                    name: voice.name,
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    pitch: voice.pitch,
                    speakingRate: voice.speakingRate,
                },
            }),
        }
    );

    const data = await response.json();
    if (!response.ok) {
        return res.status(response.status).json({ error: data?.error?.message });
    }

    // Return base64 audio
    res.status(200).json({ audio: data.audioContent });
}
