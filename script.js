(function () {
  "use strict";

  /* ============================================================
     Seeded PRNG so the contribution graph is stable across reloads
     ============================================================ */
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /**
   * Build one year of deterministic contribution data ending "today"
   * (or ending Dec 31 for a past year), following the pattern described
   * in the brief: steady mid activity → dip in early July 2026 → strong
   * return late July 2026 onward.
   */
  function generateYearData(year, seedBase) {
    const rand = mulberry32(seedBase);
    const today = new Date(2026, 8, 5); // Sept 5, 2026 "current date"
    const start = new Date(year === 2026 ? year - 1 : year, 8, 1); // Sep 1 of prior year (GitHub-style rolling window) for 2026; Jan 1 for 2025
    const realStart = year === 2026 ? new Date(2025, 8, 1) : new Date(2025, 0, 1);
    const realEnd = year === 2026 ? today : new Date(2025, 11, 31);

    const days = [];
    const cursor = new Date(realStart);
    while (cursor <= realEnd) {
      const d = new Date(cursor);
      let level, count;

      if (year === 2026) {
        const dipStart = new Date(2026, 6, 1);   // Jul 1 2026
        const dipEnd = new Date(2026, 6, 14);    // Jul 14 2026
        const recoveryStart = new Date(2026, 6, 20); // Jul 20 2026

        if (d >= dipStart && d <= dipEnd) {
          // Early July dip: mostly level 0-1
          const r = rand();
          level = r < 0.65 ? 0 : 1;
        } else if (d >= recoveryStart) {
          // Late July - current: strong return, frequent 2-3-4
          const r = rand();
          if (r < 0.12) level = 1;
          else if (r < 0.4) level = 2;
          else if (r < 0.75) level = 3;
          else level = 4;
        } else if (d > dipEnd && d < recoveryStart) {
          // transition week, gentle ramp
          const r = rand();
          level = r < 0.4 ? 1 : r < 0.75 ? 2 : 3;
        } else {
          // Sep 2025 - Jun 2026: consistent medium-high, occasional level 4
          const r = rand();
          if (r < 0.08) level = 0;
          else if (r < 0.35) level = 1;
          else if (r < 0.65) level = 2;
          else if (r < 0.9) level = 3;
          else level = 4;
        }
      } else {
        // 2025 full year: general steady moderate activity
        const r = rand();
        if (r < 0.12) level = 0;
        else if (r < 0.42) level = 1;
        else if (r < 0.72) level = 2;
        else if (r < 0.92) level = 3;
        else level = 4;
      }

      const countRanges = [[0, 0], [1, 2], [3, 5], [6, 9], [10, 15]];
      const [min, max] = countRanges[level];
      count = min === 0 && max === 0 ? 0 : min + Math.floor(rand() * (max - min + 1));

      days.push({ date: new Date(d), level, count });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  function formatDate(d) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function buildContributionGraph(year) {
    const grid = document.getElementById("contrib-grid");
    const monthsRow = document.getElementById("contrib-months");
    if (!grid || !monthsRow) return;

    grid.innerHTML = "";
    monthsRow.innerHTML = "";

    const seedBase = year === 2026 ? 20260905 : 20250101;
    const days = generateYearData(year, seedBase);

    // Pad the front so the grid starts on a Sunday (column-major weeks)
    const firstDay = days[0].date.getDay(); // 0 = Sunday
    const padded = [];
    for (let i = 0; i < firstDay; i++) padded.push(null);
    padded.push(...days);

    const totalCols = Math.ceil(padded.length / 7);
    grid.style.gridTemplateColumns = `repeat(${totalCols}, 11px)`;

    let totalContribs = 0;
    let lastMonthLabelled = -1;

    // Build column by column (so DOM order matches CSS grid-auto-flow: column)
    for (let col = 0; col < totalCols; col++) {
      for (let row = 0; row < 7; row++) {
        const idx = col * 7 + row;
        const entry = padded[idx];

        if (!entry) {
          const spacer = document.createElement("div");
          spacer.setAttribute("aria-hidden", "true");
          grid.appendChild(spacer);
          continue;
        }

        totalContribs += entry.count;

        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "contrib-cell";
        cell.dataset.level = String(entry.level);
        const label = `${entry.count} contribution${entry.count === 1 ? "" : "s"} on ${formatDate(entry.date)}`;
        cell.setAttribute("aria-label", label);

        const tip = document.createElement("span");
        tip.className = "cell-tooltip";
        tip.textContent = label;
        cell.appendChild(tip);

        cell.addEventListener("mouseenter", () => announceTooltip(label));
        cell.addEventListener("focus", () => announceTooltip(label));

        grid.appendChild(cell);

        // Month label: place once per new month, roughly aligned to its first column
        const month = entry.date.getMonth();
        if (month !== lastMonthLabelled && row === 0) {
          lastMonthLabelled = month;
          const label2 = document.createElement("span");
          label2.textContent = MONTH_NAMES[month];
          label2.style.gridColumn = String(col + 1);
          monthsRow.appendChild(label2);
        }
      }
    }

    grid.setAttribute("aria-label", `Contribution activity calendar for ${year}, approximately ${totalContribs} total contributions`);
  }

  function announceTooltip(text) {
    const live = document.getElementById("contrib-tooltip-live");
    if (live) live.textContent = text;
  }

  function initYearSelector() {
    const buttons = document.querySelectorAll(".year-btn");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        buildContributionGraph(Number(btn.dataset.year));
      });
    });
  }

  /* ============================================================
     Active section highlighting via IntersectionObserver
     ============================================================ */
  function initActiveNav() {
    const sections = document.querySelectorAll("main .section, main #overview");
    const navLinks = document.querySelectorAll(".main-nav .nav-link, .tab-link");

    if (!("IntersectionObserver" in window) || sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            navLinks.forEach((link) => {
              const matches = link.dataset.section === id || link.getAttribute("href") === `#${id}`;
              link.classList.toggle("active", matches);
            });
          }
        });
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0 }
    );

    sections.forEach((s) => observer.observe(s));
  }

  /* ============================================================
     Mobile drawer
     ============================================================ */
  function initDrawer() {
    const hamburger = document.getElementById("hamburger-btn");
    const drawer = document.getElementById("mobile-drawer");
    const backdrop = document.getElementById("drawer-backdrop");
    const closeBtn = document.getElementById("drawer-close-btn");
    if (!hamburger || !drawer || !backdrop || !closeBtn) return;

    let lastFocused = null;

    function openDrawer() {
      lastFocused = document.activeElement;
      drawer.classList.add("open");
      backdrop.hidden = false;
      requestAnimationFrame(() => backdrop.classList.add("show"));
      drawer.setAttribute("aria-hidden", "false");
      hamburger.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      closeBtn.focus();
      document.addEventListener("keydown", onKeydown);
    }

    function closeDrawer() {
      drawer.classList.remove("open");
      backdrop.classList.remove("show");
      drawer.setAttribute("aria-hidden", "true");
      hamburger.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeydown);
      setTimeout(() => { backdrop.hidden = true; }, 250);
      if (lastFocused) lastFocused.focus();
    }

    function onKeydown(e) {
      if (e.key === "Escape") {
        closeDrawer();
        return;
      }
      if (e.key === "Tab") {
        const focusable = drawer.querySelectorAll('a, button, [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    hamburger.addEventListener("click", openDrawer);
    closeBtn.addEventListener("click", closeDrawer);
    backdrop.addEventListener("click", closeDrawer);
    drawer.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeDrawer));
  }

  /* ============================================================
     Toast + copy-to-clipboard style feedback for CV button
     ============================================================ */
  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function initCvButtons() {
    ["download-cv-btn", "download-cv-btn-2"].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        showToast("CV download will be available soon — please reach out via email in the meantime.");
      });
    });
  }

  /* ============================================================
     Init
     ============================================================ */
  document.addEventListener("DOMContentLoaded", () => {
    buildContributionGraph(2026);
    initYearSelector();
    initActiveNav();
    initDrawer();
    initCvButtons();
  });
})();
