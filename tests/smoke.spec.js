const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { test, expect } = require("@playwright/test");

const fixtureDir = path.join(os.tmpdir(), "contrast-evidence-fixtures");
const pngPath = path.join(fixtureDir, "contrast-sample.png");
const pdfPath = path.join(fixtureDir, "contrast-sample.pdf");

test.beforeAll(() => {
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(pngPath, makePngFixture(900, 520));
  fs.writeFileSync(pdfPath, makePdfFixture());
});

test("uploads an image, marks checks, and exports a report", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(pngPath);
  await expect(page.locator(".sourceCard")).toHaveCount(1);

  await drawCheck(page);
  await expect(page.locator(".sampleCard")).toHaveCount(1);
  await expect(page.locator(".ratio")).toContainText(":1");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportButton").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/contrast-evidence-.*\.pdf/);
  const exportPath = path.join(fixtureDir, "single-check-report.pdf");
  await download.saveAs(exportPath);
  expect(countPdfPages(exportPath)).toBe(2);
});

test("opens an extracted snippet full screen for color picking", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(pngPath);
  await expect(page.locator(".sourceCard")).toHaveCount(1);

  await drawCheck(page, [75, 320, 715, 438]);
  await expect(page.locator(".sampleCard")).toHaveCount(1);

  await page.locator(".openSnippetButton").click();
  await expect(page.locator("#snippetDialog")).toBeVisible();

  await page.locator("#snippetPickBgButton").click();
  const canvas = page.locator("#snippetCanvas");
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box.x + 12, box.y + 12);
  await expect(page.locator("#snippetBgValue")).toHaveText("#001C3E");
  await expect(page.locator(".bgInput")).toHaveValue("#001C3E");

  await page.locator("#closeSnippetButton").click();
  await expect(page.locator("#snippetDialog")).not.toBeVisible();
});

test("sidebar native color pickers update their corresponding hex inputs", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(pngPath);
  await expect(page.locator(".sourceCard")).toHaveCount(1);

  await drawCheck(page);
  await expect(page.locator(".sampleCard")).toHaveCount(1);

  await setNativeColor(page, ".fgColorInput", "#112233");
  await expect(page.locator(".fgInput")).toHaveValue("#112233");
  await expect(page.locator(".bgInput")).not.toHaveValue("#112233");

  await setNativeColor(page, ".bgColorInput", "#445566");
  await expect(page.locator(".bgInput")).toHaveValue("#445566");
  await expect(page.locator(".fgInput")).toHaveValue("#112233");
});

test("exports long check tables across PDF pages", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(pngPath);
  await expect(page.locator(".sourceCard")).toHaveCount(1);

  for (const rect of [
    [95, 115, 575, 145],
    [95, 175, 495, 205],
    [95, 235, 625, 265],
    [95, 340, 610, 365],
    [95, 385, 570, 410],
    [75, 320, 715, 438]
  ]) {
    await drawCheck(page, rect);
  }
  await expect(page.locator(".sampleCard")).toHaveCount(6);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportButton").click();
  const download = await downloadPromise;
  const exportPath = path.join(fixtureDir, "multi-check-report.pdf");
  await download.saveAs(exportPath);
  expect(countPdfPages(exportPath)).toBe(3);
});

test("imports a selected PDF page as a source", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(pdfPath);
  await expect(page.locator("#pdfDialog")).toBeVisible();
  await page.locator("#importPdfPagesButton").click();
  await expect(page.locator(".sourceCard")).toHaveCount(1);
  await expect(page.locator(".sourceMeta")).toContainText("pdf page");
});

async function drawCheck(page, rect = [190, 210, 640, 315]) {
  const canvas = page.locator("#overlayCanvas");
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  const [x1, y1, x2, y2] = rect;
  await page.mouse.move(box.x + x1, box.y + y1, { steps: 5 });
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 10 });
  await page.mouse.up();
}

async function setNativeColor(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

function countPdfPages(filePath) {
  const pdf = fs.readFileSync(filePath, "latin1");
  return (pdf.match(/\/Type\s*\/Page\b/g) || []).length;
}

function makePngFixture(width, height) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      let color = [0x15, 0x57, 0xa6, 0xff];
      if (x >= 70 && x <= 720 && y >= 315 && y <= 440) color = [0xff, 0xf2, 0x00, 0xff];
      if (
        (x >= 90 && x <= 580 && y >= 110 && y <= 145) ||
        (x >= 90 && x <= 500 && y >= 170 && y <= 205) ||
        (x >= 90 && x <= 630 && y >= 230 && y <= 265)
      ) color = [0xff, 0xff, 0xff, 0xff];
      if (
        (x >= 100 && x <= 610 && y >= 340 && y <= 365) ||
        (x >= 100 && x <= 570 && y >= 385 && y <= 410)
      ) color = [0x00, 0x1c, 0x3e, 0xff];
      const i = 1 + x * 4;
      row[i] = color[0];
      row[i + 1] = color[1];
      row[i + 2] = color[2];
      row[i + 3] = color[3];
    }
    rows.push(row);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  return Buffer.concat([
    u32(data.length),
    typeBuffer,
    data,
    u32(crc32(Buffer.concat([typeBuffer, data])))
  ]);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePdfFixture() {
  const stream = [
    "q 0.082 0.341 0.651 rg 0 0 900 520 re f Q",
    "q 1 1 1 rg 90 375 490 35 re f 90 315 410 35 re f 90 255 540 35 re f Q",
    "q 1 0.949 0 rg 70 80 650 125 re f Q",
    "q 0 0.110 0.243 rg 100 155 510 25 re f 100 110 470 25 re f Q"
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 520] /Contents 4 0 R /Resources << >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}
