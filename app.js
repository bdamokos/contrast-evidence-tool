(function () {
  "use strict";

  /**
   * Same version as index.html (pdf.mjs + modulepreload SRI). Worker fetches are not
   * SRI-wrapped; pinning the exact jsdelivr file limits drift.
   * @see https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/legacy/build/pdf.worker.min.mjs
   */
  const pdfWorkerUrl = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/legacy/build/pdf.worker.min.mjs";
  /** Tesseract: pinned 5.1.1; integrity must match this exact URL. */
  const TESSERACT_JS = {
    url: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
    integrity: "sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F"
  };
  /** Published site (GitHub Pages); update if the repo or username changes. */
  const toolPagesUrl = "https://contrast.bdamokos.org/";
  const debugSampling = new URLSearchParams(window.location.search).has("debugSampling");

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

  function clearInteractionState() {
    state.draftRect = null;
    state.dragStart = null;
    state.resizeDrag = null;
  }

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
    detectTextButton: document.querySelector("#detectTextButton"),
    removeDetectedButton: document.querySelector("#removeDetectedButton"),
    openEditorButton: document.querySelector("#openEditorButton"),
    deleteSourceButton: document.querySelector("#deleteSourceButton"),
    sourceCount: document.querySelector("#sourceCount"),
    sourcesList: document.querySelector("#sourcesList"),
    activeSourceTitle: document.querySelector("#activeSourceTitle"),
    activeSourceMeta: document.querySelector("#activeSourceMeta"),
    dropZone: document.querySelector("#dropZone"),
    pdfPreparingOverlay: document.querySelector("#pdfPreparingOverlay"),
    pdfPreparingStatusText: document.querySelector("#pdfPreparingStatusText"),
    imageCanvas: document.querySelector("#imageCanvas"),
    overlayCanvas: document.querySelector("#overlayCanvas"),
    overlayDeleteLayer: document.querySelector("#overlayDeleteLayer"),
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
    editorDeleteLayer: document.querySelector("#editorDeleteLayer"),
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
    const analysisLabel = source.analysis
      ? ` | ${source.analysis.blocks.length} text blocks`
      : "";
    els.activeSourceMeta.textContent = `${source.width} x ${source.height}px | ${source.checks.length} checks${analysisLabel}`;

    state.displayRect = fitRect(source, bounds);
    imageCtx.drawImage(
      source.canvas,
      state.displayRect.x,
      state.displayRect.y,
      state.displayRect.width,
      state.displayRect.height
    );
    drawOverlay();
    renderDeleteHandles("main");
  }

  function drawOverlay() {
    const source = activeSource();
    const bounds = els.dropZone.getBoundingClientRect();
    overlayCtx.clearRect(0, 0, bounds.width, bounds.height);
    if (!source || !state.displayRect) {
      renderDeleteHandles("main");
      return;
    }

    source.checks.forEach((check, index) => {
      const rect = sourceToDisplayRect(check.rect);
      const isActive = check.id === state.activeCheckId;
      overlayCtx.save();
      overlayCtx.lineWidth = isActive ? 3 : 2;
      if (isActive) {
        overlayCtx.strokeStyle = "#ffe45c";
        overlayCtx.fillStyle = "rgba(255, 228, 92, 0.08)";
      } else {
        const { strokeRgb } = markingColorsForCheckRect(source, check.rect);
        overlayCtx.strokeStyle = rgbToCss(strokeRgb);
        overlayCtx.fillStyle = rgbaCss(strokeRgb, 0.06);
      }
      overlayCtx.fillRect(rect.x, rect.y, rect.width, rect.height);
      overlayCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      drawNumberBadge(overlayCtx, index + 1, rect, bounds, source, state.displayRect, check.rect);
      overlayCtx.restore();
    });

    if (state.draftRect) {
      const rect = sourceToDisplayRect(state.draftRect);
      const { strokeRgb } = markingColorsForCheckRect(source, state.draftRect);
      overlayCtx.save();
      overlayCtx.setLineDash([7, 5]);
      overlayCtx.lineWidth = 2;
      overlayCtx.strokeStyle = rgbToCss(strokeRgb);
      overlayCtx.fillStyle = rgbaCss(strokeRgb, 0.04);
      overlayCtx.fillRect(rect.x, rect.y, rect.width, rect.height);
      overlayCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      overlayCtx.restore();
    }
  }

  const BADGE_GAP_SCREEN = 6;
  const DELETE_HANDLE_SIZE = 20;
  const RESIZE_HANDLE_SIZE = 18;

  function deleteHandleRect(displayRect, bounds) {
    const size = DELETE_HANDLE_SIZE;
    return {
      x: clamp(displayRect.x + displayRect.width - size / 2, 4, Math.max(4, bounds.width - size - 4)),
      y: clamp(displayRect.y - size / 2, 4, Math.max(4, bounds.height - size - 4)),
      width: size,
      height: size
    };
  }

  function resizeHandleRect(displayRect, bounds) {
    const size = RESIZE_HANDLE_SIZE;
    return {
      x: clamp(displayRect.x + displayRect.width - size + 2, 4, Math.max(4, bounds.width - size - 4)),
      y: clamp(displayRect.y + displayRect.height - size + 2, 4, Math.max(4, bounds.height - size - 4)),
      width: size,
      height: size
    };
  }

  function renderDeleteHandles(target = "main") {
    const source = activeSource();
    const displayRect = target === "editor" ? state.editorDisplayRect : state.displayRect;
    const layer = target === "editor" ? els.editorDeleteLayer : els.overlayDeleteLayer;
    if (!layer) return;
    layer.replaceChildren();
    if (!source || !displayRect) return;
    const bounds = target === "editor"
      ? { width: displayRect.width, height: displayRect.height }
      : els.dropZone.getBoundingClientRect();

    source.checks.forEach((check, index) => {
      const rect = sourceRectToDisplay(check.rect, displayRect);
      const deleteBox = deleteHandleRect(rect, bounds);
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "rectangleDeleteHandle";
      deleteButton.setAttribute("aria-label", `Remove rectangle ${index + 1}`);
      deleteButton.style.left = `${deleteBox.x}px`;
      deleteButton.style.top = `${deleteBox.y}px`;
      deleteButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeCheck(source, check.id);
      });
      layer.append(deleteButton);

      const resizeBox = resizeHandleRect(rect, bounds);
      const resizeButton = document.createElement("button");
      resizeButton.type = "button";
      resizeButton.className = "rectangleResizeHandle";
      resizeButton.setAttribute("aria-label", `Resize rectangle ${index + 1}`);
      resizeButton.style.left = `${resizeBox.x}px`;
      resizeButton.style.top = `${resizeBox.y}px`;
      resizeButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startResizeDrag(event, source, check, target);
      });
      layer.append(resizeButton);
    });
  }

  function removeCheck(source, checkId) {
    source.checks = source.checks.filter((check) => check.id !== checkId);
    state.activeCheckId = source.checks[0]?.id || null;
    state.dragStart = null;
    state.draftRect = null;
    render();
    if (els.editorDialog.open) renderEditor();
  }

  /**
   * Same badge anchor everywhere (main overlay, editor, PDF export): try above → right → below →
   * left of the selection rect, then clamp inside bounds. `rect` and `bounds` share one space.
   */
  function computeBadgeTopLeft(rect, bounds, badgeWidth, badgeHeight, gap) {
    const margin = 4;
    const positions = [
      { x: rect.x, y: rect.y - badgeHeight - gap },
      { x: rect.x + rect.width + gap, y: rect.y },
      { x: rect.x, y: rect.y + rect.height + gap },
      { x: rect.x - badgeWidth - gap, y: rect.y }
    ];
    const chosen = positions.find((pos) => (
      pos.x >= margin &&
      pos.y >= margin &&
      pos.x + badgeWidth <= bounds.width - margin &&
      pos.y + badgeHeight <= bounds.height - margin
    )) || positions[0];
    return {
      x: clamp(chosen.x, margin, Math.max(margin, bounds.width - badgeWidth - margin)),
      y: clamp(chosen.y, margin, Math.max(margin, bounds.height - badgeHeight - margin))
    };
  }

  function reportAnnotationScale(sourceWidth) {
    return Math.max(1, Math.round(sourceWidth / 1200));
  }

  function reportBadgeDimensions(number, scale) {
    const label = String(number);
    return {
      width: Math.max(34 * scale, label.length * 14 * scale + 18 * scale),
      height: 30 * scale
    };
  }

  function drawNumberBadge(ctx, number, rect, bounds, source, displayRect, checkRectSource) {
    const label = String(number);
    const width = Math.max(24, label.length * 10 + 14);
    const height = 24;
    const { x: bx, y: by } = computeBadgeTopLeft(rect, bounds, width, height, BADGE_GAP_SCREEN);

    let fillRgb = BADGE_FILL_CANDIDATES[0];
    let textRgb = [255, 255, 255];
    if (source && displayRect && checkRectSource) {
      const colors = badgeColorsForDisplayBadge(source, displayRect, bx, by, width, height, checkRectSource);
      fillRgb = colors.fill;
      textRgb = colors.textRgb;
    }

    ctx.fillStyle = rgbToCss(fillRgb);
    ctx.fillRect(bx, by, width, height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = textRgb[0] + textRgb[1] + textRgb[2] > 500 ? "rgba(0, 0, 0, 0.38)" : "rgba(255, 255, 255, 0.55)";
    ctx.strokeRect(bx + 0.5, by + 0.5, width - 1, height - 1);
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
      const methodBadge = node.querySelector(".methodBadge");
      const mismatchBadge = node.querySelector(".mismatchBadge");
      const detectionError = node.querySelector(".detectionError");
      methodBadge.textContent = sampleMethodLabel(check);
      methodBadge.hidden = !debugSampling;
      mismatchBadge.textContent = check.ocrRasterMismatch
        ? "OCR colors differ from raster sample"
        : "";
      mismatchBadge.hidden = !check.ocrRasterMismatch;
      detectionError.textContent = check.detectionError || "";
      detectionError.hidden = !check.detectionError;

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
      check.detectionError = null;
      render();
    });
    colorInput.addEventListener("input", () => {
      const parsed = parseHex(colorInput.value);
      if (!parsed) return;
      check[key] = parsed;
      check.ratio = contrastRatio(check.foreground, check.background);
      check.detectionError = null;
      updateCheckColorControls(node, check);
      updateCheckBadges(node, check);
      updateResultSummary(node, check);
      updateDetectionError(node, check);
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

  function updateDetectionError(node, check) {
    const detectionError = node.querySelector(".detectionError");
    detectionError.textContent = check.detectionError || "";
    detectionError.hidden = !check.detectionError;
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
      check.detectionError = null;
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
    const source = activeSource();
    const hasAutoDetectedChecks = Boolean(source?.checks.some((check) => check.autoDetected));
    els.exportButton.disabled = !hasChecks;
    els.resetButton.disabled = !hasSources;
    els.detectTextButton.disabled = !source;
    if (els.removeDetectedButton) {
      els.removeDetectedButton.hidden = !hasAutoDetectedChecks;
      els.removeDetectedButton.disabled = !hasAutoDetectedChecks;
    }
    els.openEditorButton.disabled = !source;
    els.deleteSourceButton.disabled = !source;
  }

  function displayPointToSource(event, target = "main") {
    const displayRect = target === "editor" ? state.editorDisplayRect : state.displayRect;
    const point = displayCanvasPoint(event, target);
    if (!displayRect) return null;
    const within =
      point.x >= displayRect.x &&
      point.y >= displayRect.y &&
      point.x <= displayRect.x + displayRect.width &&
      point.y <= displayRect.y + displayRect.height;
    if (!within) return null;
    return {
      x: (point.x - displayRect.x) / displayRect.scale,
      y: (point.y - displayRect.y) / displayRect.scale
    };
  }

  function displayCanvasPoint(event, target = "main") {
    const canvas = target === "editor" ? els.editorOverlayCanvas : els.overlayCanvas;
    const canvasRect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - canvasRect.left,
      y: event.clientY - canvasRect.top
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

  function rectFromAnchorAndPoint(anchor, point, source) {
    return normalizeRect(anchor, point, source);
  }

  function refreshCheckAfterRectChange(source, check) {
    const sample = sampleColorsForRect(source, check.rect);
    check.cropDataUrl = cropData(source, check.rect);
    check.foreground = sample.foreground;
    check.background = sample.background;
    check.ratio = contrastRatio(sample.foreground, sample.background);
    check.method = sample.method;
    check.confidence = sample.confidence;
    check.detectionError = sample.detectionError || null;
    check.ocrRasterMismatch = sample.ocrRasterMismatch || null;
  }

  function startResizeDrag(event, source, check, target) {
    const pointerCanvas = target === "editor" ? els.editorOverlayCanvas : els.overlayCanvas;
    state.resizeDrag = {
      sourceId: source.id,
      checkId: check.id,
      target,
      anchor: {
        x: check.rect.x,
        y: check.rect.y
      }
    };
    state.activeSourceId = source.id;
    state.activeCheckId = check.id;
    state.dragStart = null;
    state.draftRect = null;
    pointerCanvas.setPointerCapture(event.pointerId);
    drawTargetOverlay(target);
  }

  function onPointerDown(event, target = "main") {
    const source = activeSource();
    if (!source) return;
    const point = displayPointToSource(event, target);
    if (!point) return;

    state.dragStart = point;
    state.draftRect = normalizeRect(point, point, source);
    (target === "editor" ? els.editorOverlayCanvas : els.overlayCanvas).setPointerCapture(event.pointerId);
    drawTargetOverlay(target);
  }

  function onPointerMove(event, target = "main") {
    const source = activeSource();
    if (!source) return;
    const point = displayPointToSource(event, target);
    if (!point) return;
    if (state.resizeDrag) {
      const resizeSource = state.sources.find((item) => item.id === state.resizeDrag.sourceId);
      const check = resizeSource?.checks.find((item) => item.id === state.resizeDrag.checkId);
      if (!resizeSource || !check) return;
      check.rect = rectFromAnchorAndPoint(state.resizeDrag.anchor, point, resizeSource);
      check.cropDataUrl = cropData(resizeSource, check.rect);
      drawTargetOverlay(target);
      renderDeleteHandles(target);
      return;
    }
    if (!state.dragStart) return;
    state.draftRect = normalizeRect(state.dragStart, point, source);
    drawTargetOverlay(target);
  }

  function onPointerUp(event, target = "main") {
    const source = activeSource();
    if (state.resizeDrag) {
      const resizeSource = state.sources.find((item) => item.id === state.resizeDrag.sourceId);
      const check = resizeSource?.checks.find((item) => item.id === state.resizeDrag.checkId);
      (target === "editor" ? els.editorOverlayCanvas : els.overlayCanvas).releasePointerCapture(event.pointerId);
      if (resizeSource && check) {
        refreshCheckAfterRectChange(resizeSource, check);
      }
      state.resizeDrag = null;
      render();
      if (els.editorDialog.open) renderEditor();
      return;
    }
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
    clearInteractionState();
    state.editorScale = 0;
    els.editorDialog.showModal();
    requestAnimationFrame(() => {
      setEditorFitScale();
      renderEditor();
    });
  }

  function closeEditor() {
    clearInteractionState();
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
    renderDeleteHandles("editor");
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
      if (isActive) {
        editorOverlayCtx.strokeStyle = "#ffe45c";
        editorOverlayCtx.fillStyle = "rgba(255, 228, 92, 0.07)";
      } else {
        const { strokeRgb } = markingColorsForCheckRect(source, check.rect);
        editorOverlayCtx.strokeStyle = rgbToCss(strokeRgb);
        editorOverlayCtx.fillStyle = rgbaCss(strokeRgb, 0.05);
      }
      editorOverlayCtx.fillRect(rect.x, rect.y, rect.width, rect.height);
      editorOverlayCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      drawNumberBadge(editorOverlayCtx, index + 1, rect, bounds, source, state.editorDisplayRect, check.rect);
      editorOverlayCtx.restore();
    });

    if (state.draftRect) {
      const rect = sourceRectToDisplay(state.draftRect, state.editorDisplayRect);
      const { strokeRgb } = markingColorsForCheckRect(source, state.draftRect);
      editorOverlayCtx.save();
      editorOverlayCtx.setLineDash([8, 6]);
      editorOverlayCtx.lineWidth = 2;
      editorOverlayCtx.strokeStyle = rgbToCss(strokeRgb);
      editorOverlayCtx.fillStyle = rgbaCss(strokeRgb, 0.03);
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
    check.detectionError = null;
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

  function showPdfPreparing(message) {
    els.pdfPreparingStatusText.textContent = message;
    els.pdfPreparingOverlay.hidden = false;
    els.dropZone.classList.add("isPdfPreparing");
    els.dropZone.setAttribute("aria-busy", "true");
  }

  function hidePdfPreparing() {
    els.pdfPreparingOverlay.hidden = true;
    els.dropZone.classList.remove("isPdfPreparing");
    els.dropZone.removeAttribute("aria-busy");
    els.pdfPreparingStatusText.textContent = "";
  }

  async function setPdfPreparingMessage(message) {
    els.pdfPreparingStatusText.textContent = message;
    await yieldPdfImportUi();
  }

  /** Below this size we load the whole file at once (simpler, fast for small PDFs). */
  const PDF_FULL_READ_MAX_BYTES = 1.5 * 1024 * 1024;

  /**
   * Opens a PDF for metadata and later page rendering. Large files use range reads
   * (File.slice) so we do not buffer the entire document before the page picker.
   */
  async function openPdfDocumentForFile(file) {
    const pdfjs = window.pdfjsLib;
    const size = typeof file.size === "number" && file.size > 0 ? file.size : 0;
    if (size === 0 || size <= PDF_FULL_READ_MAX_BYTES) {
      const data = new Uint8Array(await file.arrayBuffer());
      return pdfjs.getDocument({ data }).promise;
    }

    const rangeChunkSize = 2 ** 17;
    const initialLen = Math.min(size, rangeChunkSize);
    const initialData = new Uint8Array(await file.slice(0, initialLen).arrayBuffer());
    const transport = new pdfjs.PDFDataRangeTransport(size, initialData);
    transport.requestDataRange = (begin, end) => {
      file
        .slice(begin, end)
        .arrayBuffer()
        .then((buffer) => {
          transport.onDataRange(begin, new Uint8Array(buffer));
        })
        .catch((err) => {
          console.error(err);
          transport.abort();
        });
    };

    const loadingTask = pdfjs.getDocument({
      range: transport,
      disableStream: true,
      disableAutoFetch: true,
      rangeChunkSize
    });
    try {
      return await loadingTask.promise;
    } catch (err) {
      await loadingTask.destroy();
      throw err;
    }
  }

  async function choosePdfPages(file) {
    if (!window.pdfjsLib) {
      alert("PDF support did not load. Check your network connection and try again.");
      return;
    }
    const sizeLabel =
      typeof file.size === "number" && file.size > 0
        ? ` (${file.size > 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`})`
        : "";
    const largeHint =
      typeof file.size === "number" && file.size > PDF_FULL_READ_MAX_BYTES
        ? " — scanning structure (not loading the whole file yet)"
        : "";
    showPdfPreparing(`Opening PDF${sizeLabel}${largeHint}…`);
    await yieldPdfImportUi();
    try {
      await setPdfPreparingMessage("Parsing PDF — resolving page count…");
      const pdf = await openPdfDocumentForFile(file);
      if (pdf.numPages === 1) {
        try {
          await importPdfPagesFromDocument({
            file,
            pdf,
            start: 1,
            end: 1,
            setStatus: setPdfPreparingMessage
          });
          render();
        } finally {
          await pdf.destroy().catch(() => {});
        }
        hidePdfPreparing();
        return;
      }
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
      hidePdfPreparing();
      els.pdfDialog.showModal();
      await new Promise((resolve) => {
        els.pdfDialog.addEventListener("close", resolve, { once: true });
      });
      if (state.pendingPdf?.pdf) {
        const { pdf } = state.pendingPdf;
        state.pendingPdf = null;
        pdf.destroy().catch(() => {});
      }
    } catch (err) {
      console.error(err);
      hidePdfPreparing();
      alert(`Could not open this PDF. ${err && err.message ? err.message : "Unknown error."}`);
    }
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

  async function importPdfPagesFromDocument({ file, pdf, start, end, setStatus }) {
    const totalSelected = end - start + 1;
    await setStatus("Working in the background — preparing pages…");
    let done = 0;
    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
      done += 1;
      await setStatus(
        `Working in the background — rendering page ${pageNumber} (${done} of ${totalSelected}).`
      );
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      await page.render({ canvasContext: ctx, viewport }).promise;
      let analysis = null;
      try {
        await setStatus(
          `Working in the background — reading text on page ${pageNumber} (${done} of ${totalSelected}).`
        );
        analysis = await buildPdfPageAnalysis(page, viewport, canvas, pageNumber);
      } catch (analysisErr) {
        console.warn("PDF text analysis failed", analysisErr);
      }
      addSource({
        name: `${file.name} - page ${pageNumber}`,
        type: "pdf page",
        width: canvas.width,
        height: canvas.height,
        canvas,
        analysis
      });
    }
    await setStatus("Finishing up…");
  }

  async function importPendingPdfPages(event) {
    event.preventDefault();
    if (!state.pendingPdf) return;
    const startInput = document.querySelector("#pdfStartPage");
    const endInput = document.querySelector("#pdfEndPage");
    const pdf = state.pendingPdf.pdf;
    const file = state.pendingPdf.file;
    const start = clamp(Number(startInput.value) || 1, 1, pdf.numPages);
    const end = clamp(Number(endInput.value) || start, start, pdf.numPages);

    els.importPdfPagesButton.disabled = true;
    els.pdfImportCancelButton.disabled = true;
    els.pdfImportStatus.hidden = false;
    els.pdfDialog.setAttribute("aria-busy", "true");

    try {
      await importPdfPagesFromDocument({ file, pdf, start, end, setStatus: setPdfImportStatus });
      const { pdf: openedPdf } = state.pendingPdf;
      state.pendingPdf = null;
      await openedPdf.destroy().catch(() => {});
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
    const sample = sampleColorsForRect(source, rect);
    const cropDataUrl = cropData(source, rect);
    return {
      id: uid("check"),
      label: `Check ${source.checks.length + 1}`,
      rect,
      cropDataUrl,
      foreground: sample.foreground,
      background: sample.background,
      ratio: contrastRatio(sample.foreground, sample.background),
      method: sample.method,
      confidence: sample.confidence,
      detectionError: sample.detectionError || null,
      ocrRasterMismatch: sample.ocrRasterMismatch || null,
      pickTarget: "foreground"
    };
  }

  function sampleMethodLabel(check) {
    const confidence = typeof check.confidence === "number" ? ` ${Math.round(check.confidence * 100)}%` : "";
    if (check.method === "pdf-native") return `PDF-native${confidence}`;
    if (check.method === "ocr-raster") return `OCR-guided${confidence}`;
    return "Raster fallback";
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

  async function buildPdfPageAnalysis(page, viewport, canvas, pageNumber) {
    const textItems = await extractPdfTextItems(page, viewport);
    await inferPdfTextColors(page, textItems);
    const blocks = detectTextBlocks(textItems);
    sampleBlockBackgrounds(canvas, blocks);
    return {
      kind: "pdf-page-analysis",
      version: 1,
      pageNumber,
      renderScale: viewport.scale || 1,
      pageSize: { width: canvas.width, height: canvas.height },
      blocks,
      normalMap: buildNormalMap(blocks, canvas.width, canvas.height)
    };
  }

  async function extractPdfTextItems(page, viewport) {
    const content = await page.getTextContent({ disableCombineTextItems: false });
    return content.items
      .map((item, index) => pdfTextItemToBlockSeed(item, index, viewport))
      .filter(Boolean);
  }

  function pdfTextItemToBlockSeed(item, index, viewport) {
    const text = String(item.str || "").trim();
    if (!text) return null;
    const tx = window.pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(item.height * viewport.scale) || 1;
    const width = Math.max(1, Math.abs(item.width * viewport.scale));
    const height = Math.max(1, fontHeight);
    const x = tx[4];
    const y = tx[5] - height;
    return {
      id: `pdf-item-${index}`,
      text,
      rect: {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.ceil(width),
        height: Math.ceil(height)
      },
      fontName: item.fontName,
      fontSize: height,
      direction: item.dir || "ltr",
      foreground: null,
      confidence: 0.7
    };
  }

  async function inferPdfTextColors(page, textItems) {
    if (!textItems.length) return;
    const operatorList = await page.getOperatorList();
    const ops = window.pdfjsLib.OPS || {};
    const fnArray = operatorList.fnArray || [];
    const argsArray = operatorList.argsArray || [];
    let currentFill = [0, 0, 0];
    let textIndex = 0;

    for (let i = 0; i < fnArray.length && textIndex < textItems.length; i += 1) {
      const fn = fnArray[i];
      const args = argsArray[i] || [];
      const fill = fillColorFromPdfOperator(fn, args, ops);
      if (fill) {
        currentFill = fill;
        continue;
      }

      const paintedCount = pdfTextPaintItemCount(fn, args, ops);
      if (paintedCount <= 0) continue;
      for (let n = 0; n < paintedCount && textIndex < textItems.length; n += 1) {
        textItems[textIndex].foreground = {
          rgb: currentFill,
          source: "pdf-operator",
          confidence: 0.82
        };
        textItems[textIndex].confidence = Math.max(textItems[textIndex].confidence, 0.82);
        textIndex += 1;
      }
    }

    for (; textIndex < textItems.length; textIndex += 1) {
      textItems[textIndex].foreground = {
        rgb: [0, 0, 0],
        source: "text-layer-inferred",
        confidence: 0.45
      };
    }
  }

  function fillColorFromPdfOperator(fn, args, ops) {
    if (fn === ops.setFillRGBColor) {
      return normalizePdfColor(args.slice(0, 3));
    }
    if (fn === ops.setFillGray) {
      const gray = normalizePdfColorComponent(args[0]);
      return [gray, gray, gray];
    }
    if (fn === ops.setFillCMYKColor) {
      return cmykToRgb(args[0], args[1], args[2], args[3]);
    }
    return null;
  }

  function pdfTextPaintItemCount(fn, args, ops) {
    if (
      fn === ops.showText ||
      fn === ops.showSpacedText ||
      fn === ops.nextLineShowText ||
      fn === ops.nextLineSetSpacingShowText
    ) {
      return 1;
    }
    if (fn === ops.showType3Text && Array.isArray(args[0])) {
      return args[0].filter((item) => typeof item !== "number").length || 1;
    }
    return 0;
  }

  function normalizePdfColor(values) {
    const flattened = flattenPdfColorArgs(values);
    const parsedString = flattened.map(parsePdfColorString).find(Boolean);
    if (parsedString) return parsedString;
    if (flattened.length === 1) {
      const single = Number(flattened[0]);
      if (Number.isFinite(single) && single > 1 && single <= 0xffffff) {
        return [
          (single >> 16) & 255,
          (single >> 8) & 255,
          single & 255
        ];
      }
    }
    const components = flattened.slice(0, 3).map(normalizePdfColorComponent);
    while (components.length < 3) components.push(components[0] ?? 0);
    return components;
  }

  function parsePdfColorString(value) {
    if (typeof value !== "string") return null;
    const hex = value.trim().match(/^#?([0-9a-f]{6})$/i);
    if (hex) {
      return [
        parseInt(hex[1].slice(0, 2), 16),
        parseInt(hex[1].slice(2, 4), 16),
        parseInt(hex[1].slice(4, 6), 16)
      ];
    }
    const rgb = value.match(/rgba?\(([^)]+)\)/i);
    if (rgb) {
      const parts = rgb[1].split(",").slice(0, 3).map((part) => normalizePdfColorComponent(part.trim()));
      while (parts.length < 3) parts.push(parts[0] ?? 0);
      return parts;
    }
    return null;
  }

  function normalizePdfColorComponent(value) {
    if (Array.isArray(value)) return normalizePdfColorComponent(value[0]);
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return clamp(Math.round((n <= 1 ? n * 255 : n)), 0, 255);
  }

  function cmykToRgb(c, m, y, k) {
    const values = flattenPdfColorArgs([c, m, y, k]);
    c = values[0];
    m = values[1];
    y = values[2];
    k = values[3];
    const cn = clamp(Number(c) || 0, 0, 1);
    const mn = clamp(Number(m) || 0, 0, 1);
    const yn = clamp(Number(y) || 0, 0, 1);
    const kn = clamp(Number(k) || 0, 0, 1);
    return [
      Math.round(255 * (1 - cn) * (1 - kn)),
      Math.round(255 * (1 - mn) * (1 - kn)),
      Math.round(255 * (1 - yn) * (1 - kn))
    ];
  }

  function flattenPdfColorArgs(values) {
    const out = [];
    const visit = (value) => {
      if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        for (const item of value) visit(item);
      } else {
        out.push(value);
      }
    };
    visit(values);
    return out;
  }

  function detectTextBlocks(items) {
    const sorted = items
      .filter((item) => item.rect.width >= 3 && item.rect.height >= 3)
      .sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x));
    const lines = [];

    for (const item of sorted) {
      const midY = item.rect.y + item.rect.height / 2;
      const line = lines.find((candidate) => (
        Math.abs(candidate.midY - midY) <= Math.max(candidate.height, item.rect.height) * 0.45 &&
        candidate.direction === item.direction
      ));
      if (line) {
        line.items.push(item);
        line.midY = (line.midY * (line.items.length - 1) + midY) / line.items.length;
        line.height = Math.max(line.height, item.rect.height);
      } else {
        lines.push({
          midY,
          height: item.rect.height,
          direction: item.direction,
          items: [item]
        });
      }
    }

    const lineBlocks = lines.flatMap((line) => splitLineIntoBlocks(line));
    const paragraphBlocks = mergeLineBlocksIntoParagraphs(lineBlocks);
    return paragraphBlocks.map((block, index) => ({
      ...block,
      id: `pdf-block-${index}`,
      confidence: clamp(block.confidence, 0, 1)
    }));
  }

  function splitLineIntoBlocks(line) {
    const items = line.items.sort((a, b) => a.rect.x - b.rect.x);
    const groups = [];
    for (const item of items) {
      const prevGroup = groups[groups.length - 1];
      const prev = prevGroup?.items[prevGroup.items.length - 1];
      const gap = prev ? item.rect.x - (prev.rect.x + prev.rect.width) : Infinity;
      const styleMatches = !prev || prev.fontName === item.fontName;
      const maxGap = Math.max(prev?.fontSize || item.fontSize || 12, item.fontSize || 12) * 0.7;
      if (prevGroup && gap >= 0 && gap <= maxGap && styleMatches) {
        prevGroup.items.push(item);
      } else {
        groups.push({ items: [item] });
      }
    }
    return groups.map((group) => blockFromItems(group.items));
  }

  function mergeLineBlocksIntoParagraphs(lineBlocks) {
    const blocks = [];
    for (const line of lineBlocks.sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x))) {
      const previous = blocks[blocks.length - 1];
      const yGap = previous ? line.rect.y - (previous.rect.y + previous.rect.height) : Infinity;
      const fontSize = Math.max(previous?.fontSize || line.fontSize || 12, line.fontSize || 12);
      const leftAligned = previous ? Math.abs(previous.rect.x - line.rect.x) <= fontSize * 0.9 : false;
      const similarWidth = previous ? Math.abs(previous.rect.width - line.rect.width) <= Math.max(previous.rect.width, line.rect.width) * 0.45 : false;
      const styleMatches = previous && previous.fontName === line.fontName && previous.direction === line.direction;
      if (previous && yGap >= 0 && yGap <= fontSize * 1.35 && leftAligned && similarWidth && styleMatches) {
        const merged = blockFromItems([...previous.items, ...line.items]);
        Object.assign(previous, merged);
      } else {
        blocks.push({ ...line, items: [...line.items] });
      }
    }
    return blocks.map(({ items, ...block }) => block);
  }

  function blockFromItems(items) {
    const rect = unionRects(items.map((item) => item.rect));
    const foreground = pickBlockForeground(items);
    return {
      text: items.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim(),
      rect,
      fontName: items[0]?.fontName,
      fontSize: Math.max(...items.map((item) => item.fontSize || item.rect.height)),
      direction: items[0]?.direction || "ltr",
      foreground,
      confidence: Math.min(...items.map((item) => item.confidence ?? 0.5)),
      items
    };
  }

  function unionRects(rects) {
    const x1 = Math.min(...rects.map((rect) => rect.x));
    const y1 = Math.min(...rects.map((rect) => rect.y));
    const x2 = Math.max(...rects.map((rect) => rect.x + rect.width));
    const y2 = Math.max(...rects.map((rect) => rect.y + rect.height));
    return {
      x: Math.round(x1),
      y: Math.round(y1),
      width: Math.ceil(x2 - x1),
      height: Math.ceil(y2 - y1)
    };
  }

  function pickBlockForeground(items) {
    const first = items.find((item) => item.foreground)?.foreground;
    return first || {
      rgb: [0, 0, 0],
      source: "text-layer-inferred",
      confidence: 0.45
    };
  }

  function sampleBlockBackgrounds(canvas, blocks) {
    const sourceLike = { canvas, width: canvas.width, height: canvas.height };
    blocks.forEach((block) => {
      const background = sampleBackgroundAroundRect(sourceLike, block.rect, block.foreground?.rgb);
      block.background = {
        rgb: background.rgb,
        source: "background-raster",
        confidence: background.confidence
      };
      block.confidence = Math.min(block.confidence, background.confidence, block.foreground?.confidence ?? 0.5);
    });
  }

  function sampleBackgroundAroundRect(source, rect, foregroundRgb) {
    const pad = Math.max(4, Math.round(Math.max(rect.width, rect.height) * 0.12));
    const sampleRect = {
      x: clamp(rect.x - pad, 0, source.width - 1),
      y: clamp(rect.y - pad, 0, source.height - 1),
      width: clamp(rect.width + pad * 2, 1, source.width),
      height: clamp(rect.height + pad * 2, 1, source.height)
    };
    const colors = colorClustersForRect(source, sampleRect, (x, y) => {
      const inTextBox =
        x >= rect.x - 1 &&
        y >= rect.y - 1 &&
        x <= rect.x + rect.width + 1 &&
        y <= rect.y + rect.height + 1;
      return !inTextBox;
    });
    if (colors.length === 0) {
      const fallback = sampleColors(source, rect);
      return { rgb: fallback.background, confidence: 0.45 };
    }
    const candidate = foregroundRgb
      ? colors
          .map((cluster) => ({ ...cluster, contrast: contrastRatio(cluster.rgb, foregroundRgb) }))
          .sort((a, b) => (b.count - a.count) || (b.contrast - a.contrast))[0]
      : colors[0];
    const total = colors.reduce((sum, cluster) => sum + cluster.count, 0);
    return {
      rgb: candidate.rgb,
      confidence: clamp(candidate.count / Math.max(1, total), 0.35, 0.9)
    };
  }

  function buildNormalMap(blocks, width, height, cellSize = 32) {
    const columns = Math.max(1, Math.ceil(width / cellSize));
    const rows = Math.max(1, Math.ceil(height / cellSize));
    const cells = Array.from({ length: columns * rows }, () => []);
    blocks.forEach((block, index) => {
      const x0 = clamp(Math.floor(block.rect.x / cellSize), 0, columns - 1);
      const y0 = clamp(Math.floor(block.rect.y / cellSize), 0, rows - 1);
      const x1 = clamp(Math.floor((block.rect.x + block.rect.width) / cellSize), 0, columns - 1);
      const y1 = clamp(Math.floor((block.rect.y + block.rect.height) / cellSize), 0, rows - 1);
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          cells[y * columns + x].push(index);
        }
      }
    });
    return { cellSize, columns, rows, cells };
  }

  function sampleColorsForRect(source, rect) {
    const analysisSample = sampleColorsFromAnalysis(source, rect);
    const rasterSample = sampleColors(source, rect);
    if (analysisSample) {
      return withSameColorDetectionError({
        ...analysisSample,
        ocrRasterMismatch: analysisSample.method === "ocr-raster"
          ? ocrRasterMismatch(analysisSample, rasterSample)
          : null
      });
    }
    return withSameColorDetectionError({ ...rasterSample, method: "raster-fallback", confidence: 0.5 });
  }

  function withSameColorDetectionError(sample) {
    if (!sample.detectionError && rgbEqual(sample.foreground, sample.background)) {
      return {
        ...sample,
        detectionError: "Could not detect foreground colour. Select manually."
      };
    }
    return sample;
  }

  function ocrRasterMismatch(ocrSample, rasterSample) {
    const fgDistance = rgbDistance(ocrSample.foreground, rasterSample.foreground);
    const bgDistance = rgbDistance(ocrSample.background, rasterSample.background);
    const ocrRatio = contrastRatio(ocrSample.foreground, ocrSample.background);
    const rasterRatio = contrastRatio(rasterSample.foreground, rasterSample.background);
    const ratioDelta = Math.abs(ocrRatio - rasterRatio);
    const mismatched = fgDistance >= 42 || bgDistance >= 42 || ratioDelta >= 1.25;
    if (!mismatched) return null;
    return {
      rasterForeground: rasterSample.foreground,
      rasterBackground: rasterSample.background,
      rasterRatio,
      fgDistance,
      bgDistance,
      ratioDelta
    };
  }

  function rgbDistance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  function sampleColorsFromAnalysis(source, rect) {
    if (!source.analysis?.normalMap || !source.analysis.blocks?.length) return null;
    const blocks = queryBlocksForRect(source.analysis, rect)
      .map((block) => ({ block, score: blockRectOverlapScore(block.rect, rect) }))
      .filter(({ score }) => score.strong)
      .sort((a, b) => b.score.value - a.score.value);
    if (!blocks.length) return null;
    const selected = blocks.filter(({ score }, index) => index === 0 || score.blockCoverage >= 0.1);
    const foreground = weightedAverageRgb(
      selected.map(({ block, score }) => ({
        rgb: block.foreground?.rgb,
        weight: score.value * (block.foreground?.confidence ?? 0.5)
      }))
    );
    const background = weightedAverageRgb(
      selected.map(({ block, score }) => ({
        rgb: block.background?.rgb,
        weight: score.value * (block.background?.confidence ?? 0.5)
      }))
    );
    if (!foreground || !background) return null;
    const confidence = Math.min(...selected.map(({ block }) => block.confidence ?? 0.5));
    if (confidence < 0.35) return null;
    return {
      foreground,
      background,
      method: source.analysis.kind === "pdf-page-analysis" ? "pdf-native" : "ocr-raster",
      confidence
    };
  }

  function queryBlocksForRect(analysis, rect) {
    const map = analysis.normalMap;
    const x0 = clamp(Math.floor(rect.x / map.cellSize), 0, map.columns - 1);
    const y0 = clamp(Math.floor(rect.y / map.cellSize), 0, map.rows - 1);
    const x1 = clamp(Math.floor((rect.x + rect.width) / map.cellSize), 0, map.columns - 1);
    const y1 = clamp(Math.floor((rect.y + rect.height) / map.cellSize), 0, map.rows - 1);
    const indexes = new Set();
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        for (const index of map.cells[y * map.columns + x]) indexes.add(index);
      }
    }
    return [...indexes].map((index) => analysis.blocks[index]).filter(Boolean);
  }

  function blockRectOverlapScore(blockRect, rect) {
    const overlap = intersectRects(blockRect, rect);
    const overlapArea = overlap.width * overlap.height;
    const blockArea = Math.max(1, blockRect.width * blockRect.height);
    const rectArea = Math.max(1, rect.width * rect.height);
    const blockCoverage = overlapArea / blockArea;
    const rectCoverage = overlapArea / rectArea;
    return {
      blockCoverage,
      rectCoverage,
      strong: blockCoverage >= 0.35 || rectCoverage >= 0.35,
      value: Math.max(blockCoverage, rectCoverage)
    };
  }

  function weightedAverageRgb(items) {
    const usable = items.filter((item) => item.rgb && item.weight > 0);
    const total = usable.reduce((sum, item) => sum + item.weight, 0);
    if (total <= 0) return null;
    return [0, 1, 2].map((index) => (
      Math.round(usable.reduce((sum, item) => sum + item.rgb[index] * item.weight, 0) / total)
    ));
  }

  function colorClustersForRect(source, rect, includePixel = () => true) {
    const ctx = source.canvas.getContext("2d", { willReadFrequently: true });
    const x0 = clamp(Math.floor(rect.x), 0, Math.max(0, source.width - 1));
    const y0 = clamp(Math.floor(rect.y), 0, Math.max(0, source.height - 1));
    const x1 = clamp(Math.ceil(rect.x + rect.width), x0 + 1, source.width);
    const y1 = clamp(Math.ceil(rect.y + rect.height), y0 + 1, source.height);
    const width = x1 - x0;
    const height = y1 - y0;
    const image = ctx.getImageData(x0, y0, width, height);
    const clusters = new Map();
    const data = image.data;
    const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 18000)));

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        if (!includePixel(x0 + x, y0 + y)) continue;
        const i = (y * width + x) * 4;
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

    return [...clusters.values()]
      .map((cluster) => ({
        count: cluster.count,
        rgb: [
          Math.round(cluster.r / cluster.count),
          Math.round(cluster.g / cluster.count),
          Math.round(cluster.b / cluster.count)
        ]
      }))
      .sort((a, b) => b.count - a.count);
  }

  function sampleColors(source, rect) {
    const sorted = colorClustersForRect(source, rect);

    if (sorted.length === 0) {
      return {
        foreground: [0, 0, 0],
        background: [0, 0, 0],
        detectionError: "Could not detect foreground or background colour. Select manually."
      };
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
      if (alternative) {
        foreground = alternative.rgb;
      } else {
        return {
          foreground,
          background,
          detectionError: "Could not detect foreground colour. Select manually."
        };
      }
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

  function rgbaCss(rgb, alpha) {
    return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${alpha})`;
  }

  /** Stroke + tint for a selection rect so the outline contrasts the image inside it. */
  function markingColorsForCheckRect(source, rect) {
    const interior = averageRgbUnderRect(source, rect.x, rect.y, rect.width, rect.height);
    const strokeRgb = pickBadgeFillForBackground(interior);
    return { strokeRgb };
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

  /** Prefer candidate whose worst contrast among samples is highest (stable on gradients). */
  function pickBadgeFillForSamples(samples) {
    if (!samples.length) return BADGE_FILL_CANDIDATES[0];
    let best = BADGE_FILL_CANDIDATES[0];
    let bestMin = -1;
    for (const c of BADGE_FILL_CANDIDATES) {
      const minC = Math.min(...samples.map((s) => contrastRatio(c, s)));
      if (minC > bestMin) {
        bestMin = minC;
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

  function intersectRects(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    const width = Math.max(0, right - x);
    const height = Math.max(0, bottom - y);
    return { x, y, width, height };
  }

  function displayRegionToSourceRect(displayRect, dx, dy, dw, dh) {
    return {
      sx: (dx - displayRect.x) / displayRect.scale,
      sy: (dy - displayRect.y) / displayRect.scale,
      sw: dw / displayRect.scale,
      sh: dh / displayRect.scale
    };
  }

  /** Nine RGB samples across a source-space rectangle (single getImageData). */
  function sampleRgbStopsUnderSourceRect(source, sx, sy, sw, sh) {
    const iw = source.width;
    const ih = source.height;
    const x0 = clamp(Math.floor(sx), 0, Math.max(0, iw - 1));
    const y0 = clamp(Math.floor(sy), 0, Math.max(0, ih - 1));
    const x1 = clamp(Math.ceil(sx + sw), x0 + 1, iw);
    const y1 = clamp(Math.ceil(sy + sh), y0 + 1, ih);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 1 || h < 1) return [];
    const ctx = source.canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(x0, y0, w, h);
    const data = image.data;
    const uvs = [
      [0.12, 0.12],
      [0.5, 0.12],
      [0.88, 0.12],
      [0.12, 0.5],
      [0.5, 0.5],
      [0.88, 0.5],
      [0.12, 0.88],
      [0.5, 0.88],
      [0.88, 0.88]
    ];
    const out = [];
    for (const [u, v] of uvs) {
      const lx = Math.min(w - 1, Math.max(0, Math.floor(u * Math.max(1, w - 0.001))));
      const ly = Math.min(h - 1, Math.max(0, Math.floor(v * Math.max(1, h - 0.001))));
      const i = (ly * w + lx) * 4;
      out.push([data[i], data[i + 1], data[i + 2]]);
    }
    return out;
  }

  function badgeColorsForSourceBadgeBox(source, sx, sy, sw, sh) {
    const samples = sampleRgbStopsUnderSourceRect(source, sx, sy, sw, sh);
    if (samples.length === 0) {
      const bg = averageRgbUnderRect(source, sx, sy, sw, sh);
      const fill = pickBadgeFillForBackground(bg);
      return { fill, textRgb: pickBadgeTextOnFill(fill) };
    }
    const fill = pickBadgeFillForSamples(samples);
    return { fill, textRgb: pickBadgeTextOnFill(fill) };
  }

  /**
   * Badge is drawn in display (CSS) pixels; only the part overlapping the fitted image should
   * drive the colour. Otherwise the badge often sits in letterboxing and we wrongly sample
   * the wrong strip of the bitmap — fall back to colours under the selection rect.
   */
  function badgeColorsForDisplayBadge(source, displayRect, bx, by, bw, bh, checkRectSource) {
    const imageOnCanvas = {
      x: displayRect.x,
      y: displayRect.y,
      width: displayRect.width,
      height: displayRect.height
    };
    const badge = { x: bx, y: by, width: bw, height: bh };
    const overlap = intersectRects(imageOnCanvas, badge);
    if (overlap.width >= 2 && overlap.height >= 2) {
      const sr = displayRegionToSourceRect(displayRect, overlap.x, overlap.y, overlap.width, overlap.height);
      return badgeColorsForSourceBadgeBox(source, sr.sx, sr.sy, sr.sw, sr.sh);
    }
    return badgeColorsForSourceBadgeBox(
      source,
      checkRectSource.x,
      checkRectSource.y,
      checkRectSource.width,
      checkRectSource.height
    );
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
    const scale = reportAnnotationScale(source.width);
    const gap = Math.max(2, Math.round(BADGE_GAP_SCREEN * scale));
    source.checks.forEach((check, index) => {
      ctx.save();
      const isActive = source.id === state.activeSourceId && check.id === state.activeCheckId;
      ctx.lineWidth = isActive ? 3 : 2;
      const { strokeRgb } = markingColorsForCheckRect(source, check.rect);
      ctx.strokeStyle = rgbToCss(strokeRgb);
      ctx.fillStyle = rgbaCss(strokeRgb, 0.14);
      ctx.fillRect(check.rect.x, check.rect.y, check.rect.width, check.rect.height);
      ctx.strokeRect(check.rect.x, check.rect.y, check.rect.width, check.rect.height);
      const n = index + 1;
      const { width: bw, height: bh } = reportBadgeDimensions(n, scale);
      const { x: bx, y: by } = computeBadgeTopLeft(
        check.rect,
        { width: source.width, height: source.height },
        bw,
        bh,
        gap
      );
      drawReportBadge(ctx, source, n, bx, by, bw, bh, scale);
      ctx.restore();
    });
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  function drawReportBadge(ctx, source, number, x, y, width, height, scale) {
    const label = String(number);
    const { fill, textRgb } = badgeColorsForSourceBadgeBox(source, x, y, width, height);
    ctx.fillStyle = rgbToCss(fill);
    ctx.fillRect(x, y, width, height);
    ctx.lineWidth = Math.max(1, scale);
    ctx.strokeStyle = textRgb[0] + textRgb[1] + textRgb[2] > 500 ? "rgba(0, 0, 0, 0.38)" : "rgba(255, 255, 255, 0.55)";
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
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
      doc.text(`${exportSectionNumber}. ${source.name}`, page.margin, y, { maxWidth: page.width - page.margin * 2 });
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
    if (debugSampling) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.text(sampleMethodLabel(check), layout.ratio(page), y + 13, { maxWidth: 28 });
    } else if (check.ocrRasterMismatch) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.text("OCR/raster differ", layout.ratio(page), y + 13, { maxWidth: 28 });
    }
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

  let ocrEnginePromise = null;

  function loadOcrEngine() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (ocrEnginePromise) return ocrEnginePromise;
    ocrEnginePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.integrity = TESSERACT_JS.integrity;
      script.crossOrigin = "anonymous";
      script.async = true;
      script.src = TESSERACT_JS.url;
      script.onload = () => {
        if (window.Tesseract) {
          resolve(window.Tesseract);
        } else {
          reject(new Error("Tesseract.js loaded without exposing an OCR engine."));
        }
      };
      script.onerror = () => reject(new Error("Could not load Tesseract.js."));
      document.head.append(script);
    });
    return ocrEnginePromise;
  }

  function prepareOcrCanvas(source) {
    const maxPixels = 1800 * 1400;
    const baseScale = source.width * source.height > maxPixels
      ? Math.sqrt(maxPixels / (source.width * source.height))
      : 1;
    const upscale = Math.max(1, Math.min(2, 1000 / Math.max(1, Math.min(source.width, source.height))));
    const scale = Math.min(2, baseScale * upscale);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source.canvas, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      const boosted = clamp(Math.round((gray - 128) * 1.35 + 128), 0, 255);
      data[i] = boosted;
      data[i + 1] = boosted;
      data[i + 2] = boosted;
    }
    ctx.putImageData(image, 0, 0);
    return { canvas, scale };
  }

  async function buildOcrImageAnalysis(source, onProgress = () => {}) {
    onProgress("Loading OCR…");
    const Tesseract = await loadOcrEngine();
    const prepared = prepareOcrCanvas(source);
    onProgress("Recognizing text…");
    const result = await Tesseract.recognize(prepared.canvas, "eng", {
      logger(message) {
        if (message.status === "recognizing text" && typeof message.progress === "number") {
          onProgress(`Recognizing text ${Math.round(message.progress * 100)}%…`);
        }
      }
    });
    const words = (result.data.words || [])
      .map((word, index) => ocrWordToBlockSeed(word, index, prepared.scale))
      .filter(Boolean);
    const blocks = mergeOcrBoxesIntoBlocks(words);
    sampleOcrBlockColors(source.canvas, blocks);
    return {
      kind: "ocr-image-analysis",
      version: 1,
      engine: "tesseract.js",
      language: "eng",
      sourceScale: prepared.scale,
      blocks,
      normalMap: buildNormalMap(blocks, source.width, source.height)
    };
  }

  function ocrWordToBlockSeed(word, index, scale) {
    const text = String(word.text || "").trim();
    const confidence = Number(word.confidence);
    const bbox = word.bbox || {};
    if (!text || !Number.isFinite(confidence) || confidence < 45) return null;
    const x0 = Number(bbox.x0);
    const y0 = Number(bbox.y0);
    const x1 = Number(bbox.x1);
    const y1 = Number(bbox.y1);
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return null;
    return {
      id: `ocr-word-${index}`,
      text,
      rect: {
        x: Math.round(x0 / scale),
        y: Math.round(y0 / scale),
        width: Math.ceil((x1 - x0) / scale),
        height: Math.ceil((y1 - y0) / scale)
      },
      direction: "ltr",
      confidence: clamp(confidence / 100, 0, 1)
    };
  }

  function mergeOcrBoxesIntoBlocks(words) {
    const lineBlocks = detectTextBlocks(words);
    return lineBlocks.map((block, index) => ({
      ...block,
      id: `ocr-block-${index}`,
      confidence: Math.min(block.confidence ?? 0.5, 0.75)
    }));
  }

  function sampleOcrBlockColors(canvas, blocks) {
    const sourceLike = { canvas, width: canvas.width, height: canvas.height };
    blocks.forEach((block) => {
      const sample = sampleColors(sourceLike, block.rect);
      block.foreground = {
        rgb: sample.foreground,
        source: "raster-fallback",
        confidence: 0.55
      };
      block.background = {
        rgb: sample.background,
        source: "raster-fallback",
        confidence: 0.55
      };
      block.confidence = Math.min(block.confidence ?? 0.5, 0.55);
    });
  }

  async function detectTextBlocksForActiveSource() {
    const source = activeSource();
    if (!source) return;
    if (!source.analysis?.blocks?.length) {
      try {
        els.detectTextButton.disabled = true;
        els.detectTextButton.textContent = "Loading OCR";
        source.analysis = await buildOcrImageAnalysis(source, (message) => {
          els.detectTextButton.textContent = message.replace(/…$/, "");
        });
      } catch (err) {
        console.error(err);
        alert(`Text detection failed. ${err && err.message ? err.message : "You can still draw rectangles manually."}`);
        els.detectTextButton.textContent = "Detect text blocks";
        render();
        return;
      } finally {
        els.detectTextButton.textContent = "Detect text blocks";
      }
    }
    if (!source.analysis?.blocks?.length) {
      alert("No text blocks were found. You can still draw rectangles manually.");
      render();
      return;
    }

    const existing = source.checks;
    const candidates = source.analysis.blocks
      .filter((block) => block.confidence >= 0.35 && block.rect.width >= 3 && block.rect.height >= 3)
      .filter((block) => !existing.some((check) => blockRectOverlapScore(block.rect, check.rect).value >= 0.75))
      .slice(0, 200);

    for (const block of candidates) {
      const rect = {
        x: clamp(Math.round(block.rect.x), 0, source.width - 1),
        y: clamp(Math.round(block.rect.y), 0, source.height - 1),
        width: clamp(Math.round(block.rect.width), 1, source.width),
        height: clamp(Math.round(block.rect.height), 1, source.height)
      };
      const check = createCheck(source, rect);
      check.autoDetected = true;
      source.checks.push(check);
    }

    if (candidates.length) {
      state.activeCheckId = source.checks[source.checks.length - candidates.length]?.id || source.checks[0]?.id || null;
    }
    render();
    if (els.editorDialog.open) renderEditor();
  }

  function removeAutoDetectedChecksForActiveSource() {
    const source = activeSource();
    if (!source) return;
    source.checks = source.checks.filter((check) => !check.autoDetected);
    state.activeCheckId = source.checks[0]?.id || null;
    render();
    if (els.editorDialog.open) renderEditor();
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
    clearInteractionState();
    drawOverlay();
  });

  els.editorOverlayCanvas.addEventListener("pointerdown", (event) => onPointerDown(event, "editor"));
  els.editorOverlayCanvas.addEventListener("pointermove", (event) => onPointerMove(event, "editor"));
  els.editorOverlayCanvas.addEventListener("pointerup", (event) => onPointerUp(event, "editor"));
  els.editorOverlayCanvas.addEventListener("pointercancel", () => {
    clearInteractionState();
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
    clearInteractionState();
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
  els.detectTextButton.addEventListener("click", detectTextBlocksForActiveSource);
  els.removeDetectedButton?.addEventListener("click", removeAutoDetectedChecksForActiveSource);
  els.exportButton.addEventListener("click", exportReport);
  els.resetButton.addEventListener("click", () => {
    state.sources = [];
    state.activeSourceId = null;
    state.activeCheckId = null;
    clearInteractionState();
    els.overlayDeleteLayer?.replaceChildren();
    els.editorDeleteLayer?.replaceChildren();
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
