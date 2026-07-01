import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { chromium, type Browser, type Page } from '@playwright/test'

const outputDir = path.resolve('output/playwright')
const runtimeActionFixtureParam = 'runtimeActionFixture'
const runtimeActionFixtures = [
  { expectedText: 'Starting', id: 'pending-start' },
  { expectedText: 'Stop sent', id: 'stop-success' },
  { expectedText: 'Start failed', id: 'start-failed' },
  { expectedText: 'Stale process', id: 'stale' },
] as const
const runtimeActionFixtureScreenshots = {
  'pending-start': path.join(outputDir, 'local-suite-runtime-fixture-pending-start.png'),
  'start-failed': path.join(outputDir, 'local-suite-runtime-fixture-start-failed.png'),
  stale: path.join(outputDir, 'local-suite-runtime-fixture-stale.png'),
  'stop-success': path.join(outputDir, 'local-suite-runtime-fixture-stop-success.png'),
} satisfies Record<typeof runtimeActionFixtures[number]['id'], string>
const screenshotPaths = {
  commandPaletteDesktop: path.join(outputDir, 'local-suite-command-palette-desktop.png'),
  commandPaletteFixture: path.join(outputDir, 'local-suite-command-palette-fixture.png'),
  commandPaletteMobile: path.join(outputDir, 'local-suite-command-palette-mobile.png'),
  desktop: path.join(outputDir, 'local-suite-visual-smoke-desktop.png'),
  runtimeFixtures: runtimeActionFixtureScreenshots,
  portsDialog: path.join(outputDir, 'local-suite-visual-smoke-ports-dialog.png'),
  mobile: path.join(outputDir, 'local-suite-visual-smoke-mobile.png'),
}

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /OPENAI_API_KEY/i,
  /ghp_[A-Za-z0-9_]{20,}/,
  /password\s*=/i,
]
const blockedActionRequests: string[] = []

type SpawnedServer = {
  baseUrl: string
  process: ChildProcessWithoutNullStreams
}

async function main() {
  await mkdir(outputDir, { recursive: true })
  const externalUrl = process.env.LOCAL_SUITE_URL
  const spawned = externalUrl ? null : await spawnLocalServer()
  const baseUrl = externalUrl ?? spawned?.baseUrl

  if (!baseUrl) throw new Error('Unable to resolve Local Suite URL.')

  let browser: Browser | null = null
  try {
    await waitForSnapshot(baseUrl)
    browser = await chromium.launch()

    const desktopPage = await openCheckedPage(browser, baseUrl, { width: 1440, height: 900 })
    await desktopPage.screenshot({ fullPage: true, path: screenshotPaths.desktop })
    await assertLocalActionApprovalGate(desktopPage)
    await openCommandPalette(desktopPage)
    await assertPageSafe(desktopPage, { width: 1440, height: 900 })
    await desktopPage.screenshot({ fullPage: true, path: screenshotPaths.commandPaletteDesktop })
    await desktopPage.getByPlaceholder('Run or open').fill('pending start')
    await desktopPage.getByText('Show Pending Start').first().click()
    await desktopPage.getByText('Starting').first().waitFor({ timeout: 10_000 })
    await desktopPage.getByText('fixture').first().waitFor({ timeout: 10_000 })
    if (!desktopPage.url().includes(`${runtimeActionFixtureParam}=pending-start`)) {
      throw new Error('Fixture command did not update the runtimeActionFixture query parameter.')
    }
    await assertPageSafe(desktopPage, { width: 1440, height: 900 })
    await desktopPage.screenshot({ fullPage: true, path: screenshotPaths.commandPaletteFixture })
    await desktopPage.getByRole('button', { name: /^Ports$/ }).first().click()
    await desktopPage.getByRole('heading', { name: /^Ports$/ }).waitFor({ timeout: 10_000 })
    await desktopPage.screenshot({ fullPage: true, path: screenshotPaths.portsDialog })
    await desktopPage.close()

    const mobilePage = await openCheckedPage(browser, baseUrl, { width: 390, height: 844, isMobile: true })
    await mobilePage.screenshot({ fullPage: true, path: screenshotPaths.mobile })
    await openCommandPalette(mobilePage)
    await assertPageSafe(mobilePage, { width: 390, height: 844 })
    await mobilePage.screenshot({ fullPage: true, path: screenshotPaths.commandPaletteMobile })
    await mobilePage.close()

    for (const fixture of runtimeActionFixtures) {
      const fixturePage = await openCheckedPage(browser, urlWithSearchParam(baseUrl, runtimeActionFixtureParam, fixture.id), { width: 1440, height: 900 })
      await fixturePage.getByText(fixture.expectedText).first().waitFor({ timeout: 10_000 })
      await fixturePage.getByText('fixture').first().waitFor({ timeout: 10_000 })
      await fixturePage.screenshot({ fullPage: true, path: runtimeActionFixtureScreenshots[fixture.id] })
      await fixturePage.close()
    }

    if (blockedActionRequests.length) {
      throw new Error(`Visual smoke blocked mutating action requests:\n${blockedActionRequests.join('\n')}`)
    }

    console.log(JSON.stringify({ baseUrl, screenshots: screenshotPaths }, null, 2))
  } finally {
    await browser?.close()
    if (spawned) await stopServer(spawned.process)
  }
}

async function openCheckedPage(
  browser: Browser,
  baseUrl: string,
  viewport: { width: number; height: number; isMobile?: boolean },
): Promise<Page> {
  const context = await browser.newContext({
    isMobile: viewport.isMobile ?? false,
    viewport: { height: viewport.height, width: viewport.width },
  })
  const page = await context.newPage()
  const runtimeErrors: string[] = []

  await page.route('**/api/actions', async (route) => {
    const request = route.request()
    blockedActionRequests.push(`${request.method()} ${request.url()}`)
    await route.abort()
  })
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text())
  })
  page.on('pageerror', (error) => runtimeErrors.push(error.message))

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: /Exceptions|Local Suite/i }).waitFor({ timeout: 60_000 })
  await page.waitForTimeout(250)

  if (runtimeErrors.length) {
    throw new Error(`Browser errors:\n${runtimeErrors.join('\n')}`)
  }

  await assertPageSafe(page, viewport)

  return page
}

async function openCommandPalette(page: Page) {
  const dialog = page.getByRole('dialog', { name: /^Commands$/ })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  try {
    await dialog.waitFor({ timeout: 3_000 })
  } catch {
    await page.getByRole('button', { name: /^Commands$/ }).click()
    await dialog.waitFor({ timeout: 10_000 })
  }
  await page.getByPlaceholder('Run or open').waitFor({ timeout: 10_000 })
}

async function assertLocalActionApprovalGate(page: Page) {
  const blockedBefore = blockedActionRequests.length
  await page.getByRole('button', { name: /^Start dev$/ }).first().click()
  await page.getByRole('button', { name: /^Confirm start$/ }).first().waitFor({ timeout: 10_000 })
  await page.getByText('Click again to run locally.').first().waitFor({ timeout: 10_000 })
  if (blockedActionRequests.length !== blockedBefore) {
    throw new Error('Approval gate sent a mutating action request on first click.')
  }
}

async function assertPageSafe(
  page: Page,
  viewport: { width: number; height: number },
) {
  const hasHorizontalOverflow = await page.evaluate<boolean>('document.documentElement.scrollWidth > window.innerWidth + 1')
  if (hasHorizontalOverflow) {
    throw new Error(`Horizontal overflow at ${viewport.width}x${viewport.height}.`)
  }

  const bodyText = await page.locator('body').innerText()
  const matchedSecret = secretPatterns.find((pattern) => pattern.test(bodyText))
  if (matchedSecret) {
    throw new Error(`Secret-like text rendered: ${String(matchedSecret)}`)
  }
}

function urlWithSearchParam(baseUrl: string, key: string, value: string): string {
  const url = new URL(baseUrl)
  url.searchParams.set(key, value)
  return url.toString()
}

async function spawnLocalServer(): Promise<SpawnedServer> {
  const port = await findFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const serverProcess = spawn('pnpm', ['dev'], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'pipe',
  })

  const logs: string[] = []
  serverProcess.stdout.on('data', (chunk: Buffer) => logs.push(chunk.toString()))
  serverProcess.stderr.on('data', (chunk: Buffer) => logs.push(chunk.toString()))

  serverProcess.once('exit', (code, signal) => {
    if (code !== null && code !== 0) logs.push(`Local Suite dev server exited with ${code}.`)
    if (signal) logs.push(`Local Suite dev server exited with ${signal}.`)
  })

  await waitForSnapshot(baseUrl, () => logs.join('').slice(-4000))
  return { baseUrl, process: serverProcess }
}

async function waitForSnapshot(baseUrl: string, getLogs?: () => string) {
  const deadline = Date.now() + 60_000
  let lastError = ''

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/snapshot`, { cache: 'no-store' })
      if (response.ok) return
      lastError = `${response.status} ${response.statusText}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(`Timed out waiting for ${baseUrl}/api/snapshot. ${lastError}\n${getLogs?.() ?? ''}`)
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to allocate a local port.')))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

async function stopServer(serverProcess: ChildProcessWithoutNullStreams) {
  if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) return
  serverProcess.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (serverProcess.exitCode === null && serverProcess.signalCode === null) serverProcess.kill('SIGKILL')
      resolve()
    }, 2_000)
    serverProcess.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

await main()
