const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { test, expect } = require("@playwright/test");

const fixtureDir = path.join(os.tmpdir(), "contrast-check-fixtures");
const pngPath = path.join(fixtureDir, "contrast-sample.png");
const solidPngPath = path.join(fixtureDir, "contrast-solid.png");
const pdfPath = path.join(fixtureDir, "contrast-sample.pdf");

test.beforeAll(() => {
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(pngPath, makePngFixture(900, 520));
  fs.writeFileSync(solidPngPath, makeSolidPngFixture(240, 180, [0x22, 0x88, 0x44, 0xff]));
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
  expect(download.suggestedFilename()).toMatch(/contrast-check-.*\.pdf/);
  const exportPath = path.join(fixtureDir, "single-check-report.pdf");
  await download.saveAs(exportPath);
  expect(countPdfPages(exportPath)).toBe(2);
});

test("pastes a screenshot from clipboard as a source", async ({ page }) => {
  await page.goto("/");
  await pasteImageFromClipboard(page, pngPath, "contrast-sample.png", "image/png");
  await expect(page.locator(".sourceCard")).toHaveCount(1);
  await expect(page.locator("#activeSourceTitle")).toHaveText("contrast-sample.png");
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
  // The snippet canvas is a scaled crop; exact pixels can vary. Pick a pixel from the darkest
  // region (the text area) rather than relying on a hard-coded coordinate or exact color match.
  const point = await findCanvasDarkestPoint(page, "#snippetCanvas");
  expect(point).toBeTruthy();
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await expect(page.locator("#snippetBgValue")).not.toHaveText("#FFF200");

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

test("hex manual input accepts 3-digit shorthand", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(pngPath);
  await expect(page.locator(".sourceCard")).toHaveCount(1);

  await drawCheck(page);
  await expect(page.locator(".sampleCard")).toHaveCount(1);

  await page.locator(".fgInput").fill("fff");
  await page.locator(".fgInput").press("Tab");
  await expect(page.locator(".fgInput")).toHaveValue("#FFFFFF");

  await page.locator(".fgInput").fill("#f0a");
  await page.locator(".fgInput").press("Tab");
  await expect(page.locator(".fgInput")).toHaveValue("#FF00AA");
});

test("can start a new rectangle inside an existing rectangle", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(pngPath);
  await expect(page.locator(".sourceCard")).toHaveCount(1);

  await drawCheck(page, [150, 160, 650, 340]);
  await expect(page.locator(".sampleCard")).toHaveCount(1);

  await drawCheck(page, [250, 220, 520, 290]);
  await expect(page.locator(".sampleCard")).toHaveCount(2);
});

test("removes rectangles from their overlay delete buttons", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(pngPath);
  await expect(page.locator(".sourceCard")).toHaveCount(1);

  await drawCheck(page, [150, 160, 650, 340]);
  await expect(page.locator(".sampleCard")).toHaveCount(1);

  await page.locator(".rectangleDeleteHandle").first().click();
  await expect(page.locator(".sampleCard")).toHaveCount(0);

  await drawCheck(page, [250, 220, 520, 290]);
  await expect(page.locator(".sampleCard")).toHaveCount(1);
});

test("resizes rectangles from their bottom-right handles", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(pngPath);
  await expect(page.locator(".sourceCard")).toHaveCount(1);

  await drawCheck(page, [150, 160, 360, 240]);
  await expect(page.locator(".sampleCard")).toHaveCount(1);

  const before = await page.locator(".cropPreview").evaluate((img) => ({
    width: img.naturalWidth,
    height: img.naturalHeight
  }));
  const handle = page.locator(".rectangleResizeHandle").first();
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 55, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => {
    const after = await page.locator(".cropPreview").evaluate((img) => ({
      width: img.naturalWidth,
      height: img.naturalHeight
    }));
    return after.width > before.width && after.height > before.height;
  }).toBe(true);
  const after = await page.locator(".cropPreview").evaluate((img) => ({
    width: img.naturalWidth,
    height: img.naturalHeight
  }));
  expect(after.width).toBeGreaterThan(before.width);
  expect(after.height).toBeGreaterThan(before.height);
  await expect(page.locator(".rectangleResizeHandle")).toHaveCount(1);
});

test("reset removes rectangle overlay controls", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(pngPath);
  await expect(page.locator(".sourceCard")).toHaveCount(1);

  await drawCheck(page);
  await expect(page.locator(".rectangleDeleteHandle")).toHaveCount(1);
  await expect(page.locator(".rectangleResizeHandle")).toHaveCount(1);

  await page.locator("#resetButton").click();
  await expect(page.locator(".rectangleDeleteHandle")).toHaveCount(0);
  await expect(page.locator(".rectangleResizeHandle")).toHaveCount(0);
  await expect(page.locator(".sourceCard")).toHaveCount(0);
});

test("does not invent black or white when a rectangle has one detected color", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(solidPngPath);
  await expect(page.locator(".sourceCard")).toHaveCount(1);

  await drawCheck(page, [20, 20, 220, 160]);
  await expect(page.locator(".sampleCard")).toHaveCount(1);
  await expect(page.locator(".detectionError")).toHaveText("Could not detect foreground colour. Select manually.");
  await expect(page.locator(".fgInput")).toHaveValue("#228844");
  await expect(page.locator(".bgInput")).toHaveValue("#228844");
  await expect(page.locator(".ratio")).toHaveText("1.00:1");

  await page.locator(".fgInput").fill("#FFFFFF");
  await page.locator(".fgInput").press("Tab");
  await expect(page.locator(".detectionError")).toBeHidden();
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

test("imports a single-page PDF directly as a source", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(pdfPath);
  await expect(page.locator("#pdfDialog")).not.toBeVisible();
  await expect(page.locator(".sourceCard")).toHaveCount(1);
  await expect(page.locator(".sourceMeta")).toContainText("pdf page");
});

test("exports imported PDF pages with page numbers in source titles", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(pdfPath);
  await expect(page.locator("#pdfDialog")).not.toBeVisible();
  await expect(page.locator(".sourceCard")).toHaveCount(1);

  await drawCheck(page, [90, 90, 500, 180]);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportButton").click();
  const download = await downloadPromise;
  const exportPath = path.join(fixtureDir, "pdf-page-title-report.pdf");
  await download.saveAs(exportPath);
  expect(fs.readFileSync(exportPath, "latin1")).toContain("contrast-sample.pdf - page 1");
});

test("detects PDF-native text blocks and tags generated checks", async ({ page }) => {
  await page.goto("/?debugSampling=1");
  await page.locator("#fileInput").setInputFiles(pdfPath);
  await expect(page.locator("#pdfDialog")).not.toBeVisible();
  await expect(page.locator(".sourceCard")).toHaveCount(1);
  await expect(page.locator("#activeSourceMeta")).toContainText("text blocks");

  await page.locator("#detectTextButton").click();
  await expect(page.locator(".sampleCard")).toHaveCount(4);
  await expect(page.locator(".methodBadge").first()).toContainText("PDF-native");
  await expect.poll(async () => (
    page.locator(".fgInput").evaluateAll((inputs) => inputs.map((input) => input.value))
  )).toEqual(["#000000", "#FFFFFF", "#000000", "#000000"]);
  await expect(page.locator("#removeDetectedButton")).toBeVisible();

  await page.locator("#detectTextButton").click();
  await expect(page.locator(".sampleCard")).toHaveCount(4);

  await page.locator("#removeDetectedButton").click();
  await expect(page.locator(".sampleCard")).toHaveCount(0);
});

async function drawCheck(page, rect = [190, 210, 640, 315]) {
  const canvas = page.locator("#overlayCanvas");
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  const { width, height } = box;

  // The smoke fixtures are in source-image coordinates. Convert them into
  // element-relative coordinates so layout changes (e.g. footer height) don't
  // break the interaction.
  const [x1, y1, x2, y2] = rect;
  const scaleX = width / 900;
  const scaleY = height / 520;
  await page.mouse.move(box.x + x1 * scaleX, box.y + y1 * scaleY, { steps: 5 });
  await page.mouse.down();
  await page.mouse.move(box.x + x2 * scaleX, box.y + y2 * scaleY, { steps: 10 });
  await page.mouse.up();
}

async function setNativeColor(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function findCanvasPixel(page, selector, targetRgb, tolerance = 0) {
  return await page.evaluate(({ selector: sel, targetRgb: target, tolerance: tol }) => {
    const canvas = document.querySelector(sel);
    if (!canvas) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return null;

    const image = ctx.getImageData(0, 0, width, height).data;
    const [tr, tg, tb] = target;
    const step = Math.max(1, Math.floor(Math.min(width, height) / 120));

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        const r = image[i];
        const g = image[i + 1];
        const b = image[i + 2];
        if (Math.abs(r - tr) <= tol && Math.abs(g - tg) <= tol && Math.abs(b - tb) <= tol) {
          return { x: x + 0.5, y: y + 0.5 };
        }
      }
    }

    // Fall back to exhaustive search if the coarse scan didn't find a match.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const r = image[i];
        const g = image[i + 1];
        const b = image[i + 2];
        if (Math.abs(r - tr) <= tol && Math.abs(g - tg) <= tol && Math.abs(b - tb) <= tol) {
          return { x: x + 0.5, y: y + 0.5 };
        }
      }
    }

    return null;
  }, { selector, targetRgb, tolerance });
}

async function findCanvasDarkestPoint(page, selector) {
  return await page.evaluate(({ selector: sel }) => {
    const canvas = document.querySelector(sel);
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return null;

    const data = ctx.getImageData(0, 0, width, height).data;
    // Ignore a small border where letterboxing/controls can land.
    const minX = Math.floor(width * 0.1);
    const maxX = Math.ceil(width * 0.9);
    const minY = Math.floor(height * 0.1);
    const maxY = Math.ceil(height * 0.9);

    // Scan at a coarse step, then refine around the best candidate.
    const step = Math.max(1, Math.floor(Math.min(width, height) / 120));

    let best = null;
    let bestLuma = Infinity;
    for (let y = minY; y < maxY; y += step) {
      for (let x = minX; x < maxX; x += step) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 200) continue;
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (luma < bestLuma) {
          bestLuma = luma;
          best = { x: x + 0.5, y: y + 0.5 };
        }
      }
    }

    if (!best) return null;

    const refineRadius = Math.max(4, Math.floor(step * 1.5));
    const startX = Math.max(minX, Math.floor(best.x - refineRadius));
    const endX = Math.min(maxX - 1, Math.ceil(best.x + refineRadius));
    const startY = Math.max(minY, Math.floor(best.y - refineRadius));
    const endY = Math.min(maxY - 1, Math.ceil(best.y + refineRadius));

    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 200) continue;
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (luma < bestLuma) {
          bestLuma = luma;
          best = { x: x + 0.5, y: y + 0.5 };
        }
      }
    }

    return best;
  }, { selector });
}

async function pasteImageFromClipboard(page, filePath, fileName, mimeType) {
  const bytes = fs.readFileSync(filePath);
  await page.evaluate(({ data, name, type }) => {
    const array = Uint8Array.from(data);
    const file = new File([array], name, { type });
    const clipboardData = new DataTransfer();
    clipboardData.items.add(file);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: clipboardData
    });
    window.dispatchEvent(event);
  }, { data: [...bytes], name: fileName, type: mimeType });
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

function makeSolidPngFixture(width, height, color) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
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
  const text = [
    "BT /F1 26 Tf 0 0 0 rg 100 388 Td (Black text on white) Tj ET",
    "BT /F1 22 Tf 1 1 1 rg 660 390 Td (White text) Tj ET",
    "BT /F1 26 Tf 0 0 0 rg 100 328 Td (More dark text) Tj ET",
    "BT /F1 22 Tf 0 0 0 rg 112 162 Td (Dark text on yellow) Tj ET"
  ].join("\n");
  const stream = [
    "q 0.082 0.341 0.651 rg 0 0 900 520 re f Q",
    "q 1 1 1 rg 90 375 490 35 re f 90 315 410 35 re f 90 255 540 35 re f Q",
    "q 0.78 0.08 0.05 rg 650 375 190 35 re f Q",
    "q 1 0.949 0 rg 70 80 650 125 re f Q",
    "q 0 0.110 0.243 rg 100 155 510 25 re f 100 110 470 25 re f Q",
    text
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 520] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
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
