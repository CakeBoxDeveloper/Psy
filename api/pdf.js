import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { sessionDate, secInterlude, secContent, secConclusion, modelsUsed, msgCount } = req.body;

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=PT+Sans:wght@400;700&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
body {
    background: #DCC9B5;
    font-family: 'PT Sans', sans-serif;
    color: #281C14;
    padding: 52px 56px;
    width: 794px;
}
.title {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 6px;
    letter-spacing: -0.3px;
}
.date {
    font-size: 13px;
    color: rgba(40,28,20,0.5);
    margin-bottom: 28px;
}
hr {
    border: none;
    border-top: 1px solid rgba(40,28,20,0.15);
    margin-bottom: 24px;
}
.section { margin-bottom: 22px; }
.label {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    color: rgba(40,28,20,0.45);
    margin-bottom: 8px;
}
.box {
    background: rgba(40,28,20,0.09);
    border-radius: 10px;
    padding: 16px 18px;
    font-size: 13px;
    line-height: 1.75;
    white-space: pre-wrap;
}
.footer {
    margin-top: 32px;
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: rgba(40,28,20,0.35);
}
</style>
</head>
<body>
<div class="title">Протокол сессии</div>
<div class="date">${sessionDate}</div>
<hr>
<div class="section">
    <div class="label">Интерлюдия</div>
    <div class="box">${secInterlude || '—'}</div>
</div>
<div class="section">
    <div class="label">Содержание</div>
    <div class="box">${secContent || '—'}</div>
</div>
<div class="section">
    <div class="label">Вывод</div>
    <div class="box">${secConclusion || '—'}</div>
</div>
<div class="footer">
    <span>Модели: ${modelsUsed || 'Тара'}</span>
    <span>${msgCount || 0} сообщений</span>
</div>
</body>
</html>`;

    let browser = null;
    try {
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="panacea-${new Date().toISOString().slice(0,10)}.pdf"`);
        res.send(pdf);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'PDF generation failed' });
    } finally {
        if (browser) await browser.close();
    }
}
