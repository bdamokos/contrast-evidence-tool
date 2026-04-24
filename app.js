(function () {
  "use strict";

  const pdfWorkerUrl = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/legacy/build/pdf.worker.min.mjs";
  /** Published site (GitHub Pages); update if the repo or username changes. */
  const toolPagesUrl = "https://contrast.bdamokos.org/";

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
    snippetScale: 1,
    snippetFitScale: 1,
    snippetSourceId: null,
    snippetCheckId: null,
    suppressOpenClick: false,
    pendingPdf: null
  };

  const BADGE_DETAILS = {
    aaNormal: {
      label: "AA normal",
      requirement: 4.5,
      description: "Level AA for normal-size body text. This is the standard baseline for readable text contrast."
    },
    aaLarge: {
      label: "AA large",
      requirement: 3,
      description: "Level AA for large text, typically 18pt regular or 14pt bold and up."
    },
    aaaNormal: {
      label: "AAA normal",
      requirement: 7,
      description: "Level AAA for normal-size text. This is a stricter enhanced contrast target."
    }
  };

  const els = {
    fileInput: document.querySelector("#fileInput"),
    exportButton: document.querySelector("#exportButton"),
    resetButton: document.querySelector("#resetButton"),
    openEditorButton: document.querySelector("#openEditorButton"),
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
    pdfImportStatus: document.querySelector("#pdfImportStatus"),
    pdfImportStatusText: document.querySelector("#pdfImportStatusText"),
    pdfImportCancelButton: document.querySelector("#pdfImportCancelButton"),
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
    closeEditorButton: document.querySelector("#closeEditorButton"),
    snippetDialog: document.querySelector("#snippetDialog"),
    snippetTitle: document.querySelector("#snippetTitle"),
    snippetStage: document.querySelector("#snippetStage"),
    snippetCanvasWrap: document.querySelector("#snippetCanvasWrap"),
    snippetCanvas: document.querySelector("#snippetCanvas"),
    snippetPickFgButton: document.querySelector("#snippetPickFgButton"),
    snippetPickBgButton: document.querySelector("#snippetPickBgButton"),
    snippetFgSwatch: document.querySelector("#snippetFgSwatch"),
    snippetBgSwatch: document.querySelector("#snippetBgSwatch"),
    snippetFgValue: document.querySelector("#snippetFgValue"),
    snippetBgValue: document.querySelector("#snippetBgValue"),
    snippetZoomOutButton: document.querySelector("#snippetZoomOutButton"),
    snippetZoomInButton: document.querySelector("#snippetZoomInButton"),
    snippetZoomFitButton: document.querySelector("#snippetZoomFitButton"),
    snippetZoomLabel: document.querySelector("#snippetZoomLabel"),
    closeSnippetButton: document.querySelector("#closeSnippetButton")
  };

  const imageCtx = els.imageCanvas.getContext("2d", { willReadFrequently: true });
  const overlayCtx = els.overlayCanvas.getContext("2d");
  const editorImageCtx = els.editorImageCanvas.getContext("2d", { willReadFrequently: true });
  const editorOverlayCtx = els.editorOverlayCanvas.getContext("2d");
  const snippetCtx = els.snippetCanvas.getContext("2d", { willReadFrequently: true });

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
      drawNumberBadge(overlayCtx, index + 1, rect, bounds, source, state.displayRect);
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

  function drawNumberBadge(ctx, number, rect, bounds, source, displayRect) {
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

    let fillRgb = BADGE_FILL_CANDIDATES[0];
    let textRgb = [255, 255, 255];
    if (source && displayRect) {
      const sr = displayBadgeBoxToSourceRect(displayRect, bx, by, width, height);
      const colors = badgeColorsForSourceRect(source, sr.sx, sr.sy, sr.sw, sr.sh);
      fillRgb = colors.fill;
      textRgb = colors.textRgb;
    }

    ctx.fillStyle = rgbToCss(fillRgb);
    ctx.fillRect(bx, by, width, height);
    ctx.fillStyle = rgbToCss(textRgb);
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
      node.querySelector(".openSnippetButton").addEventListener("click", () => {
        openSnippetPicker(source, check);
      });

      wireHexInput(node, check, "fg");
      wireHexInput(node, check, "bg");
      setBadge(node.querySelector(".aaNormal"), BADGE_DETAILS.aaNormal, check.ratio >= BADGE_DETAILS.aaNormal.requirement);
      setBadge(node.querySelector(".aaLarge"), BADGE_DETAILS.aaLarge, check.ratio >= BADGE_DETAILS.aaLarge.requirement);
      setBadge(node.querySelector(".aaaNormal"), BADGE_DETAILS.aaaNormal, check.ratio >= BADGE_DETAILS.aaaNormal.requirement);

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
      updateCheckColorControls(node, check);
      updateCheckBadges(node, check);
      updateResultSummary(node, check);
      if (els.snippetDialog.open && state.snippetCheckId === check.id) renderSnippet();
      drawOverlay();
      if (els.editorDialog.open) drawEditorOverlay();
    });
  }

  function updateCheckColorControls(node, check) {
    for (const kind of ["fg", "bg"]) {
      const key = kind === "fg" ? "foreground" : "background";
      const hex = rgbToHex(check[key]);
      node.querySelector(kind === "fg" ? ".fgInput" : ".bgInput").value = hex;
      node.querySelector(kind === "fg" ? ".fgColorInput" : ".bgColorInput").value = hex;
      node.querySelector(kind === "fg" ? ".fgSwatch" : ".bgSwatch").style.background = hex;
    }
  }

  function updateCheckBadges(node, check) {
    setBadge(node.querySelector(".aaNormal"), BADGE_DETAILS.aaNormal, check.ratio >= BADGE_DETAILS.aaNormal.requirement);
    setBadge(node.querySelector(".aaLarge"), BADGE_DETAILS.aaLarge, check.ratio >= BADGE_DETAILS.aaLarge.requirement);
    setBadge(node.querySelector(".aaaNormal"), BADGE_DETAILS.aaaNormal, check.ratio >= BADGE_DETAILS.aaaNormal.requirement);
  }

  function updateResultSummary(node, check) {
    node.querySelector(".ratio").textContent = `${formatRatio(check.ratio)}:1`;
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

  function setBadge(el, details, pass) {
    el.querySelector(".badgeLabel").textContent = `${details.label}: ${pass ? "pass" : "fail"}`;
    const info = el.querySelector(".badgeInfo");
    const message = `${details.label} requires at least ${details.requirement}:1 contrast. ${details.description}`;
    info.title = message;
    info.setAttribute("aria-label", message);
    el.classList.toggle("pass", pass);
    el.classList.toggle("fail", !pass);
  }

  function updateButtons() {
    const hasSources = state.sources.length > 0;
    const hasChecks = state.sources.some((source) => source.checks.length > 0);
    els.exportButton.disabled = !hasChecks;
    els.resetButton.disabled = !hasSources;
    els.openEditorButton.disabled = !activeSource();
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
      drawNumberBadge(editorOverlayCtx, index + 1, rect, bounds, source, state.editorDisplayRect);
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

  function snippetSource() {
    return state.sources.find((source) => source.id === state.snippetSourceId) || null;
  }

  function snippetCheck(source = snippetSource()) {
    if (!source) return null;
    return source.checks.find((check) => check.id === state.snippetCheckId) || null;
  }

  function openSnippetPicker(source, check) {
    state.snippetSourceId = source.id;
    state.snippetCheckId = check.id;
    state.activeSourceId = source.id;
    state.activeCheckId = check.id;
    state.snippetScale = 0;
    els.snippetDialog.showModal();
    requestAnimationFrame(() => {
      setSnippetFitScale();
      render();
      renderSnippet();
    });
  }

  function closeSnippetPicker() {
    state.snippetSourceId = null;
    state.snippetCheckId = null;
    els.snippetDialog.close();
  }

  function setSnippetFitScale() {
    const check = snippetCheck();
    if (!check) return;
    const stage = els.snippetStage.getBoundingClientRect();
    const availableWidth = Math.max(320, stage.width - 48);
    const availableHeight = Math.max(240, stage.height - 48);
    const fitScale = Math.min(availableWidth / check.rect.width, availableHeight / check.rect.height);
    state.snippetFitScale = clamp(fitScale, 0.2, 12);
    state.snippetScale = state.snippetFitScale;
  }

  function renderSnippet() {
    const source = snippetSource();
    const check = snippetCheck(source);
    if (!source || !check || !els.snippetDialog.open) return;

    const scale = state.snippetScale || state.snippetFitScale || 1;
    const width = Math.max(1, Math.round(check.rect.width * scale));
    const height = Math.max(1, Math.round(check.rect.height * scale));
    const dpr = window.devicePixelRatio || 1;

    els.snippetTitle.textContent = `${check.label || "Snippet"} | ${check.rect.width} x ${check.rect.height}px`;
    els.snippetZoomLabel.textContent = `${Math.round(scale * 100)}%`;
    els.snippetFgSwatch.style.background = rgbToHex(check.foreground);
    els.snippetBgSwatch.style.background = rgbToHex(check.background);
    els.snippetFgValue.textContent = rgbToHex(check.foreground);
    els.snippetBgValue.textContent = rgbToHex(check.background);
    els.snippetPickFgButton.classList.toggle("isActive", (check.pickTarget || "foreground") === "foreground");
    els.snippetPickBgButton.classList.toggle("isActive", check.pickTarget === "background");
    els.snippetCanvasWrap.style.width = `${width}px`;
    els.snippetCanvasWrap.style.height = `${height}px`;
    els.snippetCanvas.width = Math.round(width * dpr);
    els.snippetCanvas.height = Math.round(height * dpr);
    els.snippetCanvas.style.width = `${width}px`;
    els.snippetCanvas.style.height = `${height}px`;

    snippetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    snippetCtx.clearRect(0, 0, width, height);
    snippetCtx.imageSmoothingEnabled = false;
    snippetCtx.drawImage(
      source.canvas,
      check.rect.x,
      check.rect.y,
      check.rect.width,
      check.rect.height,
      0,
      0,
      width,
      height
    );
  }

  function zoomSnippet(multiplier) {
    const check = snippetCheck();
    if (!check) return;
    const current = state.snippetScale || state.snippetFitScale || 1;
    const maxScale = Math.max(16, state.snippetFitScale);
    state.snippetScale = clamp(current * multiplier, Math.max(0.1, state.snippetFitScale * 0.5), maxScale);
    renderSnippet();
  }

  function setSnippetPickTarget(target) {
    const check = snippetCheck();
    if (!check) return;
    check.pickTarget = target;
    render();
    renderSnippet();
  }

  function pickSnippetPixel(event) {
    const source = snippetSource();
    const check = snippetCheck(source);
    if (!source || !check) return;
    const rect = els.snippetCanvas.getBoundingClientRect();
    const scale = state.snippetScale || state.snippetFitScale || 1;
    const localX = clamp(event.clientX - rect.left, 0, rect.width - 1);
    const localY = clamp(event.clientY - rect.top, 0, rect.height - 1);
    const x = clamp(check.rect.x + Math.floor(localX / scale), 0, source.width - 1);
    const y = clamp(check.rect.y + Math.floor(localY / scale), 0, source.height - 1);
    const pixel = source.canvas.getContext("2d", { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
    check[check.pickTarget || "foreground"] = [pixel[0], pixel[1], pixel[2]];
    check.ratio = contrastRatio(check.foreground, check.background);
    render();
    renderSnippet();
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

  function isTypingTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest("textarea,[contenteditable=''],[contenteditable='true']")) return true;
    const input = target.closest("input");
    if (!input) return false;
    if (!(input instanceof HTMLInputElement)) return false;
    const nonTypingInputTypes = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);
    return !nonTypingInputTypes.has(input.type);
  }

  function clipboardImageFiles(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) return [];
    const files = [];

    for (const item of clipboard.items || []) {
      if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (!file) continue;
      files.push(file);
    }

    return files.map((file, index) => {
      if (file.name) return file;
      const extension = (file.type.split("/")[1] || "png").replace(/[^\w-]/g, "") || "png";
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      return new File([file], `screenshot-${stamp}-${index + 1}.${extension}`, {
        type: file.type || `image/${extension}`,
        lastModified: Date.now()
      });
    });
  }

  async function onPaste(event) {
    if (isTypingTarget(event.target)) return;
    const images = clipboardImageFiles(event);
    if (!images.length) return;
    event.preventDefault();
    await handleFiles(images);
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
      <label>End page<input id="pdfEndPage" type="number" min="1" max="${pdf.numPages}" value="${pdf.numPages}"></label>
    `;
    els.pdfImportStatus.hidden = true;
    els.pdfImportStatusText.textContent = "";
    els.importPdfPagesButton.disabled = false;
    els.pdfImportCancelButton.disabled = false;
    els.pdfDialog.showModal();
    await new Promise((resolve) => {
      els.pdfDialog.addEventListener("close", resolve, { once: true });
    });
  }

  function yieldPdfImportUi() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  }

  async function setPdfImportStatus(message) {
    els.pdfImportStatusText.textContent = message;
    await yieldPdfImportUi();
  }

  async function importPendingPdfPages(event) {
    event.preventDefault();
    if (!state.pendingPdf) return;
    const startInput = document.querySelector("#pdfStartPage");
    const endInput = document.querySelector("#pdfEndPage");
    const pdf = state.pendingPdf.pdf;
    const start = clamp(Number(startInput.value) || 1, 1, pdf.numPages);
    const end = clamp(Number(endInput.value) || start, start, pdf.numPages);
    const totalSelected = end - start + 1;

    els.importPdfPagesButton.disabled = true;
    els.pdfImportCancelButton.disabled = true;
    els.pdfImportStatus.hidden = false;
    els.pdfDialog.setAttribute("aria-busy", "true");

    try {
      await setPdfImportStatus("Working in the background — preparing pages…");
      let done = 0;
      for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
        done += 1;
        await setPdfImportStatus(
          `Working in the background — rendering page ${pageNumber} (${done} of ${totalSelected}).`
        );
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
      await setPdfImportStatus("Finishing up…");
      state.pendingPdf = null;
      els.pdfDialog.close("imported");
      render();
    } catch (err) {
      console.error(err);
      alert(`Could not import PDF pages. ${err && err.message ? err.message : "Unknown error."}`);
    } finally {
      els.pdfImportStatus.hidden = true;
      els.pdfImportStatusText.textContent = "";
      els.importPdfPagesButton.disabled = false;
      els.pdfImportCancelButton.disabled = false;
      els.pdfDialog.removeAttribute("aria-busy");
    }
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

  function rgbEqual(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
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

    let foreground = foregroundCandidate?.rgb || sorted[Math.min(1, sorted.length - 1)].rgb;

    if (rgbEqual(foreground, background)) {
      const alternative = sorted
        .filter((cluster) => !rgbEqual(cluster.rgb, background))
        .map((cluster) => ({
          rgb: cluster.rgb,
          contrast: contrastRatio(cluster.rgb, background)
        }))
        .sort((a, b) => b.contrast - a.contrast)[0];
      foreground = alternative?.rgb ?? (luminance(background) >= 0.5 ? [0, 0, 0] : [255, 255, 255]);
    }

    return { foreground, background };
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

  /** Solid fills tried in order; first max-contrast vs local image wins a tie. */
  const BADGE_FILL_CANDIDATES = [
    [21, 87, 166],
    [255, 255, 255],
    [18, 18, 24],
    [232, 93, 4],
    [124, 16, 145],
    [0, 132, 104],
    [220, 48, 48]
  ];

  function rgbToCss(rgb) {
    return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
  }

  function averageRgbUnderRect(source, sx, sy, sw, sh) {
    const iw = source.width;
    const ih = source.height;
    const x0 = clamp(Math.floor(sx), 0, Math.max(0, iw - 1));
    const y0 = clamp(Math.floor(sy), 0, Math.max(0, ih - 1));
    const x1 = clamp(Math.ceil(sx + sw), x0 + 1, iw);
    const y1 = clamp(Math.ceil(sy + sh), y0 + 1, ih);
    const w = x1 - x0;
    const h = y1 - y0;
    const ctx = source.canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(x0, y0, w, h);
    const data = image.data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n += 1;
    }
    if (n === 0) return [128, 128, 128];
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  function pickBadgeFillForBackground(bgRgb) {
    let best = BADGE_FILL_CANDIDATES[0];
    let bestScore = contrastRatio(best, bgRgb);
    for (let i = 1; i < BADGE_FILL_CANDIDATES.length; i += 1) {
      const c = BADGE_FILL_CANDIDATES[i];
      const score = contrastRatio(c, bgRgb);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  function pickBadgeTextOnFill(fillRgb) {
    const onWhite = contrastRatio([255, 255, 255], fillRgb);
    const onBlack = contrastRatio([12, 12, 18], fillRgb);
    return onWhite >= onBlack ? [255, 255, 255] : [12, 12, 18];
  }

  function badgeColorsForSourceRect(source, sx, sy, sw, sh) {
    const bgSample = averageRgbUnderRect(source, sx, sy, sw, sh);
    const fill = pickBadgeFillForBackground(bgSample);
    const textRgb = pickBadgeTextOnFill(fill);
    return { fill, textRgb };
  }

  function displayBadgeBoxToSourceRect(displayRect, bx, by, bw, bh) {
    return {
      sx: (bx - displayRect.x) / displayRect.scale,
      sy: (by - displayRect.y) / displayRect.scale,
      sw: bw / displayRect.scale,
      sh: bh / displayRect.scale
    };
  }

  function rgbToHex(rgb) {
    return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }

  function parseHex(value) {
    const match = String(value).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return null;
    let hex = match[1].toLowerCase();
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
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
      drawReportBadge(ctx, source, index + 1, check.rect.x + 8 * scale, check.rect.y + 8 * scale, scale);
      ctx.restore();
    });
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  function drawReportBadge(ctx, source, number, x, y, scale) {
    const label = String(number);
    const width = Math.max(34 * scale, label.length * 14 * scale + 18 * scale);
    const height = 30 * scale;
    const { fill, textRgb } = badgeColorsForSourceRect(source, x, y, width, height);
    ctx.fillStyle = rgbToCss(fill);
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = rgbToCss(textRgb);
    ctx.font = `${18 * scale}px Avenir Next, Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + width / 2, y + height / 2);
  }

  /** Normative excerpts from WCAG 2.2 SC 1.4.3 Contrast (Minimum). https://www.w3.org/TR/WCAG22/#contrast-minimum */
  const WCAG_143_CONTRAST_MINIMUM = {
    specUrl: "https://www.w3.org/TR/WCAG22/#contrast-minimum",
    normalText:
      "The visual presentation of text and images of text has a contrast ratio of at least 4.5:1, except for the following:",
    largeScale:
      "Large-scale text and images of large-scale text have a contrast ratio of at least 3:1;",
    exemptUi:
      "Text or images of text that are part of an inactive user interface component, that are pure decoration, that are not visible to anyone, or that are part of a picture that contains significant other visual content, have no contrast requirement.",
    exemptLogo: "Text that is part of a logo or brand name has no contrast requirement."
  };

  /** Normative excerpts from WCAG 2.2 SC 1.4.6 Contrast (Enhanced). https://www.w3.org/TR/WCAG22/#contrast-enhanced */
  const WCAG_146_CONTRAST_ENHANCED = {
    specUrl: "https://www.w3.org/TR/WCAG22/#contrast-enhanced",
    normalText:
      "The visual presentation of text and images of text has a contrast ratio of at least 7:1, except for the following:",
    largeScale:
      "Large-scale text and images of large-scale text have a contrast ratio of at least 4.5:1;"
  };

  /** @returns {number} y after table */
  function drawWcagContrastPassCriteriaTable(doc, page, yStart) {
    const left = page.margin;
    const tableW = page.width - page.margin * 2;
    const colLabelW = 30;
    const colTextW = tableW - colLabelW;
    const xText = left + colLabelW + 2;
    const pad = 2;
    const lineH = 3.2;
    const fontBody = 6.5;
    const fontHead = 7;

    const exemptCombined = `${WCAG_143_CONTRAST_MINIMUM.exemptUi} ${WCAG_143_CONTRAST_MINIMUM.exemptLogo}`;
    const blocks = [
      {
        banner: "Success Criterion 1.4.3 Contrast (Minimum) (Level AA)",
        specUrl: WCAG_143_CONTRAST_MINIMUM.specUrl,
        rows: [
          { label: "Text / images of text", text: WCAG_143_CONTRAST_MINIMUM.normalText },
          { label: "Large-scale text", text: WCAG_143_CONTRAST_MINIMUM.largeScale },
          { label: "No requirement", text: exemptCombined }
        ]
      },
      {
        banner: "Success Criterion 1.4.6 Contrast (Enhanced) (Level AAA)",
        specUrl: WCAG_146_CONTRAST_ENHANCED.specUrl,
        rows: [
          { label: "Text / images of text", text: WCAG_146_CONTRAST_ENHANCED.normalText },
          { label: "Large-scale text", text: WCAG_146_CONTRAST_ENHANCED.largeScale },
          { label: "No requirement", text: exemptCombined }
        ]
      }
    ];

    let y = yStart;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Pass criteria — WCAG 2.2 text contrast", left, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(21, 87, 166);
    doc.textWithLink("§1.4.3 — w3.org/TR/WCAG22/#contrast-minimum", left, y, {
      url: WCAG_143_CONTRAST_MINIMUM.specUrl
    });
    y += 3.5;
    doc.textWithLink("§1.4.6 — w3.org/TR/WCAG22/#contrast-enhanced", left, y, {
      url: WCAG_146_CONTRAST_ENHANCED.specUrl
    });
    doc.setTextColor(0, 0, 0);
    y += 5;

    doc.setDrawColor(180, 172, 160);
    doc.setLineWidth(0.15);

    const headerH = 6;
    doc.setFillColor(21, 87, 166);
    doc.rect(left, y, tableW, headerH, "F");
    doc.rect(left, y, tableW, headerH);
    doc.line(left + colLabelW, y, left + colLabelW, y + headerH);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("Case", left + pad, y + 4.2);
    doc.text("Requirement (normative)", xText, y + 4.2);
    doc.setTextColor(0, 0, 0);
    y += headerH;

    for (const block of blocks) {
      const bannerLines = doc.splitTextToSize(block.banner, tableW - pad * 2);
      const linkShow = block.specUrl.replace(/^https:\/\//, "");
      const bannerH = Math.max(8.5, bannerLines.length * lineH + lineH + pad * 2 + 1.2);

      doc.setFillColor(232, 238, 248);
      doc.rect(left, y, tableW, bannerH, "F");
      doc.rect(left, y, tableW, bannerH);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      doc.setTextColor(15, 55, 100);
      let by = y + pad + lineH * 0.85;
      for (const line of bannerLines) {
        doc.text(line, left + pad, by);
        by += lineH;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.2);
      doc.setTextColor(21, 87, 166);
      doc.textWithLink(linkShow, left + pad, by, { url: block.specUrl });
      doc.setTextColor(0, 0, 0);
      y += bannerH;

      for (const row of block.rows) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(fontHead);
        const labelLines = doc.splitTextToSize(row.label, colLabelW - pad);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(fontBody);
        const textLines = doc.splitTextToSize(row.text, colTextW - pad * 2);
        const rowH = Math.max(
          labelLines.length * lineH,
          textLines.length * lineH,
          lineH + pad * 2
        );

        doc.rect(left, y, tableW, rowH);
        doc.line(left + colLabelW, y, left + colLabelW, y + rowH);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(fontHead);
        let ly = y + pad + lineH * 0.85;
        for (const line of labelLines) {
          doc.text(line, left + pad, ly);
          ly += lineH;
        }

        doc.setFont("helvetica", "normal");
        doc.setFontSize(fontBody);
        let ty = y + pad + lineH * 0.85;
        for (const line of textLines) {
          doc.text(line, xText, ty);
          ty += lineH;
        }

        y += rowH;
      }
    }

    return y + 2;
  }

  async function exportReport() {
    if (!window.jspdf?.jsPDF) {
      alert("PDF export support did not load. Check your network connection and try again.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const page = { width: 210, height: 297, margin: 14 };
    page.bottom = page.height - page.margin;
    let y = page.margin;
    const checks = state.sources.flatMap((source) => source.checks);
    const failing = checks.filter((check) => check.ratio < 4.5).length;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Contrast Check Report", page.margin, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Generated ${new Date().toLocaleString()}`, page.margin, y);
    y += 6;
    doc.text(`${state.sources.length} sources | ${checks.length} checks | ${failing} AA normal failures`, page.margin, y);
    y += 8;
    doc.text("This report was generated with the colour checker tool at", page.margin, y);
    y += 5;
    doc.setTextColor(21, 87, 166);
    doc.textWithLink(toolPagesUrl, page.margin, y, { url: toolPagesUrl });
    doc.setTextColor(0, 0, 0);
    y += 8;
    y = drawWcagContrastPassCriteriaTable(doc, page, y);
    y += 6;

    let exportSectionNumber = 0;
    for (const [sourceIndex, source] of state.sources.entries()) {
      if (source.checks.length === 0) continue;
      if (sourceIndex > 0 || y > page.margin) {
        doc.addPage();
      }
      y = page.margin;
      exportSectionNumber += 1;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      const exportTitleName = source.name.replace(/\s*-\s*page\s+\d+$/i, "");
      doc.text(`${exportSectionNumber}. ${exportTitleName}`, page.margin, y, { maxWidth: page.width - page.margin * 2 });
      y += 7;

      const imageWidth = page.width - page.margin * 2;
      const imageHeight = Math.min(125, imageWidth * (source.height / source.width));
      doc.addImage(annotatedImageData(source), "JPEG", page.margin, y, imageWidth, imageHeight);
      y += imageHeight + 8;

      const tableLayout = pdfTableLayout(source);
      y = drawTableHeader(doc, page, y, tableLayout);
      for (const [checkIndex, check] of source.checks.entries()) {
        if (y + CHECK_ROW_HEIGHT > page.bottom) {
          doc.addPage();
          y = page.margin;
          y = drawTableHeader(doc, page, y, tableLayout);
        }
        y = drawCheckRow(doc, page, y, check, checkIndex + 1, tableLayout);
      }
      y += 8;
    }

    doc.save(`contrast-check-${dateStamp()}.pdf`);
  }

  function isDefaultCheckLabel(label) {
    return /^\s*Check\s+\d+\s*$/i.test(String(label || ""));
  }

  function pdfTableLayout(source) {
    const showLabelCol = source.checks.some((check) => !isDefaultCheckLabel(check.label));
    if (showLabelCol) {
      return {
        showLabelCol: true,
        num: page => page.margin + 2,
        crop: page => page.margin + 12,
        label: page => page.margin + 45,
        labelMaxW: 32,
        colors: page => page.margin + 82,
        ratio: page => page.margin + 122,
        result: page => page.margin + 142
      };
    }
    return {
      showLabelCol: false,
      num: page => page.margin + 2,
      crop: page => page.margin + 12,
      label: null,
      labelMaxW: 0,
      colors: page => page.margin + 45,
      ratio: page => page.margin + 100,
      result: page => page.margin + 130
    };
  }

  function drawTableHeader(doc, page, y, layout) {
    doc.setFillColor(21, 87, 166);
    doc.rect(page.margin, y, page.width - page.margin * 2, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("#", layout.num(page), y + 5.5);
    doc.text("Crop", layout.crop(page), y + 5.5);
    if (layout.showLabelCol) {
      doc.text("Label", layout.label(page), y + 5.5);
    }
    doc.text("Colors", layout.colors(page), y + 5.5);
    doc.text("Ratio", layout.ratio(page), y + 5.5);
    doc.text("Result", layout.result(page), y + 5.5);
    doc.setTextColor(0, 0, 0);
    return y + 9;
  }

  const CHECK_ROW_HEIGHT = 27;

  function drawCheckRow(doc, page, y, check, number, layout) {
    doc.setDrawColor(216, 209, 194);
    doc.rect(page.margin, y, page.width - page.margin * 2, CHECK_ROW_HEIGHT);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(String(number), layout.num(page), y + 7);
    drawCropPreview(doc, check, layout.crop(page), y + 3, 26, 18);
    doc.setFont("helvetica", "normal");
    if (layout.showLabelCol && !isDefaultCheckLabel(check.label)) {
      doc.text(check.label || `Check ${number}`, layout.label(page), y + 7, { maxWidth: layout.labelMaxW });
    }
    const cx = layout.colors(page);
    drawColorValue(doc, `FG ${rgbToHex(check.foreground)}`, check.foreground, cx, y + 7);
    drawColorValue(doc, `BG ${rgbToHex(check.background)}`, check.background, cx, y + 13);
    doc.setFont("helvetica", "bold");
    doc.text(`${formatRatio(check.ratio)}:1`, layout.ratio(page), y + 7);
    drawResultValue(doc, check, layout.result(page), y + 7);
    doc.setTextColor(0, 0, 0);
    return y + CHECK_ROW_HEIGHT;
  }

  function drawCropPreview(doc, check, x, y, maxWidth, maxHeight) {
    const { width, height } = check.rect;
    const scale = Math.min(maxWidth / width, maxHeight / height);
    const previewWidth = width * scale;
    const previewHeight = height * scale;
    doc.addImage(
      check.cropDataUrl,
      "PNG",
      x + (maxWidth - previewWidth) / 2,
      y + (maxHeight - previewHeight) / 2,
      previewWidth,
      previewHeight
    );
  }

  function drawColorValue(doc, label, color, x, y) {
    const swatchRadius = 2.4;
    const textWidth = doc.getTextWidth(label);
    const centerX = x + textWidth + 4.2;
    const centerY = y - 1.4;
    const [r, g, b] = color;
    doc.setDrawColor(160, 150, 132);
    doc.setFillColor(r, g, b);
    doc.circle(centerX, centerY, swatchRadius, "FD");
    doc.setTextColor(0, 0, 0);
    doc.text(label, x, y);
  }

  function drawResultValue(doc, check, x, y) {
    const aaNormalPass = check.ratio >= 4.5;
    const resultColor = aaNormalPass ? [23, 114, 69] : [180, 35, 24];
    doc.setTextColor(...resultColor);
    doc.setFontSize(8);
    doc.text(`AA normal ${aaNormalPass ? "pass" : "fail"}`, x, y, { maxWidth: 50 });
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(`AA large ${check.ratio >= 3 ? "pass" : "fail"}`, x, y + 6, { maxWidth: 50 });
    doc.text(`AAA ${check.ratio >= 7 ? "pass" : "fail"}`, x, y + 11, { maxWidth: 50 });
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

  els.snippetPickFgButton.addEventListener("click", () => setSnippetPickTarget("foreground"));
  els.snippetPickBgButton.addEventListener("click", () => setSnippetPickTarget("background"));
  els.snippetZoomOutButton.addEventListener("click", () => zoomSnippet(0.8));
  els.snippetZoomInButton.addEventListener("click", () => zoomSnippet(1.25));
  els.snippetZoomFitButton.addEventListener("click", () => {
    setSnippetFitScale();
    renderSnippet();
  });
  els.snippetCanvas.addEventListener("click", pickSnippetPixel);
  els.closeSnippetButton.addEventListener("click", closeSnippetPicker);
  els.snippetDialog.addEventListener("close", () => {
    state.snippetSourceId = null;
    state.snippetCheckId = null;
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
  els.openEditorButton.addEventListener("click", openEditor);
  els.deleteSourceButton.addEventListener("click", () => {
    const current = activeSource();
    if (!current) return;
    state.sources = state.sources.filter((source) => source.id !== current.id);
    state.activeSourceId = state.sources[0]?.id || null;
    state.activeCheckId = activeSource()?.checks[0]?.id || null;
    render();
  });
  window.addEventListener("paste", onPaste);

  window.addEventListener("resize", () => {
    render();
    if (els.editorDialog.open) {
      setEditorFitScale();
      renderEditor();
    }
    if (els.snippetDialog.open) {
      setSnippetFitScale();
      renderSnippet();
    }
  });
  new ResizeObserver(render).observe(els.dropZone);
  render();
})();
