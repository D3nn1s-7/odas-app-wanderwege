let configData = {}; // Globale Variable für die Konfigurationsdaten

document.addEventListener("DOMContentLoaded", async () => {
  const configUrl = getConfigUrl();
  try {
    configData = await fetchConfig(configUrl); // Zuweisung zu globaler Variable
    addToHead();
    updatePageContent();
    // Überprüfe, ob ein Custom CSS Code oder Custom Branding CSS File in der Config vorhanden ist
    if (
      configData.brandingCSSFile &&
      configData.brandingCSSFile.trim().length > 0
    ) {
      const linkElem = document.createElement("link");
      linkElem.rel = "stylesheet";
      linkElem.href = configData.brandingCSSFile;
      document.head.appendChild(linkElem);
      console.log("Custom Branding CSS wurde angewendet.");
    } else if (
      configData.brandingCSS &&
      configData.brandingCSS.trim().length > 0
    ) {
      const customStyle = document.createElement("style");
      customStyle.innerHTML = configData.brandingCSS;
      document.head.appendChild(customStyle);
      console.log("Custom Branding CSS wurde angewendet.");
    } else {
      console.log("Kein Custom Branding CSS in der Config gefunden.");
    }
    window.addEventListener("hashchange", () => {
      handleRouting().catch(renderRuntimeError);
    });
    setupSamePageLinks();

    const initialPage = getPageFromHash();
    if (window.location.hash !== `#${initialPage}`) {
      window.location.hash = `#${initialPage}`;
    } else {
      await handleRouting();
    }
  } catch (err) {
    console.error("Fehler:", err);
    renderRuntimeError(err);
  }
  setupBurgerMenu();
});

function getConfigUrl() {
  const url = new URL(window.location.href);

  url.search = "";
  url.hash = "";

  let pathname = url.pathname;
  if (!pathname.endsWith("/")) {
    const lastSlashIndex = pathname.lastIndexOf("/");
    const lastSegment = pathname.substring(lastSlashIndex + 1);
    if (lastSegment.includes(".")) {
      pathname = pathname.substring(0, lastSlashIndex + 1);
    } else {
      pathname += "/";
    }
  }

  let configUrl = url.origin + pathname + "config";

  if (["127.0.0.1", "localhost"].includes(url.hostname)) {
    configUrl = "../odas-config/config.json";
  }
  return configUrl;
}

function flattenJson(jsonObj) {
  const result = {};
  for (const key in jsonObj) {
    if (!jsonObj.hasOwnProperty(key)) continue;
    const value = jsonObj[key];
    // wenn ein Value aus einem Array of Strings besteht...
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      // ...verbinde die Strings zu einem einzigen String
      result[key] = normalizeMultilineValue(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function normalizeMultilineValue(value) {
  if (!Array.isArray(value)) return value;
  return value.filter((item) => item !== "_multiline_").join("\n");
}

async function fetchConfig(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Konfiguration konnte nicht geladen werden (HTTP ${response.status}).`,
    );
  }
  return flattenJson(await response.json());
}

function escapeHtmlForBase(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderRuntimeError(error) {
  const mainContent = document.getElementById("main-content");
  if (!mainContent) return;

  const details = escapeHtmlForBase(
    error?.message || error || "Unbekannter Fehler",
  );
  mainContent.innerHTML = `
    <div class="alert alert-danger my-4" role="alert">
      <h2 class="h4 alert-heading">Fehler beim Laden der App</h2>
      <p>Die Konfiguration oder der angeforderte Inhalt konnte nicht geladen werden.</p>
      <hr>
      <p class="mb-0">Details: ${details}</p>
    </div>
  `;
}

function updatePageContent() {
  const {
    titel = "",
    seitentitel = "",
    icon = "logo.png",
    fusszeile = "© 2026 ODAS App. Alle Rechte vorbehalten.",
  } = configData;

  const elementMappings = {
    "title-text": titel,
    "tab-title": seitentitel,
    "logo-icon": icon,
    "footer-text": fusszeile,
  };

  Object.entries(elementMappings).forEach(([id, content]) => {
    const element = document.getElementById(id);
    if (!element) return; // Existenz-Check
    if (id === "logo-icon") {
      element.src = content;
    } else if (id === "footer-text") {
      element.innerHTML = content;
    } else {
      element.textContent = content;
    }
  });
}

async function loadPage(page) {
  /*
   * Optionaler App-Hook. Wird vor dem Rendern der neuen Seite aufgerufen und erlaubt der
   * App, ihre Laufzeit-Ressourcen abzuraeumen: Karten entfernen, Intervalle stoppen,
   * Event-Listener loesen. In app/app.js als `function onPageLeave(page) {...}`
   * definierbar; fehlt die Funktion, passiert nichts.
   */
  if (typeof onPageLeave === "function") {
    onPageLeave(page);
  }

  /*
   * Optionaler App-Hook. Erlaubt der App, den Inhalt einer der Standardseiten
   * (siehe VALID_PAGES) durch eigenes Markup zu ersetzen, ohne loadPage() selbst
   * zu ueberschreiben. In app/app.js als `function renderPageOverride(page) {...}`
   * definierbar; liefert die Funktion undefined/null zurueck (oder fehlt sie),
   * greift der Standard-Content aus dem switch-Block unten.
   */
  let content;
  if (typeof renderPageOverride === "function") {
    content = renderPageOverride(page);
  }

  if (content === undefined || content === null) {
    switch (page) {
      case "startseite":
        content = await app(configData, document.getElementById("main-content"));
        break;
      case "kontakt":
        content = createPageContent("Kontakt", configData.kontakt);
        break;
      case "impressum":
        content = createPageContent("Impressum", configData.impressum);
        break;
      case "datenschutz":
        content = createPageContent("Datenschutz", configData.datenschutz);
        break;
      case "beschreibung":
        content = createPageContent("Über diese App", configData.beschreibung);
        break;
      default:
        content = createPageContent("Fehler", "Seite nicht gefunden.");
    }
  }
  if (content) {
    document.getElementById("main-content").innerHTML = content;
  }
}

function createPageContent(title, content = "Informationen nicht verfügbar.") {
  const pageContent = Array.isArray(content)
    ? normalizeMultilineValue(content)
    : content;
  return `<div class="col" id="secondarySites"><h2>${title}</h2><div>${pageContent}</div></div>`;
}

function setupBurgerMenu() {
  document.querySelectorAll(".navbar-nav .nav-link").forEach((link) => {
    const href = link.getAttribute("href");
    const pageName =
      link.getAttribute("data-page") ||
      (href ? href.replace("#", "").trim() : "");
    if (pageName) {
      link.addEventListener("click", () => {
        // Offcanvas-Navigation (Standardfall des Templates)
        const offcanvasNavbar = document.getElementById("offcanvasNavbar");
        if (offcanvasNavbar && typeof bootstrap !== "undefined") {
          const offcanvas = bootstrap.Offcanvas.getInstance(offcanvasNavbar);
          if (offcanvas && offcanvasNavbar.classList.contains("show")) {
            offcanvas.hide();
          }
        }
        // Collapse-Navigation, sofern die App eine solche verwendet
        const collapseNavbar = document.getElementById("navbarNav");
        if (collapseNavbar && typeof bootstrap !== "undefined") {
          const collapse = bootstrap.Collapse.getInstance(collapseNavbar);
          if (collapse && collapseNavbar.classList.contains("show")) {
            collapse.hide();
          }
        }
      });
    }
  });
}

const VALID_PAGES = [
  "startseite",
  "beschreibung",
  "kontakt",
  "datenschutz",
  "impressum",
];

function getPageFromHash() {
  const hash = window.location.hash.replace("#", "").trim();
  if (VALID_PAGES.includes(hash)) {
    return hash;
  }
  return "startseite";
}

/*
 * Ein Klick auf einen Hash-Link, der bereits die aktive Seite bezeichnet, aendert den
 * Hash nicht und loest deshalb kein "hashchange" aus. Ohne diesen Handler bliebe zum
 * Beispiel das Logo oben links wirkungslos, sobald die App innerhalb der Startseite in
 * eine Unteransicht gewechselt ist (Formular, Detailseite, Slideshow, Analyseergebnis).
 * Hier wird der Rerender deshalb selbst angestossen.
 */
function setupSamePageLinks() {
  document.addEventListener("click", (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const target = event.target;
    const link =
      target && typeof target.closest === "function"
        ? target.closest('a[href^="#"]')
        : null;
    if (!link) return;

    const page = (link.getAttribute("href") || "").replace("#", "").trim();
    if (!VALID_PAGES.includes(page)) return;
    if (getPageFromHash() !== page) return;

    event.preventDefault();
    handleRouting().catch(renderRuntimeError);
  });
}

function updateActiveNavLink(page) {
  document.querySelectorAll(".navbar-nav .nav-link").forEach((link) => {
    const href = link.getAttribute("href");
    const pageName =
      link.getAttribute("data-page") ||
      (href ? href.replace("#", "").trim() : "");
    if (pageName === page) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}

async function handleRouting() {
  const page = getPageFromHash();
  if (window.location.hash !== `#${page}`) {
    window.location.hash = `#${page}`;
    return;
  }
  await loadPage(page);
  updateActiveNavLink(page);
}
