// Footer year
document.getElementById("year").textContent = new Date().getFullYear();

// Live countdown to launch. The same instant the main page counts down to:
// noon in New York on December 15, 2026, written in UTC so that every country
// reaches it at the same moment. No page carries the clock elements any more,
// so this ticks for nobody, but a stale date here is a trap for whoever adds
// them back.
const launchTarget = new Date("2026-12-15T17:00:00Z");
const cdDays = document.getElementById("cd-days");
const cdHours = document.getElementById("cd-hours");
const cdMins = document.getElementById("cd-mins");
const cdSecs = document.getElementById("cd-secs");

function pad(n) {
  return String(n).padStart(2, "0");
}

let countdownInterval = null;

function tickCountdown() {
  if (!cdDays) return;
  const diff = launchTarget - new Date();
  if (diff <= 0) {
    cdDays.textContent = "00";
    cdHours.textContent = "00";
    cdMins.textContent = "00";
    cdSecs.textContent = "00";
    if (countdownInterval) clearInterval(countdownInterval);
    return;
  }
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  cdDays.textContent = pad(days);
  cdHours.textContent = pad(hours);
  cdMins.textContent = pad(mins);
  cdSecs.textContent = pad(secs);
}

tickCountdown();
countdownInterval = setInterval(tickCountdown, 1000);

// Hero photo carousel: rotates background photo + location tag together.
// Respects prefers-reduced-motion by leaving the first slide static.
const heroSlides = document.querySelectorAll(".hero-photo-slide");
const heroLocationText = document.getElementById("hero-location-text");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (heroSlides.length > 1 && !prefersReducedMotion) {
  let heroIndex = 0;
  setInterval(() => {
    heroSlides[heroIndex].classList.remove("is-active");
    heroIndex = (heroIndex + 1) % heroSlides.length;
    heroSlides[heroIndex].classList.add("is-active");
    if (heroLocationText) {
      heroLocationText.style.opacity = "0";
      setTimeout(() => {
        heroLocationText.textContent = heroSlides[heroIndex].dataset.location;
        heroLocationText.style.opacity = "1";
      }, 400);
    }
  }, 5000);
}

// Scroll reveal (skipped entirely for reduced-motion users via CSS fallback)
const revealTargets = document.querySelectorAll("[data-reveal]");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  revealTargets.forEach((el) => io.observe(el));
} else {
  revealTargets.forEach((el) => el.classList.add("is-visible"));
}

// Waitlist form (on waitlist.html): submits to Netlify Forms.
// Netlify only detects and provisions a form the first time it's present in a
// deployed build, so submissions won't appear in the dashboard until after
// this exact form has been live on a deploy at least once.
const form = document.getElementById("waitlist-form");
const status = document.getElementById("form-status");

function encodeFormData(data) {
  return Object.keys(data)
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(data[key]))
    .join("&");
}

if (form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {};
    formData.forEach((value, key) => { payload[key] = value; });

    status.textContent = "Submitting...";

    fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: encodeFormData(payload),
    })
      .then((response) => {
        if (!response.ok) throw new Error("Form submission failed: " + response.status);
        status.textContent = "You're on the list. We'll email you when it's time.";
        form.reset();
      })
      .catch(() => {
        status.textContent = "Something went wrong submitting that. Try again in a moment.";
      });
  });
}

// Every country picker on the site is filled from the one list in
// countries.js. A page that writes its own list of places ends up offering
// countries no parcel can be sent to.
(function () {
  var list = window.FR_COUNTRIES || [];
  if (!list.length) return;
  document.querySelectorAll('[data-fr-countries]').forEach(function (sel) {
    var frag = document.createDocumentFragment();
    list.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.n; o.textContent = c.n;
      frag.appendChild(o);
    });
    sel.appendChild(frag);
  });
})();
