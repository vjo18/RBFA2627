const fs = require("fs");
const puppeteer = require("puppeteer");

const CALENDAR_URL =
  process.env.RBFA_CALENDAR_URL ||
  "https://www.rbfa.be/nl/competitie/CHP_136334/kalender";
const OUTPUT_FILE = "data_raw/match_calendar.json";

async function acceptCookieConsent(page) {
  const selectors = [
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    "#onetrust-accept-btn-handler",
    "button[aria-label*='Accepteer']",
    "button[aria-label*='Accept']",
  ];
  const allowAllLabels = [
    "allow all",
    "allow all cookies",
    "accept all",
    "accept all cookies",
    "alles accepteren",
    "alle cookies toestaan",
  ];
  const timeoutAt = Date.now() + 15_000;

  // Cookiebot is injected asynchronously and may live in a child frame. A
  // single page.$() immediately after DOMContentLoaded therefore misses the
  // dialog that RBFA currently displays in headless browsers.
  while (Date.now() < timeoutAt) {
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const button = await frame.$(selector);
        if (button) {
          await button.click();
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          return true;
        }
      }

      const clickedByText = await frame.evaluate((labels) => {
        const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
          labels.includes(candidate.textContent.trim().toLowerCase())
        );
        if (!button) return false;
        button.click();
        return true;
      }, allowAllLabels);
      if (clickedByText) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return true;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

async function revealCalendar(page) {
  // RBFA lazy-loads parts of the page when they enter the viewport. In a
  // headless browser the calendar is initially below the fold, so a plain
  // waitForSelector("select") can wait forever without ever triggering it.
  // Give the Angular application time to bootstrap before scrolling. Using
  // page.waitForSelector("select") here is not sufficient: the calendar is a
  // deferred component and does not exist until its part of the page has been
  // brought into view.
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  // Do not jump straight to the bottom. The calendar sits between the header
  // and footer, and Angular only instantiates deferred blocks which actually
  // cross the viewport. Walk through the complete document while it grows.
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let previousHeight = 0;

    for (let step = 0; step < 80; step += 1) {
      const calendarSelect = Array.from(document.querySelectorAll("select")).find(
        (select) => select.options.length >= 20
      );
      if (calendarSelect) {
        calendarSelect.scrollIntoView({ block: "center" });
        return;
      }

      window.scrollBy(0, Math.max(window.innerHeight * 0.7, 400));
      await sleep(250);

      const height = document.documentElement.scrollHeight;
      const atBottom = window.scrollY + window.innerHeight >= height - 2;
      if (atBottom && height === previousHeight) break;
      previousHeight = height;
    }
  });

  try {
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("select")).some(
          (select) => select.options.length >= 20
        ),
      { timeout: 30_000, polling: 250 }
    );
  } catch {
    const diagnostics = await page.evaluate(() => ({
      title: document.title || "zonder titel",
      selects: document.querySelectorAll("select").length,
      text: document.body?.innerText.trim().slice(0, 160) || "geen paginatekst",
    }));
    throw new Error(
      `Kalenderkeuzelijst niet geladen (titel: "${diagnostics.title}", ` +
        `${diagnostics.selects} select-elementen, tekst: "${diagnostics.text}").`
    );
  }
}

(async () => {
  console.log("🚀 Starting calendar scrape...");

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "nl-BE,nl;q=0.9" });

    console.log(`📅 Calendar: ${CALENDAR_URL}`);
    const response = await page.goto(CALENDAR_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (!response?.ok()) {
      throw new Error(`RBFA-pagina antwoordde met HTTP ${response?.status() ?? "onbekend"}.`);
    }

    const consentAccepted = await acceptCookieConsent(page);
    console.log(
      consentAccepted
        ? "🍪 Cookie consent accepted."
        : "🍪 No cookie consent dialog detected."
    );

    // RBFA's application scripts are consent-gated. Accepting Cookiebot removes
    // the dialog, but scripts skipped during the first navigation are not
    // reliably replayed. Reload with the persisted consent cookie so Angular
    // can bootstrap and render the competition page from the start.
    if (consentAccepted) {
      const reloadResponse = await page.reload({
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      if (!reloadResponse?.ok()) {
        throw new Error(
          `RBFA-pagina kon na cookie consent niet herladen worden (HTTP ${
            reloadResponse?.status() ?? "onbekend"
          }).`
        );
      }
    }

    await revealCalendar(page);

    const matchData = await page.evaluate(async () => {
      const matchesByUrl = new Map();
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      function extractMatchData() {
        let currentDate = null;
        const elements = document.querySelectorAll(".game-item, .date");

        elements.forEach((element) => {
          if (element.classList.contains("date")) {
            currentDate = element.textContent.trim();
            return;
          }

          const homeTeam =
            element.querySelector(".team:first-child .team-name")?.textContent.trim() ||
            null;
          const awayTeam =
            element.querySelector(".team.reverse .team-name")?.textContent.trim() ||
            null;
          const score = element.querySelector(".score")?.textContent.trim() || null;
          const matchLinkElement = element.querySelector(".team-score");
          const matchLink =
            matchLinkElement?.href || matchLinkElement?.closest("a")?.href;

          let homeScore = null;
          let awayScore = null;
          const scoreMatch = score?.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
          if (scoreMatch) {
            [, homeScore, awayScore] = scoreMatch;
          }

          const url = matchLink ? new URL(matchLink, window.location.origin).href : null;

          if (homeTeam && awayTeam && url && currentDate) {
            matchesByUrl.set(url, {
              url,
              date: currentDate,
              homeTeam,
              homeScore,
              awayTeam,
              awayScore,
            });
          }
        });

        return elements.length;
      }

      // The page contains other selects (for filters). The week selector has a
      // large option list; selecting the first arbitrary <select> is brittle.
      const dropdown = Array.from(document.querySelectorAll("select")).find(
        (select) => select.options.length >= 20
      );
      if (!dropdown) {
        throw new Error("Keuzelijst met kalenderweken niet gevonden.");
      }

      const optionValues = Array.from(dropdown.options, (option) => option.value);

      for (let i = 0; i < optionValues.length; i += 1) {
        dropdown.value = optionValues[i];
        dropdown.dispatchEvent(new Event("change", { bubbles: true }));

        // This mirrors the browser-console version known to work on RBFA.
        // Angular clears and repopulates the list asynchronously; two seconds
        // also covers weeks which legitimately contain no games and therefore
        // have no DOM state for a selector-based wait to observe.
        await sleep(2_000);

        const elementCount = extractMatchData();
        console.log(
          `Speeldag ${i + 1}/${optionValues.length}: ${elementCount} elementen, ` +
            `${matchesByUrl.size} unieke matchen in totaal`
        );
      }

      return Array.from(matchesByUrl.values());
    });

    if (matchData.length === 0) {
      throw new Error(
        "Geen wedstrijden gevonden; bestaand kalenderbestand is niet overschreven."
      );
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(matchData, null, 2), "utf8");

    console.log(`💾 File saved: ${OUTPUT_FILE}`);
    console.log(`📊 Total unique matches scraped: ${matchData.length}`);
    console.log("✅ Calendar scraping complete.");
  } catch (error) {
    console.error("❌ Calendar scraping failed:", error.message);
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
})();
