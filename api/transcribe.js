import Groq from 'groq-sdk';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // Collect raw body
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);

        // Parse multipart manually — find the audio file
        const boundary = req.headers['content-type']?.split('boundary=')[1];
        if (!boundary) return res.status(400).json({ error: 'No boundary' });

        // Extract file bytes between boundaries
        const boundaryBuf = Buffer.from(`--${boundary}`);
        const parts = [];
        let start = 0;
        while (start < buffer.length) {
            const idx = buffer.indexOf(boundaryBuf, start);
            if (idx === -1) break;
            const end = buffer.indexOf(boundaryBuf, idx + boundaryBuf.length);
            if (end === -1) break;
            parts.push(buffer.slice(idx + boundaryBuf.length, end));
            start = end;
        }

        let audioBuffer = null;
        let filename = 'audio.webm';
        for (const part of parts) {
            const headerEnd = part.indexOf('\r\n\r\n');
            if (headerEnd === -1) continue;
            const header = part.slice(0, headerEnd).toString();
            if (!header.includes('filename')) continue;
            const fnMatch = header.match(/filename="([^"]+)"/);
            if (fnMatch) filename = fnMatch[1];
            audioBuffer = part.slice(headerEnd + 4, part.length - 2);
            break;
        }

        if (!audioBuffer) return res.status(400).json({ error: 'No audio file' });

        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const file = new File([audioBuffer], filename, { type: 'audio/webm' });

        const transcription = await groq.audio.transcriptions.create({
            file,
            model: 'whisper-large-v3',
            language: 'ru',
            response_format: 'json'
        });

        return res.status(200).json({ text: transcription.text });
    } catch (err) {
        console.error('Transcribe error:', err);
        return res.status(500).json({ error: err.message });
    }
}
