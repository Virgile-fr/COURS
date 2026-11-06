const $ = (id) => document.getElementById(id);
let catalog = { decks: [], revision: null };
let deckIndex = 0;
let slideIndex = 0;
let imageIndex = 0;
let lightboxImages = [];
let lightboxIndex = 0;
let etag = null;
let loading = false;
let refreshQueued = false;
let fitFrame;
let pageTransition;
const isLocalFile = location.protocol === "file:";
const localFiles = new CourseFiles.Source();
let sourceMode = globalThis.COURSE_DATA ? "published" : "local";
let controlsTimer;
let controlsHovered = false;

let imagesVisible = true;
try { imagesVisible = localStorage.getItem("course-images-visible") !== "false"; } catch {}
function updateImagesButton() {
  const button = $("images-toggle");
  button.setAttribute("aria-pressed", String(imagesVisible));
  button.setAttribute("aria-label", imagesVisible ? "Masquer les images" : "Afficher les images");
  button.title = (imagesVisible ? "Masquer les images" : "Afficher les images") + " (I)";
  $("images-hidden-mark").hidden = imagesVisible;
}
function toggleImages() {
  imagesVisible = !imagesVisible;
  try { localStorage.setItem("course-images-visible", String(imagesVisible)); } catch {}
  updateImagesButton();
  if (!imagesVisible && $("lightbox").open) $("lightbox").close();
  if (currentSlide()) { render(); fit(true); }
}
$("images-toggle").onclick = toggleImages;
updateImagesButton();

let textSettings = { auto: true, size: 26 };
try {
  const saved = JSON.parse(localStorage.getItem("course-text-settings"));
  if (saved && typeof saved.auto === "boolean" && Number.isFinite(saved.size)) {
    textSettings = { auto: saved.auto, size: Math.max(16, Math.min(60, saved.size)) };
  }
} catch {}
function updateTextControls() {
  $("text-auto").setAttribute("aria-pressed", String(textSettings.auto));
  $("text-auto").textContent = textSettings.auto ? "Auto : oui" : "Auto : non";
  $("text-size").textContent = textSettings.auto ? "" : `${textSettings.size} px`;
  $("text-smaller").disabled = !textSettings.auto && textSettings.size <= 16;
  $("text-larger").disabled = !textSettings.auto && textSettings.size >= 60;
}
function saveTextSettings() {
  try { localStorage.setItem("course-text-settings", JSON.stringify(textSettings)); } catch {}
  updateTextControls();
  fit(true);
}
function useManualSize() {
  if (textSettings.auto) {
    const size = parseFloat(getComputedStyle($("text-flow")).fontSize);
    textSettings.size = Math.max(16, Math.min(60, Math.round(size || 26)));
    textSettings.auto = false;
  }
}
$("text-auto").onclick = () => {
  if (textSettings.auto) useManualSize();
  else textSettings.auto = true;
  saveTextSettings();
};
$("text-smaller").onclick = () => {
  useManualSize();
  textSettings.size = Math.max(16, textSettings.size - 2);
  saveTextSettings();
};
$("text-larger").onclick = () => {
  useManualSize();
  textSettings.size = Math.min(60, textSettings.size + 2);
  saveTextSettings();
};
updateTextControls();

function showLocalStart() {
  $("local-start").hidden = false;
  $("slide-wrap").hidden = true;
  $("empty").hidden = true;
  $("previous").disabled = true;
  $("next").disabled = true;
  $("presentation-controls").hidden = true;
  if (!("showDirectoryPicker" in window)) {
    $("local-help").textContent = "Ce navigateur importe une copie : resélectionnez le dossier après vos modifications. La lecture automatique est disponible avec Chrome ou Edge.";
    $("import-folder").hidden = true;
  }
}

function localStatus() {
  return localFiles.mode === "import" ? "Copie importée · resélectionner après modification" : "";
}

async function openFolder() {
  if (!("showDirectoryPicker" in window)) { $("folder-input").click(); return; }
  try {
    await localFiles.selectDirectory();
    sourceMode = "local";
    etag = null;
    $("local-error").textContent = "";
    await refresh();
  } catch (error) {
    if (error.name === "AbortError") return;
    const message = error.name === "SecurityError" ? "La lecture directe est bloquée par ce navigateur. Utilisez « Importer une copie du dossier »." : error.message;
    $("local-error").textContent = message;
    $("status").textContent = message;
    $("import-folder").hidden = false;
  }
}

function acceptCatalog(next) {
  if (next.revision !== catalog.revision) {
    const initial = catalog.revision === null;
    catalog = next;
    readRoute();
    render();
    if (initial && catalog.decks.length) showCourseChoice();
    $("status").textContent = localStatus() || (initial ? "" : "Cours actualisé");
  } else $("status").textContent = localStatus();
}

function currentDeck() { return catalog.decks[deckIndex]; }
function currentSlide() { return currentDeck()?.slides[slideIndex]; }
function pad(n) { return String(n).padStart(2, "0"); }
function routeFor(deck, slide) { return `#${encodeURIComponent(deck.id)}/${encodeURIComponent(slide.id)}`; }
function readRoute() {
  const route = location.hash.slice(1);
  for (let d = 0; d < catalog.decks.length; d++) {
    const deck = catalog.decks[d];
    const s = deck.slides.findIndex(slide => routeFor(deck, slide).slice(1) === route);
    if (s >= 0) { deckIndex = d; slideIndex = s; return; }
  }
  deckIndex = 0; slideIndex = 0;
}
function go(d, s, focus = true) {
  deckIndex = d; slideIndex = s;
  history.replaceState(null, "", routeFor(currentDeck(), currentSlide()));
  pageTransition?.skipTransition();
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const update = () => {
    render();
    fit(true);
    if (focus) $("slide").focus({ preventScroll: true });
  };
  if (document.startViewTransition && !reduceMotion) {
    const transition = document.startViewTransition(update);
    pageTransition = transition;
    transition.ready.catch(() => {});
    transition.finished.catch(() => {}).finally(() => { if (pageTransition === transition) pageTransition = null; });
    return transition.updateCallbackDone;
  }
  render();
  if (focus) $("slide").focus({ preventScroll: true });
  if (!reduceMotion) {
    document.querySelector(".slide-content").animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 420, easing: "ease-out" });
    if (imagesVisible && currentSlide()?.images.length) $("visual").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: "ease-out" });
  }
}
function move(delta) {
  if (!currentDeck()) return;
  const next = slideIndex + delta;
  if (next >= 0 && next < currentDeck().slides.length) go(deckIndex, next);
}
function renderImage() {
  const slide = currentSlide();
  if (!imagesVisible || !slide?.images.length) return;
  const image = slide.images[imageIndex];
  $("slide-image").src = image.url;
  $("slide-image").alt = `Visuel du cours : ${slide.title}${slide.images.length > 1 ? ` (${imageIndex + 1}/${slide.images.length})` : ""}`;
  $("image-count").textContent = `${imageIndex + 1} / ${slide.images.length}`;
  $("image-controls").hidden = slide.images.length < 2;
  $("image-prev").disabled = imageIndex === 0;
  $("image-next").disabled = imageIndex === slide.images.length - 1;
}
function openImage(image) {
  lightboxImages = currentSlide()?.images.slice() || [image];
  lightboxIndex = Math.max(0, lightboxImages.findIndex(item => item.url === image.url));
  renderLightbox();
  $("lightbox").showModal();
}
function renderLightbox() {
  const image = lightboxImages[lightboxIndex];
  if (!image) return;
  $("large-image").src = image.url;
  $("large-image").alt = image.name;
  $("lightbox-count").textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`;
  $("lightbox-navigation").hidden = lightboxImages.length < 2;
  $("lightbox-prev").disabled = lightboxIndex === 0;
  $("lightbox-next").disabled = lightboxIndex === lightboxImages.length - 1;
}
function moveLightbox(delta) {
  const next = lightboxIndex + delta;
  if (next < 0 || next >= lightboxImages.length) return;
  lightboxIndex = next;
  renderLightbox();
  if (currentSlide()?.kind !== "gallery") {
    imageIndex = next;
    renderImage();
  }
}
function renderGallery(slide) {
  const gallery = $("gallery");
  gallery.replaceChildren();
  if (slide.kind !== "gallery" || !imagesVisible) return;
  for (const image of slide.images) {
    const button = document.createElement("button");
    button.className = "gallery-item";
    button.setAttribute("aria-label", `Agrandir ${image.name}`);
    const thumbnail = document.createElement("img");
    thumbnail.alt = image.name;
    thumbnail.addEventListener("load", fit);
    thumbnail.src = image.url;
    button.append(thumbnail);
    button.onclick = () => openImage(image);
    gallery.append(button);
  }
}
function layoutGallery() {
  const gallery = $("gallery");
  if (gallery.hidden) return;
  const images = Array.from(gallery.querySelectorAll("img"));
  if (!images.length) return;
  const width = gallery.clientWidth;
  const height = gallery.clientHeight;
  const gap = parseFloat(getComputedStyle(gallery).gap) || 0;
  let best = { columns: 1, rows: images.length, area: -1 };
  // Choisir la grille qui donne le plus de surface aux images entières.
  for (let columns = 1; columns <= images.length; columns++) {
    const rows = Math.ceil(images.length / columns);
    const cellWidth = Math.max(0, (width - gap * (columns - 1)) / columns - 22);
    const cellHeight = Math.max(0, (height - gap * (rows - 1)) / rows - 22);
    const area = images.reduce((total, image) => {
      const ratio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1.4;
      const imageWidth = Math.min(cellWidth, cellHeight * ratio);
      return total + imageWidth * imageWidth / ratio;
    }, 0);
    if (area > best.area) best = { columns, rows, area };
  }
  gallery.style.gridTemplateColumns = `repeat(${best.columns}, minmax(0, 1fr))`;
  gallery.style.gridTemplateRows = `repeat(${best.rows}, minmax(0, 1fr))`;
}
let activePromptTag = null;
function hidePromptTooltip() {
  $("prompt-tooltip").hidden = true;
  if (activePromptTag) activePromptTag.removeAttribute("aria-describedby");
  activePromptTag = null;
}
function showPromptTooltip(tag) {
  hidePromptTooltip();
  activePromptTag = tag;
  const tooltip = $("prompt-tooltip");
  tooltip.textContent = tag.dataset.promptTag;
  tooltip.hidden = false;
  tag.setAttribute("aria-describedby", "prompt-tooltip");
  const rect = tag.getBoundingClientRect();
  const left = Math.max(12, Math.min(rect.right - tooltip.offsetWidth, innerWidth - tooltip.offsetWidth - 12));
  const top = rect.top - tooltip.offsetHeight - 8;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top >= 12 ? top : rect.bottom + 8}px`;
}
$("text-flow").addEventListener("pointerover", event => {
  const tag = event.target.closest(".prompt-tag");
  if (tag && tag !== activePromptTag) showPromptTooltip(tag);
});
$("text-flow").addEventListener("pointerout", event => {
  const tag = event.target.closest(".prompt-tag");
  if (tag && !tag.contains(event.relatedTarget)) hidePromptTooltip();
});
$("text-flow").addEventListener("focusin", event => {
  const tag = event.target.closest(".prompt-tag");
  if (tag) showPromptTooltip(tag);
});
$("text-flow").addEventListener("focusout", hidePromptTooltip);
$("text-area").addEventListener("scroll", hidePromptTooltip, { passive: true });
window.addEventListener("resize", hidePromptTooltip);
document.addEventListener("keydown", event => { if (event.key === "Escape") hidePromptTooltip(); });

function render() {
  hidePromptTooltip();
  const deck = currentDeck();
  const slide = currentSlide();
  $("local-start").hidden = true;
  $("presentation-controls").hidden = !slide;
  document.body.classList.toggle("presenting", Boolean(slide));
  $("empty").hidden = Boolean(slide);
  $("slide-wrap").hidden = !slide;
  $("previous").disabled = !slide || slideIndex === 0;
  $("next").disabled = !slide || slideIndex === deck.slides.length - 1;
  if (!slide) {
    renderContents();
    return;
  }
  $("side-caption").textContent = [globalThis.COURSE_CONFIG?.className, deck.title].filter(Boolean).join(" / ").toLocaleUpperCase("fr");
  document.title = `${slide.title} · ${globalThis.COURSE_CONFIG?.className || "Cours"}`;
  $("slide-title").textContent = slide.title.replace(/^\d+\s*[-.\u2013\u2014]\s*/, "");
  $("text-flow").innerHTML = slide.html;
  for (const link of $("text-flow").querySelectorAll('a[href^="http"]')) {
    link.target = "_blank"; link.rel = "noopener noreferrer";
  }
  const isIntro = Boolean($("text-flow").querySelector(".course-intro, .part-intro"));
  const isPartIntro = Boolean($("text-flow").querySelector(".part-intro"));
  const isGallery = slide.kind === "gallery";
  const hasImage = !isGallery && imagesVisible && slide.images.length > 0;
  $("slide").className = `${isGallery ? "gallery-slide" : hasImage ? "with-image" : "text-only"}${/^0+$/.test(slide.id) && hasImage ? " cover" : ""}${imagesVisible ? "" : " images-hidden"}${isIntro ? " intro-slide" : ""}${isPartIntro ? " part-slide" : ""}`;
  $("visual").hidden = !hasImage;
  $("slide-body").hidden = isGallery && !slide.html;
  $("gallery").hidden = !isGallery || !imagesVisible;
  $("gallery-message").hidden = !isGallery || imagesVisible;
  renderGallery(slide);
  imageIndex = 0;
  if (hasImage) renderImage();
  else $("slide-image").removeAttribute("src");
  $("slide-page").textContent = `${pad(slideIndex + 1)} / ${pad(deck.slides.length)}`;
  $("text-area").scrollTop = 0;
  renderContents();
  fit();
}
function fit(immediate = false) {
  hidePromptTooltip();
  cancelAnimationFrame(fitFrame);
  const layout = () => {
    const stage = $("stage");
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    const scale = width / 1600;
    const logicalHeight = height / scale;
    $("slide-wrap").style.width = `${width}px`;
    $("slide-wrap").style.height = `${height}px`;
    $("slide").style.height = `${logicalHeight}px`;
    $("slide").style.transform = `scale(${scale})`;
    const image = $("slide-image");
    const gutter = parseFloat(getComputedStyle($("visual")).paddingTop);
    const imageWidth = image.naturalHeight ? Math.min(747, (logicalHeight - 2 * gutter) * image.naturalWidth / image.naturalHeight + 2 * gutter) : 700;
    $("slide").style.setProperty("--image-width", `${imageWidth}px`);
    const slide = $("slide");
    slide.classList.remove("centered-content");
    $("slide-body").style.height = "";
    const textFlow = $("text-flow");
    textFlow.style.height = "";
    const title = $("slide-title");
    title.style.fontSize = "";
    let titleSize = parseFloat(getComputedStyle(title).fontSize);
    const maxTitleHeight = $("slide").classList.contains("cover") ? logicalHeight * .45 : logicalHeight * .25;
    while (textSettings.auto && title.offsetHeight > maxTitleHeight && titleSize > 32) title.style.fontSize = `${--titleSize}px`;
    if (currentSlide()?.kind === "gallery") {
      slide.classList.remove("dense", "manual-text");
      textFlow.classList.remove("compact");
      textFlow.style.fontSize = "";
      layoutGallery();
      return;
    }
    const text = $("text-flow");
    text.style.fontSize = "";
    text.classList.remove("compact");
    $("slide").classList.remove("dense");
    $("slide").classList.toggle("manual-text", !textSettings.auto);
    const baseTextSize = parseFloat(getComputedStyle(text).fontSize);
    const baseTitleSize = parseFloat(getComputedStyle(title).fontSize);
    const applySize = size => {
      text.style.fontSize = `${size}px`;
      title.style.fontSize = `${baseTitleSize * size / baseTextSize}px`;
    };
    const finishLayout = () => {
      const body = $("slide-body");
      const available = body.clientHeight;
      // Mesurer la hauteur naturelle des colonnes, sans hauteur imposée.
      text.style.height = "auto";
      const natural = text.offsetHeight;
      const needed = Math.max(natural, text.scrollHeight) + 4;
      if (needed <= available) {
        body.style.height = `${needed}px`;
        slide.classList.add("centered-content");
      } else {
        // Un contenu long utilise toute la hauteur disponible.
        body.style.height = "";
        if (textSettings.auto) text.style.height = "";
      }
    };
    if (!textSettings.auto) {
      applySize(textSettings.size);
      finishLayout();
      return;
    }
    let size = baseTextSize;
    const overflows = () => {
      const area = $("text-area");
      return text.scrollHeight > text.clientHeight || text.scrollWidth > text.clientWidth ||
        area.scrollHeight > area.clientHeight || area.scrollWidth > area.clientWidth;
    };
    // Mesurer le titre et le texte ensemble à chaque changement de taille.
    applySize(size);
    while (overflows() && size > 22) applySize(--size);
    if (overflows()) {
      slide.classList.add("dense");
      text.classList.add("compact");
      size = baseTextSize;
      applySize(size);
      while (overflows() && size > 16) applySize(--size);
    }
    finishLayout();
    // Un futur texte très long reste intégralement accessible par défilement.
  };
  if (immediate === true) layout();
  else fitFrame = requestAnimationFrame(layout);
}
function showCourseChoice() {
  const list = $("start-course-list");
  list.replaceChildren();
  catalog.decks.forEach((deck, d) => {
    const button = document.createElement("button");
    button.className = "course-choice";
    const title = document.createElement("span");
    title.textContent = deck.title;
    const count = document.createElement("span");
    count.className = "course-choice-count";
    count.textContent = `${deck.slides.length} slide${deck.slides.length > 1 ? "s" : ""}`;
    button.append(title, count);
    button.onclick = () => {
      $("course-choice").close();
        go(d, 0);
    };
    list.append(button);
  });
  $("course-choice").showModal();
}

function renderContents() {
  const list = $("course-list");
  list.replaceChildren();
  catalog.decks.forEach((deck, d) => {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.className = "course-heading";
    heading.textContent = deck.title;
    section.append(heading);
    deck.slides.forEach((slide, s) => {
      const button = document.createElement("button");
      button.className = "slide-link";
      const number = document.createElement("span");
      number.className = "item-number";
      number.textContent = /^\d/.test(slide.id) ? pad(parseInt(slide.id, 10)) : slide.id;
      const title = document.createElement("span");
      title.textContent = slide.title.replace(/^\d+\s*[-.\u2013\u2014]\s*/, "");
      button.append(number, title);
      if (d === deckIndex && s === slideIndex) button.setAttribute("aria-current", "true");
      button.onclick = () => { $("contents").close(); go(d, s); };
      section.append(button);
    });
    list.append(section);
  });
}
async function refresh() {
  if (loading) { refreshQueued = true; return; }
  if (sourceMode === "local" && !localFiles.mode) return;
  loading = true;
  try {
    if (sourceMode === "local") {
      acceptCatalog(await localFiles.read());
      return;
    }
    if (sourceMode === "published") {
      acceptCatalog(await localFiles.loadPublished());
      return;
    }
  } catch (error) {
    if (sourceMode === "local") {
      const message = "Lecture du dossier interrompue · sélectionnez-le à nouveau.";
      $("status").textContent = message;
      $("local-error").textContent = message;
      return;
    }
    $("status").textContent = "Connexion interrompue · nouvelle tentative…";
    if (catalog.revision === null) {
      $("slide-title").textContent = "Le cours est indisponible.";
      $("text-flow").textContent = "Impossible de charger les cours générés. Détail : " + error.message;
      fit();
    }
  } finally {
    loading = false;
    if (refreshQueued) { refreshQueued = false; queueMicrotask(refresh); }
  }
}
$("previous").onclick = () => move(-1);
$("open-folder").onclick = openFolder;
async function reloadFolder() {
  if (sourceMode !== "local") await refresh();
  else if (localFiles.mode === "live") await openFolder();
  else $("folder-input").click();
}
$("folder-button").onclick = reloadFolder;
$("empty-folder").onclick = reloadFolder;
$("import-folder").onclick = () => $("folder-input").click();
$("folder-input").onchange = async event => {
  if (!event.target.files.length) return;
  try {
    localFiles.importFiles(event.target.files);
    sourceMode = "local";
    etag = null;
    await refresh();
  } catch (error) { $("local-error").textContent = error.message; $("status").textContent = error.message; }
  finally { event.target.value = ""; }
};
$("next").onclick = () => move(1);
$("contents-button").onclick = () => { $("contents").showModal(); $("contents").querySelector('[aria-current="true"]')?.scrollIntoView({ block: "center" }); };
$("contents-close").onclick = () => $("contents").close();
$("image-prev").onclick = () => { imageIndex--; renderImage(); };
$("image-next").onclick = () => { imageIndex++; renderImage(); };
$("image-open").onclick = () => {
  openImage(currentSlide().images[imageIndex]);
};
$("lightbox-close").onclick = () => $("lightbox").close();
$("lightbox-prev").onclick = () => moveLightbox(-1);
$("lightbox-next").onclick = () => moveLightbox(1);
$("lightbox").addEventListener("keydown", event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    event.stopPropagation();
    moveLightbox(event.key === "ArrowLeft" ? -1 : 1);
  }
});
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", event => { if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  } });
}
function updateFullscreenButton() {
  const active = Boolean(document.fullscreenElement);
  const button = $("fullscreen-button");
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", active ? "Quitter le plein écran" : "Passer en plein écran");
  button.title = active ? "Quitter le plein écran (F)" : "Plein écran (F)";
  $("fullscreen-icon").setAttribute("d", active
    ? "M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"
    : "M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5");
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
  } catch {
    $("status").textContent = "Le navigateur ne permet pas le plein écran ici.";
  }
}
$("fullscreen-button").onclick = toggleFullscreen;
$("fullscreen-button").hidden = !document.documentElement.requestFullscreen;
document.addEventListener("fullscreenchange", () => { updateFullscreenButton(); fit(); });
updateFullscreenButton();

function hideControlsImmediately() {
  clearTimeout(controlsTimer);
  controlsHovered = false;
  document.body.classList.remove("controls-visible");
  document.body.classList.add("cursor-idle", "keyboard-navigation");
}
function showControls() {
  document.body.classList.remove("keyboard-navigation");
  if (!currentSlide()) return;
  document.body.classList.add("controls-visible");
  document.body.classList.remove("cursor-idle");
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => {
    if (controlsHovered || $("presentation-controls").querySelector(":focus-visible")) return;
    document.body.classList.remove("controls-visible");
    document.body.classList.add("cursor-idle");
  }, 1800);
}
document.addEventListener("pointermove", showControls, { passive: true });
document.addEventListener("pointerdown", () => {
  showControls();
}, { passive: true });
$("presentation-controls").addEventListener("pointerenter", () => { controlsHovered = true; showControls(); });
$("presentation-controls").addEventListener("pointerleave", () => { controlsHovered = false; showControls(); });
$("presentation-controls").addEventListener("focusin", showControls);
$("presentation-controls").addEventListener("focusout", () => {
  if (!document.body.classList.contains("keyboard-navigation")) showControls();
});
$("slide-image").addEventListener("load", fit);
document.addEventListener("keydown", event => {
  if (event.altKey || event.ctrlKey || event.metaKey || document.querySelector("dialog[open]") || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (event.code === "Space" && /BUTTON|A/.test(event.target.tagName)) return;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) hideControlsImmediately();
  if (["ArrowRight", "PageDown", " "].includes(event.key)) { event.preventDefault(); move(1); }
  if (["ArrowLeft", "PageUp"].includes(event.key)) { event.preventDefault(); move(-1); }
  if (event.key === "Home" && currentDeck()) { event.preventDefault(); go(deckIndex, 0); }
  if (event.key === "End" && currentDeck()) { event.preventDefault(); go(deckIndex, currentDeck().slides.length - 1); }
  if (event.key.toLowerCase() === "i" && !event.repeat) { event.preventDefault(); toggleImages(); }
  if (event.key.toLowerCase() === "f") { event.preventDefault(); toggleFullscreen(); }
});
let touchStart;
$("stage").addEventListener("touchstart", event => { touchStart = event.touches.length === 1 ? [event.touches[0].clientX, event.touches[0].clientY] : null; }, { passive: true });
$("stage").addEventListener("touchend", event => {
  if (!touchStart) return;
  const dx = event.changedTouches[0].clientX - touchStart[0];
  const dy = event.changedTouches[0].clientY - touchStart[1];
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) move(dx < 0 ? 1 : -1);
  touchStart = null;
}, { passive: true });
window.addEventListener("hashchange", () => { if (catalog.revision !== null) { readRoute(); render(); } });
new ResizeObserver(fit).observe($("stage"));
if (sourceMode === "local") showLocalStart();
else {
  $("folder-button").hidden = true;
  $("empty-folder").hidden = true;
  refresh();
}
setInterval(() => { if (sourceMode === "local" && localFiles.mode === "live") refresh(); }, 2000);
window.addEventListener("focus", refresh);
