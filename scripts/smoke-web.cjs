// Drives the web UI in headless Chromium: sign in, walk every view, run a few
// admin actions, screenshot each step. Fails on any page error.
//   node scripts/smoke-web.cjs <baseUrl> <password> <outDir> [repo]
// CHROMIUM_PATH overrides the browser (e.g. a system Chromium).
const { chromium } = require("playwright");

(async () => {
  const [base, password, out, repoArg] = process.argv.slice(2);
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

  await page.goto(base);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Reachable").first().waitFor({ timeout: 30000 });
  await shot("1-overview");

  const repo = repoArg ?? "ShooterGame";
  await page.getByRole("listbox", { name: "Repositories" }).getByText(repo, { exact: true }).click();
  await page.getByRole("table", { name: "Branches" }).waitFor({ timeout: 60000 });
  await page.getByRole("table", { name: "Branches" }).locator("tbody tr").first().click();
  await shot("2-branches");

  await page.getByRole("tab", { name: "History" }).click();
  await page.locator(".rev-row").first().waitFor({ timeout: 30000 });
  await page.locator(".rev-row").first().click();
  await page.getByText(/^Files \(/).waitFor({ timeout: 30000 });
  await shot("3-history");

  await page.getByRole("tab", { name: "Locks" }).click();
  await page.getByRole("table", { name: "Locks" }).waitFor({ timeout: 30000 });
  await shot("4-locks");

  await page.getByRole("tab", { name: "Audit log" }).click();
  await page.getByRole("table", { name: "Audit log" }).waitFor();
  await shot("5-audit");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Overview" }).click();
  await shot("6-phone");

  await browser.close();
  if (errors.length) {
    console.error("page errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("SMOKE PASS");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
