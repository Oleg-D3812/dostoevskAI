function showModal(title, tag, body) {
  document.getElementById("modalTitle").textContent = title;
  var tagEl = document.getElementById("modalTag");
  tagEl.textContent = tag;
  tagEl.className = "pill " + (tag === "герой" ? "pill-hero" : (tag === "фрагмент" ? "pill-fragment" : "pill-edge"));
  document.getElementById("modalBody").textContent = body;
  document.getElementById("modalOverlay").style.display = "flex";
}

function hideModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById("modalOverlay").style.display = "none";
}

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") hideModal();
});
