// Footer year
document.getElementById("year").textContent = new Date().getFullYear();

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

// Waitlist form — no backend wired up yet.
// This only confirms locally; it does not send or store the email anywhere.
// Replace with a real submission endpoint before launch.
const form = document.getElementById("waitlist-form");
const status = document.getElementById("form-status");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = document.getElementById("waitlist-email").value.trim();
  if (!email) return;
  status.textContent = "Saved locally for now — this form isn't wired to a real list yet.";
  form.reset();
});
