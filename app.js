(function () {
  "use strict";

  const pdfWorkerUrl = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }

  const state = {
    sources: [],
    activeSourceId: null,
    activeCheckId: null,
    draftRect: null,
    dragStart: null,
    displayRect: null,
    editorScale: 1,
    editorFitScale: 1,
    editorDisplayRect: null,
    suppressOpenClick: false,
    pendingPdf: null
  };

  const els = {
    fileInput: document.querySelector("#fileInput"),
    exportButton: document.querySelector("#exportButton"),
    resetButton: document.querySelector("#resetButton"),
    deleteSourceButton: document.querySelector("#deleteSourceButton"),
    sourceCount: document.querySelector("#sourceCount"),
    sourcesList: document.querySelector("#sourcesList"),
    activeSourceTitle: document.querySelector("#activeSourceTitle"),
    activeSourceMeta: document.querySelector("#activeSourceMeta"),
    dropZone: document.querySelector("#dropZone"),
    imageCanvas: document.querySelector("#imageCanvas"),
    overlayCanvas: document.querySelector("#overlayCanvas"),
    status: document.querySelector("#status"),
    results: document.querySelector("#results"),
    sourceTemplate: document.querySelector("#sourceTemplate"),
    resultTemplate: document.querySelector("#resultTemplate"),
    pdfDialog: document.querySelector("#pdfDialog"),
    pdfDialogMeta: document.querySelector("#pdfDialogMeta"),
    pdfPageControls: document.querySelector("#pdfPageControls"),
    importPdfPagesButton: document.querySelector("#importPdfPagesButton"),
    editorDialog: document.querySelector("#editorDialog"),
    editorTitle: document.querySelector("#editorTitle"),
    editorStage: document.querySelector("#editorStage"),
    editorCanvasWrap: document.querySelector("#editorCanvasWrap"),
    editorImageCanvas: document.querySelector("#editorImageCanvas"),
    editorOverlayCanvas: document.querySelector("#editorOverlayCanvas"),
    zoomOutButton: document.querySelector("#zoomOutButton"),
    zoomInButton: document.querySelector("#zoomInButton"),
    zoomFitButton: document.querySelector("#zoomFitButton"),
    zoomLabel: document.querySelector("#zoomLabel"),
    closeEditorButton: document.querySelector("#closeEditorButton")
  };

  const imageCtx = els.imageCanvas.getContext("2d", { willReadFrequently: true });
  const overlayCtx = els.overlayCanvas.getContext("2d");
  const editorImageCtx = els.editorImageCanvas.getContext("2d", { willReadFrequently: true });
  const editorOverlayCtx = els.editorOverlayCanvas.getContext("2d");

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now()}`;
  }

  function activeSource() {
    return state.sources.find((source) => source.id === state.activeSourceId) || null;
  }

  function activeCheck(source = activeSource()) {
    if (!source) return null;
    return source.checks.find((check) => check.id === state.activeCheckId) || null;
  }

  function setupCanvasSize() {
    const rect = els.dropZone.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    for (const canvas of [els.imageCanvas, els.overlayCanvas]) {
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    imageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function fitRect(source, container) {
    const scale = Math.min(container.width / source.width, container.height / source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    return {
      x: (container.width - width) / 2,
      y: (container.height - height) / 2,
      width,
      height,
      scale
    };
  }

  function render() {
    setupCanvasSize();
    renderSources();
    renderActiveSource();
    renderResults();
    updateButtons();
  }

  function renderActiveSource() {
    const source = activeSource();
    const bounds = els.dropZone.getBoundingClientRect();
    imageCtx.clearRect(0, 0, bounds.width, bounds.height);
    overlayCtx.clearRect(0, 0, bounds.width, bounds.height);

    if (!source) {
      els.dropZone.classList.remove("hasImage");
      els.activeSourceTitle.textContent = "No source selected";
      els.activeSourceMeta.textContent = "Upload an image or PDF page to begin.";
      state.displayRect = null;
      return;
    }

    els.dropZone.classList.add("hasImage");
    els.activeSourceTitle.textContent = source.name;
    els.activeSourceMeta.textContent = `${source.width} x ${source.height}px | ${source.checks.length} checks`;

    state.displayRect = fitRect(source, bounds);
    imageCtx.drawImage(
      source.canvas,
      state.displayRect.x,
      state.displayRect.y,
      state.displayRect.width,
      state.displayRect.height
    );
    drawOverlay();
  }

  function drawOverlay() {
    const source = activeSource();
    const bounds = els.dropZone.getBoundingClientRect();
    overlayCtx.clearRect(0, 0, bounds.width, bounds.height);
    if (!source || !state.displayRect) return;

    source.checks.forEach((check, index) => {
      const rect = sourceToDisplayRect(check.rect);
      const isActive = check.id === state.activeCheckId;
      overlayCtx.save();
      overlayCtx.lineWidth = isActive ? 3 : 2;
      overlayCtx.strokeStyle = isActive ? "#ffe45c" : "#1557a6";
      overlayCtx.fillStyle = isActive ? "rgba(255, 228, 92, 0.08)" : "rgba(21, 87, 166, 0.06)";
      overlayCtx.fillRect(rect.x, rect.y, rect.width, rect.height);
      overlayCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      drawNumberBadge(overlayCtx, index + 1, rect, bounds);
      overlayCtx.restore();
    });

    if (state.draftRect) {
      const rect = sourceToDisplayRect(state.draftRect);
      overlayCtx.save();
      overlayCtx.setLineDash([7, 5]);
      overlayCtx.lineWidth = 2;
      overlayCtx.strokeStyle = "#0b3367";
      overlayCtx.fillStyle = "rgba(255, 228, 92, 0.04)";
      overlayCtx.fillRect(rect.x, rect.y, rect.width, rect.height);
      overlayCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      overlayCtx.restore();
    }
  }

  function drawNumberBadge(ctx, number, rect, bounds) {
    const label = String(number);
    const width = Math.max(24, label.length * 10 + 14);
    const height = 24;
    const gap = 6;
    const positions = [
      { x: rect.x, y: rect.y - height - gap },
      { x: rect.x + rect.width + gap, y: rect.y },
      { x: rect.x, y: rect.y + rect.height + gap },
      { x: rect.x - width - gap, y: rect.y }
    ];
    const chosen = positions.find((pos) => (
      pos.x >= 4 &&
      pos.y >= 4 &&
      pos.x + width <= bounds.width - 4 &&
      pos.y + height <= bounds.height - 4
    )) || positions[0];
    const bx = clamp(chosen.x, 4, Math.max(4, bounds.width - width - 4));
    const by = clamp(chosen.y, 4, Math.max(4, bounds.height - height - 4));
    ctx.fillStyle = "#1557a6";
    ctx.fillRect(bx, by, width, height);
    ctx.fillStyle = "#fff";
    ctx.font = "800 13px Avenir Next, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, bx + width / 2, by + height / 2);
  }

  function renderSources() {
    els.sourceCount.textContent = String(state.sources.length);
    els.sourcesList.replaceChildren();
    state.sources.forEach((source, index) => {
      const node = els.sourceTemplate.content.firstElementChild.cloneNode(true);
      node.classList.toggle("isActive", source.id === state.activeSourceId);
      node.querySelector(".sourceName").textContent = source.name;
      node.querySelector(".sourceMeta").textContent = `${index + 1}. ${source.type} | ${source.checks.length} checks`;
      node.querySelector(".sourceButton").addEventListener("click", () => {
        state.activeSourceId = source.id;
        state.activeCheckId = source.checks[0]?.id || null;
        render();
      });
      els.sourcesList.append(node);
    });
  }

  function renderResults() {
    const source = activeSource();
    els.results.replaceChildren();
    if (!source) {
      els.status.textContent = "No checks";
      return;
    }
    els.status.textContent = `${source.checks.length} checks`;

    source.checks.forEach((check, index) => {
      const node = els.resultTemplate.content.firstElementChild.cloneNode(true);
      node.classList.toggle("isActive", check.id === state.activeCheckId);
      node.querySelector(".sampleTitle").textContent = `#${index + 1}`;
      node.querySelector(".ratio").textContent = `${formatRatio(check.ratio)}:1`;

      const labelInput = node.querySelector(".labelInput");
      labelInput.value = check.label;
      labelInput.addEventListener("input", () => {
        check.label = labelInput.value;
      });

      const crop = node.querySelector(".cropPreview");
      crop.src = check.cropDataUrl;
      crop.alt = `${check.label} crop`;
      wireCropPicker(node, source, check, crop);

      wireHexInput(node, check, "fg");
      wireHexInput(node, check, "bg");
      setBadge(node.querySelector(".aaNormal"), "AA normal", check.ratio >= 4.5);
      setBadge(node.querySelector(".aaLarge"), "AA large", check.ratio >= 3);
      setBadge(node.querySelector(".aaaNormal"), "AAA normal", check.ratio >= 7);

      node.querySelector(".sampleFocus").addEventListener("click", () => {
        state.activeCheckId = check.id;
        render();
      });
      node.querySelector(".deleteButton").addEventListener("click", () => {
        source.checks = source.checks.filter((item) => item.id !== check.id);
        state.activeCheckId = source.checks[0]?.id || null;
        render();
      });

      els.results.append(node);
    });
  }

  function wireHexInput(node, check, kind) {
    const input = node.querySelector(kind === "fg" ? ".fgInput" : ".bgInput");
    const colorInput = node.querySelector(kind === "fg" ? ".fgColorInput" : ".bgColorInput");
    const swatch = node.querySelector(kind === "fg" ? ".fgSwatch" : ".bgSwatch");
    const key = kind === "fg" ? "foreground" : "background";
    input.value = rgbToHex(check[key]);
    colorInput.value = rgbToHex(check[key]);
    swatch.style.background = rgbToHex(check[key]);
    input.addEventListener("change", () => {
      const parsed = parseHex(input.value);
      if (!parsed) {
        input.value = rgbToHex(check[key]);
        return;
      }
      check[key] = parsed;
      check.ratio = contrastRatio(check.foreground, check.background);
      render();
    });
    colorInput.addEventListener("input", () => {
      const parsed = parseHex(colorInput.value);
      if (!parsed) return;
      check[key] = parsed;
      check.ratio = contrastRatio(check.foreground, check.background);
      render();
    });
  }

  function wireCropPicker(node, source, check, crop) {
    const fgButton = node.querySelector(".pickFg");
    const bgButton = node.querySelector(".pickBg");
    const setMode = (mode) => {
      check.pickTarget = mode;
      fgButton.classList.toggle("isActive", mode === "foreground");
      bgButton.classList.toggle("isActive", mode === "background");
    };
    setMode(check.pickTarget || "foreground");
    fgButton.addEventListener("click", () => setMode("foreground"));
    bgButton.addEventListener("click", () => setMode("background"));
    crop.addEventListener("click", (event) => {
      const rect = crop.getBoundingClientRect();
      const xRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const yRatio = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      const x = clamp(Math.floor(check.rect.x + xRatio * check.rect.width), 0, source.width - 1);
      const y = clamp(Math.floor(check.rect.y + yRatio * check.rect.height), 0, source.height - 1);
      const pixel = source.canvas.getContext("2d", { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
      check[check.pickTarget || "foreground"] = [pixel[0], pixel[1], pixel[2]];
      check.ratio = contrastRatio(check.foreground, check.background);
      render();
    });
  }

  function setBadge(el, text, pass) {
    el.textContent = `${text}: ${pass ? "pass" : "fail"}`;
    el.classList.toggle("pass", pass);
    el.classList.toggle("fail", !pass);
  }

  function updateButtons() {
    const hasSources = state.sources.length > 0;
    const hasChecks = state.sources.some((source) => source.checks.length > 0);
    els.exportButton.disabled = !hasChecks;
    els.resetButton.disabled = !hasSources;
    els.deleteSourceButton.disabled = !activeSource();
  }

  function displayPointToSource(event, target = "main") {
    const displayRect = target === "editor" ? state.editorDisplayRect : state.displayRect;
    const canvas = target === "editor" ? els.editorOverlayCanvas : els.overlayCanvas;
    if (!displayRect) return null;
    const canvasRect = canvas.getBoundingClientRect();
    const x = event.clientX - canvasRect.left;
    const y = event.clientY - canvasRect.top;
    const within =
      x >= displayRect.x &&
      y >= displayRect.y &&
      x <= displayRect.x + displayRect.width &&
      y <= displayRect.y + displayRect.height;
    if (!within) return null;
    return {
      x: (x - displayRect.x) / displayRect.scale,
      y: (y - displayRect.y) / displayRect.scale
    };
  }

  function sourceToDisplayRect(rect) {
    return sourceRectToDisplay(rect, state.displayRect);
  }

  function sourceRectToDisplay(rect, displayRect) {
    return {
      x: displayRect.x + rect.x * displayRect.scale,
      y: displayRect.y + rect.y * displayRect.scale,
      width: rect.width * displayRect.scale,
      height: rect.height * displayRect.scale
    };
  }

  function normalizeRect(a, b, source) {
    const x1 = clamp(Math.min(a.x, b.x), 0, source.width);
    const y1 = clamp(Math.min(a.y, b.y), 0, source.height);
    const x2 = clamp(Math.max(a.x, b.x), 0, source.width);
    const y2 = clamp(Math.max(a.y, b.y), 0, source.height);
    return {
      x: Math.round(x1),
      y: Math.round(y1),
      width: Math.max(1, Math.round(x2 - x1)),
      height: Math.max(1, Math.round(y2 - y1))
    };
  }

  function findCheckAtPoint(source, point) {
    return [...source.checks].reverse().find((check) => (
      point.x >= check.rect.x &&
      point.y >= check.rect.y &&
      point.x <= check.rect.x + check.rect.width &&
      point.y <= check.rect.y + check.rect.height
    ));
  }

  function onPointerDown(event, target = "main") {
    const source = activeSource();
    if (!source) return;
    const point = displayPointToSource(event, target);
    if (!point) return;

    const hit = findCheckAtPoint(source, point);
    if (hit) {
      state.activeCheckId = hit.id;
      render();
      return;
    }

    state.dragStart = point;
    state.draftRect = normalizeRect(point, point, source);
    (target === "editor" ? els.editorOverlayCanvas : els.overlayCanvas).setPointerCapture(event.pointerId);
    drawTargetOverlay(target);
  }

  function onPointerMove(event, target = "main") {
    const source = activeSource();
    if (!source || !state.dragStart) return;
    const point = displayPointToSource(event, target);
    if (!point) return;
    state.draftRect = normalizeRect(state.dragStart, point, source);
    drawTargetOverlay(target);
  }

  function onPointerUp(event, target = "main") {
    const source = activeSource();
    if (!source || !state.dragStart || !state.draftRect) return;
    (target === "editor" ? els.editorOverlayCanvas : els.overlayCanvas).releasePointerCapture(event.pointerId);
    const rect = state.draftRect;
    state.dragStart = null;
    state.draftRect = null;

    if (rect.width < 4 || rect.height < 4) {
      drawTargetOverlay(target);
      return;
    }

    if (target === "main") {
      state.suppressOpenClick = true;
      setTimeout(() => {
        state.suppressOpenClick = false;
      }, 0);
    }

    const check = createCheck(source, rect);
    source.checks.push(check);
    state.activeCheckId = check.id;
    render();
    if (els.editorDialog.open) renderEditor();
  }

  function drawTargetOverlay(target) {
    if (target === "editor") {
      drawEditorOverlay();
    } else {
      drawOverlay();
    }
  }

  function openEditor() {
    const source = activeSource();
    if (!source) return;
    state.dragStart = null;
    state.draftRect = null;
    state.editorScale = 0;
    els.editorDialog.showModal();
    requestAnimationFrame(() => {
      setEditorFitScale();
      renderEditor();
    });
  }

  function closeEditor() {
    state.dragStart = null;
    state.draftRect = null;
    els.editorDialog.close();
    render();
  }

  function setEditorFitScale() {
    const source = activeSource();
    if (!source) return;
    const stage = els.editorStage.getBoundingClientRect();
    const availableWidth = Math.max(320, stage.width - 48);
    const availableHeight = Math.max(240, stage.height - 48);
    state.editorFitScale = Math.min(1, availableWidth / source.width, availableHeight / source.height);
    state.editorScale = state.editorFitScale;
  }

  function renderEditor() {
    const source = activeSource();
    if (!source || !els.editorDialog.open) return;
    const scale = state.editorScale || state.editorFitScale || 1;
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const dpr = window.devicePixelRatio || 1;

    els.editorTitle.textContent = source.name;
    els.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    els.editorCanvasWrap.style.width = `${width}px`;
    els.editorCanvasWrap.style.height = `${height}px`;

    for (const canvas of [els.editorImageCanvas, els.editorOverlayCanvas]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    editorImageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    editorOverlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    editorImageCtx.clearRect(0, 0, width, height);
    editorImageCtx.drawImage(source.canvas, 0, 0, width, height);
    state.editorDisplayRect = { x: 0, y: 0, width, height, scale };
    drawEditorOverlay();
  }

  function drawEditorOverlay() {
    const source = activeSource();
    if (!source || !state.editorDisplayRect) return;
    const bounds = { width: state.editorDisplayRect.width, height: state.editorDisplayRect.height };
    editorOverlayCtx.clearRect(0, 0, bounds.width, bounds.height);
    source.checks.forEach((check, index) => {
      const rect = sourceRectToDisplay(check.rect, state.editorDisplayRect);
      const isActive = check.id === state.activeCheckId;
      editorOverlayCtx.save();
      editorOverlayCtx.lineWidth = isActive ? 3 : 2;
      editorOverlayCtx.strokeStyle = isActive ? "#ffe45c" : "#4fa3ff";
      editorOverlayCtx.fillStyle = isActive ? "rgba(255, 228, 92, 0.07)" : "rgba(79, 163, 255, 0.05)";
      editorOverlayCtx.fillRect(rect.x, rect.y, rect.width, rect.height);
      editorOverlayCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      drawNumberBadge(editorOverlayCtx, index + 1, rect, bounds);
      editorOverlayCtx.restore();
    });

    if (state.draftRect) {
      const rect = sourceRectToDisplay(state.draftRect, state.editorDisplayRect);
      editorOverlayCtx.save();
      editorOverlayCtx.setLineDash([8, 6]);
      editorOverlayCtx.lineWidth = 2;
      editorOverlayCtx.strokeStyle = "#ffe45c";
      editorOverlayCtx.fillStyle = "rgba(255, 228, 92, 0.03)";
      editorOverlayCtx.fillRect(rect.x, rect.y, rect.width, rect.height);
      editorOverlayCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      editorOverlayCtx.restore();
    }
  }

  function zoomEditor(multiplier) {
    const source = activeSource();
    if (!source) return;
    const current = state.editorScale || state.editorFitScale || 1;
    state.editorScale = clamp(current * multiplier, Math.max(0.1, state.editorFitScale * 0.5), 4);
    renderEditor();
  }

  async function handleFiles(files) {
    for (const file of files) {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        await choosePdfPages(file);
      } else if (file.type.startsWith("image/")) {
        await addImageSource(file);
      }
    }
    if (!state.activeSourceId && state.sources[0]) {
      state.activeSourceId = state.sources[0].id;
    }
    render();
  }

  async function addImageSource(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    addSource({
      name: file.name,
      type: "image",
      width: canvas.width,
      height: canvas.height,
      canvas
    });
  }

  function addSource(source) {
    state.sources.push({
      id: uid("source"),
      checks: [],
      ...source
    });
    state.activeSourceId = state.sources[state.sources.length - 1].id;
  }

  async function choosePdfPages(file) {
    if (!window.pdfjsLib) {
      alert("PDF support did not load. Check your network connection and try again.");
      return;
    }
    const bytes = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    state.pendingPdf = { file, pdf };
    els.pdfDialogMeta.textContent = `${file.name} has ${pdf.numPages} pages. Import one page or a range.`;
    els.pdfPageControls.innerHTML = `
      <label>Start page<input id="pdfStartPage" type="number" min="1" max="${pdf.numPages}" value="1"></label>
      <label>End page<input id="pdfEndPage" type="number" min="1" max="${pdf.numPages}" value="1"></label>
    `;
    els.pdfDialog.showModal();
    await new Promise((resolve) => {
      els.pdfDialog.addEventListener("close", resolve, { once: true });
    });
  }

  async function importPendingPdfPages(event) {
    event.preventDefault();
    if (!state.pendingPdf) return;
    const startInput = document.querySelector("#pdfStartPage");
    const endInput = document.querySelector("#pdfEndPage");
    const pdf = state.pendingPdf.pdf;
    const start = clamp(Number(startInput.value) || 1, 1, pdf.numPages);
    const end = clamp(Number(endInput.value) || start, start, pdf.numPages);
    els.importPdfPagesButton.disabled = true;

    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      await page.render({ canvasContext: ctx, viewport }).promise;
      addSource({
        name: `${state.pendingPdf.file.name} - page ${pageNumber}`,
        type: "pdf page",
        width: canvas.width,
        height: canvas.height,
        canvas
      });
    }

    els.importPdfPagesButton.disabled = false;
    state.pendingPdf = null;
    els.pdfDialog.close("imported");
    render();
  }

  function createCheck(source, rect) {
    const sample = sampleColors(source, rect);
    const cropDataUrl = cropData(source, rect);
    return {
      id: uid("check"),
      label: `Check ${source.checks.length + 1}`,
      rect,
      cropDataUrl,
      foreground: sample.foreground,
      background: sample.background,
      ratio: contrastRatio(sample.foreground, sample.background),
      pickTarget: "foreground"
    };
  }

  function cropData(source, rect) {
    const crop = document.createElement("canvas");
    crop.width = rect.width;
    crop.height = rect.height;
    crop.getContext("2d").drawImage(
      source.canvas,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height
    );
    return crop.toDataURL("image/png");
  }

  function sampleColors(source, rect) {
    const ctx = source.canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
    const clusters = new Map();
    const data = image.data;
    const step = Math.max(1, Math.floor(Math.sqrt((rect.width * rect.height) / 18000)));

    for (let y = 0; y < rect.height; y += step) {
      for (let x = 0; x < rect.width; x += step) {
        const i = (y * rect.width + x) * 4;
        const a = data[i + 3];
        if (a < 128) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const key = `${r >> 4},${g >> 4},${b >> 4}`;
        const cluster = clusters.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        cluster.count += 1;
        cluster.r += r;
        cluster.g += g;
        cluster.b += b;
        clusters.set(key, cluster);
      }
    }

    const sorted = [...clusters.values()]
      .map((cluster) => ({
        count: cluster.count,
        rgb: [
          Math.round(cluster.r / cluster.count),
          Math.round(cluster.g / cluster.count),
          Math.round(cluster.b / cluster.count)
        ]
      }))
      .sort((a, b) => b.count - a.count);

    if (sorted.length === 0) {
      return { foreground: [0, 0, 0], background: [255, 255, 255] };
    }

    const background = sorted[0].rgb;
    const minCount = Math.max(3, Math.round(sorted[0].count * 0.015));
    const foregroundCandidate = sorted
      .slice(1)
      .filter((cluster) => cluster.count >= minCount)
      .map((cluster) => ({
        ...cluster,
        contrast: contrastRatio(cluster.rgb, background)
      }))
      .sort((a, b) => b.contrast - a.contrast)[0];

    return {
      foreground: foregroundCandidate?.rgb || sorted[Math.min(1, sorted.length - 1)].rgb,
      background
    };
  }

  function srgbToLinear(value) {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }

  function luminance(rgb) {
    return (
      0.2126 * srgbToLinear(rgb[0]) +
      0.7152 * srgbToLinear(rgb[1]) +
      0.0722 * srgbToLinear(rgb[2])
    );
  }

  function contrastRatio(a, b) {
    const l1 = luminance(a);
    const l2 = luminance(b);
    const high = Math.max(l1, l2);
    const low = Math.min(l1, l2);
    return (high + 0.05) / (low + 0.05);
  }

  function rgbToHex(rgb) {
    return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }

  function parseHex(value) {
    const match = String(value).trim().match(/^#?([0-9a-f]{6})$/i);
    if (!match) return null;
    const hex = match[1];
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16)
    ];
  }

  function formatRatio(ratio) {
    return ratio.toFixed(2);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function annotatedImageData(source) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source.canvas, 0, 0);
    const scale = Math.max(1, Math.round(source.width / 1200));
    source.checks.forEach((check, index) => {
      ctx.save();
      ctx.lineWidth = 4 * scale;
      ctx.strokeStyle = "#1557a6";
      ctx.fillStyle = "rgba(21, 87, 166, 0.14)";
      ctx.fillRect(check.rect.x, check.rect.y, check.rect.width, check.rect.height);
      ctx.strokeRect(check.rect.x, check.rect.y, check.rect.width, check.rect.height);
      drawReportBadge(ctx, index + 1, check.rect.x + 8 * scale, check.rect.y + 8 * scale, scale);
      ctx.restore();
    });
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  function drawReportBadge(ctx, number, x, y, scale) {
    const label = String(number);
    const width = Math.max(34 * scale, label.length * 14 * scale + 18 * scale);
    const height = 30 * scale;
    ctx.fillStyle = "#1557a6";
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = "#fff";
    ctx.font = `${18 * scale}px Avenir Next, Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + width / 2, y + height / 2);
  }

  async function exportReport() {
    if (!window.jspdf?.jsPDF) {
      alert("PDF export support did not load. Check your network connection and try again.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const page = { width: 210, height: 297, margin: 14 };
    let y = page.margin;
    const checks = state.sources.flatMap((source) => source.checks);
    const failing = checks.filter((check) => check.ratio < 4.5).length;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Contrast Evidence Report", page.margin, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Generated ${new Date().toLocaleString()}`, page.margin, y);
    y += 6;
    doc.text(`${state.sources.length} sources | ${checks.length} checks | ${failing} AA normal failures`, page.margin, y);
    y += 10;

    for (const [sourceIndex, source] of state.sources.entries()) {
      if (source.checks.length === 0) continue;
      if (y > 240) {
        doc.addPage();
        y = page.margin;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(`${sourceIndex + 1}. ${source.name}`, page.margin, y, { maxWidth: page.width - page.margin * 2 });
      y += 7;

      const imageWidth = page.width - page.margin * 2;
      const imageHeight = Math.min(125, imageWidth * (source.height / source.width));
      doc.addImage(annotatedImageData(source), "JPEG", page.margin, y, imageWidth, imageHeight);
      y += imageHeight + 8;

      y = drawTableHeader(doc, page, y);
      for (const [checkIndex, check] of source.checks.entries()) {
        if (y > 260) {
          doc.addPage();
          y = page.margin;
          y = drawTableHeader(doc, page, y);
        }
        y = drawCheckRow(doc, page, y, check, checkIndex + 1);
      }
      y += 8;
    }

    doc.save(`contrast-evidence-${dateStamp()}.pdf`);
  }

  function drawTableHeader(doc, page, y) {
    doc.setFillColor(21, 87, 166);
    doc.rect(page.margin, y, page.width - page.margin * 2, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("#", page.margin + 2, y + 5.5);
    doc.text("Crop", page.margin + 12, y + 5.5);
    doc.text("Label", page.margin + 48, y + 5.5);
    doc.text("Colors", page.margin + 100, y + 5.5);
    doc.text("Ratio", page.margin + 140, y + 5.5);
    doc.text("Result", page.margin + 160, y + 5.5);
    doc.setTextColor(0, 0, 0);
    return y + 9;
  }

  function drawCheckRow(doc, page, y, check, number) {
    const rowHeight = 27;
    const pass = check.ratio >= 4.5;
    doc.setDrawColor(216, 209, 194);
    doc.rect(page.margin, y, page.width - page.margin * 2, rowHeight);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(String(number), page.margin + 2, y + 7);
    doc.addImage(check.cropDataUrl, "PNG", page.margin + 12, y + 3, 30, 18);
    doc.setFont("helvetica", "normal");
    doc.text(check.label || `Check ${number}`, page.margin + 48, y + 7, { maxWidth: 48 });
    drawColorValue(doc, `FG ${rgbToHex(check.foreground)}`, check.foreground, page.margin + 100, y + 7);
    drawColorValue(doc, `BG ${rgbToHex(check.background)}`, check.background, page.margin + 100, y + 13);
    doc.setFont("helvetica", "bold");
    doc.text(`${formatRatio(check.ratio)}:1`, page.margin + 140, y + 7);
    doc.setTextColor(pass ? 23 : 180, pass ? 114 : 35, pass ? 69 : 24);
    doc.text(pass ? "AA pass" : "AA fail", page.margin + 160, y + 7);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`AA large ${check.ratio >= 3 ? "pass" : "fail"} | AAA ${check.ratio >= 7 ? "pass" : "fail"}`, page.margin + 160, y + 14);
    return y + rowHeight;
  }

  function drawColorValue(doc, label, color, x, y) {
    const swatchRadius = 1.8;
    const centerX = x + swatchRadius;
    const centerY = y - 1.4;
    const [r, g, b] = color;
    doc.setDrawColor(160, 150, 132);
    doc.setFillColor(r, g, b);
    doc.circle(centerX, centerY, swatchRadius, "FD");
    doc.text(label, x + 6, y);
  }

  function dateStamp() {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-");
  }

  els.fileInput.addEventListener("change", async (event) => {
    await handleFiles([...event.target.files]);
    event.target.value = "";
  });

  els.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropZone.classList.add("isDragging");
  });
  els.dropZone.addEventListener("dragleave", () => els.dropZone.classList.remove("isDragging"));
  els.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("isDragging");
    await handleFiles([...event.dataTransfer.files]);
  });

  els.overlayCanvas.addEventListener("pointerdown", onPointerDown);
  els.overlayCanvas.addEventListener("pointermove", onPointerMove);
  els.overlayCanvas.addEventListener("pointerup", onPointerUp);
  els.overlayCanvas.addEventListener("click", () => {
    if (state.suppressOpenClick) return;
    if (!state.dragStart && !state.draftRect) openEditor();
  });
  els.overlayCanvas.addEventListener("pointercancel", () => {
    state.dragStart = null;
    state.draftRect = null;
    drawOverlay();
  });

  els.editorOverlayCanvas.addEventListener("pointerdown", (event) => onPointerDown(event, "editor"));
  els.editorOverlayCanvas.addEventListener("pointermove", (event) => onPointerMove(event, "editor"));
  els.editorOverlayCanvas.addEventListener("pointerup", (event) => onPointerUp(event, "editor"));
  els.editorOverlayCanvas.addEventListener("pointercancel", () => {
    state.dragStart = null;
    state.draftRect = null;
    drawEditorOverlay();
  });
  els.zoomOutButton.addEventListener("click", () => zoomEditor(0.8));
  els.zoomInButton.addEventListener("click", () => zoomEditor(1.25));
  els.zoomFitButton.addEventListener("click", () => {
    setEditorFitScale();
    renderEditor();
  });
  els.closeEditorButton.addEventListener("click", closeEditor);
  els.editorDialog.addEventListener("close", () => {
    state.dragStart = null;
    state.draftRect = null;
    render();
  });

  els.importPdfPagesButton.addEventListener("click", importPendingPdfPages);
  els.exportButton.addEventListener("click", exportReport);
  els.resetButton.addEventListener("click", () => {
    state.sources = [];
    state.activeSourceId = null;
    state.activeCheckId = null;
    render();
  });
  els.deleteSourceButton.addEventListener("click", () => {
    const current = activeSource();
    if (!current) return;
    state.sources = state.sources.filter((source) => source.id !== current.id);
    state.activeSourceId = state.sources[0]?.id || null;
    state.activeCheckId = activeSource()?.checks[0]?.id || null;
    render();
  });

  window.addEventListener("resize", () => {
    render();
    if (els.editorDialog.open) {
      setEditorFitScale();
      renderEditor();
    }
  });
  new ResizeObserver(render).observe(els.dropZone);
  render();
})();
