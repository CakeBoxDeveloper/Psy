// Пример API endpoint для Vercel
// Сохраните этот файл как api/transcribe.js на вашем Vercel проекте

import Groq from 'groq-sdk';
import formidable from 'formidable';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false,
  },
};

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const form = formidable({});
    const [fields, files] = await form.parse(req);
    
    const audioFile = files.file?.[0];
    if (!audioFile) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Read the audio file
    const audioBuffer = fs.readFileSync(audioFile.filepath);
    
    // Create a File object for Groq API
    const file = new File([audioBuffer], audioFile.originalFilename || 'audio.webm', {
      type: audioFile.mimetype || 'audio/webm'
    });

    // Transcribe using Groq Whisper
    const transcription = await groq.audio.transcriptions.create({
      file: file,
      model: 'whisper-large-v3',
      language: 'ru',
      response_format: 'json'
    });

    // Clean up temp file
    fs.unlinkSync(audioFile.filepath);

    return res.status(200).json({ text: transcription.text });
  } catch (error) {
    console.error('Transcription error:', error);
    return res.status(500).json({ error: 'Transcription failed', details: error.message });
  }
}
