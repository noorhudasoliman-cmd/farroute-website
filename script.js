// Footer year
document.getElementById("year").textContent = new Date().getFullYear();

// Live countdown to launch
const launchTarget = new Date("2026-08-19T00:00:00");
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

// Waitlist form (on waitlist.html) — no backend wired up yet.
// This only confirms locally; it does not send or store any answers anywhere.
// Replace with a real submission endpoint before launch.
const form = document.getElementById("waitlist-form");
const status = document.getElementById("form-status");

if (form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = document.getElementById("waitlist-email").value.trim();
    if (!email) return;
    status.textContent = "Saved locally for now, this form isn't wired to a real list yet.";
    form.reset();
  });
}
