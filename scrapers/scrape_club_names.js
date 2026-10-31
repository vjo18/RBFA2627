// Discover RBFA club IDs and official names from match and club pages.
// Run: npm run scrape:clubs
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import puppeteer from "puppeteer";

if (process.platform === "linux" && !process.env.DISPLAY && process.env.RBFA_XVFB_CHILD !== "1") {
  const result = spawnSync("xvfb-run", ["-a", process.execPath, process.argv[1]], {
    stdio: "inherit", env: { ...process.env, RBFA_XVFB_CHILD: "1" }
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const path = "data_raw/team_club_mapping.csv";
const calendar = JSON.parse(fs.readFileSync("data_raw/match_calendar.json", "utf8"));
const split = (line) => line.split(";");
const original = fs.readFileSync(path, "utf8").trim().split(/\r?\n/).slice(1).map(split);
const entries = new Map(original.map(([team, club, id, number]) => [team, { team, club, id, number }]));
const browser = await puppeteer.launch({ headless: false, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
try {
  const unresolved = () => [...entries.values()].filter(e => !e.id);
  for (const match of calendar) {
    if (!unresolved().length) break;
    if (!match.url) continue;
    try {
      await page.goto(match.url, { waitUntil: "domcontentloaded" });
      await wait(1400);
      const links = await page.evaluate(() => [...document.querySelectorAll('a[href*="/club/"][href*="/ploeg/"]')].map(a => ({
        team: a.textContent.trim().replace(/\s+/g, " "),
        href: a.getAttribute("href")
      })));
      for (const link of links) {
        const id = link.href.match(/\/club\/(\d+)\/ploeg\//)?.[1];
        const entry = entries.get(link.team);
        if (entry && id) entry.id = id;
      }
    } catch (error) { console.warn("Wedstrijd overgeslagen:", match.url, error.message); }
  }
  for (const entry of entries.values()) {
    if (!entry.id || (entry.club && entry.number)) continue;
    try {
      await page.goto(`https://www.rbfa.be/nl/club/${entry.id}/info`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => /Stamnummer\\s*\\d+/i.test(document.body?.innerText || ""),
        { timeout: 18000 }
      ).catch(() => console.warn("Stamnummer niet geladen:", entry.team));
      const info = await page.evaluate(() => {
        const text = document.body.innerText;
        const number = text.match(/Stamnummer\s*(\d+)/i)?.[1] || "";
        const candidates = [...document.querySelectorAll("h2")].map(e => e.textContent.trim()).filter(Boolean);
        const subtitle = [...document.querySelectorAll("*")].find(e => e.children.length === 0 && /Stamnummer\\s*\\d+/i.test(e.textContent || ""));
        const nearby = subtitle?.parentElement?.querySelector("h2")?.textContent?.trim()
          || subtitle?.parentElement?.parentElement?.querySelector("h2")?.textContent?.trim()
          || "";
        return { number, candidates, nearby };
      });
      // Club headings may change: only accept when exactly one plausible heading exists.
      const headings = info.candidates.filter(x =>
        x.length > 4 && !/^(info|club|ploegen|kalender|uitslagen|contact|adres|algemeen)$/i.test(x)
      );
      // The RBFA club info page shows the club name in its main h2.
      // Only accept an unambiguous heading; otherwise leave it for manual review.
      if (info.nearby) entry.club = info.nearby;
      else if (headings.length === 1) entry.club = headings[0];
      else console.warn("Controleer clubtitel:", entry.team, headings);
      if (info.number) entry.number = info.number;
      console.log(entry.team, "=>", entry.club || "(naam controleren)", entry.id);
    } catch (error) { console.warn("Club overgeslagen:", entry.team, error.message); }
  }
} finally { await browser.close(); }
const escape = value => String(value || "").replace(/[;\r\n]/g, " ").trim();
fs.writeFileSync(path, "TeamRepo;ClubRBFA;ClubID;Stamnummer\n" +
  [...entries.values()].map(e => [e.team,e.club,e.id,e.number].map(escape).join(";")).join("\n") + "\n");
console.log("Koppelingen bijgewerkt:", path);
