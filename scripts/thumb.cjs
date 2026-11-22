// Uso: node thumb.cjs <entrada.html> <saida.jpg>
const { chromium } = require('playwright')
const [, , input, output] = process.argv
;(async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 690 }, deviceScaleFactor: 0.4, colorScheme: 'light' })
    await page.goto('file://' + input, { waitUntil: 'load', timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(1200)
    await page.screenshot({ path: output, type: 'jpeg', quality: 72, timeout: 15000 })
  } finally {
    await browser.close()
  }
})().catch(err => { console.error(String(err)); process.exit(1) })
