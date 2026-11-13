// The main feature works correctly: notes are saved and survive a refresh.
function loadNotes() {
  try {
    return JSON.parse(localStorage.getItem("notenest-notes") || "[]");
  } catch (e) {
    return [];
  }
}

function renderNotes() {
  const list = document.getElementById("note-list");
  list.textContent = "";
  loadNotes().forEach(function (note) {
    const item = document.createElement("li");
    item.textContent = note;
    list.appendChild(item);
  });
}

document.getElementById("note-form").addEventListener("submit", function (event) {
  event.preventDefault();
  const input = document.getElementById("note-text");
  const text = input.value.trim();
  if (!text) return;
  const notes = loadNotes();
  notes.push(text);
  localStorage.setItem("notenest-notes", JSON.stringify(notes));
  input.value = "";
  renderNotes();
});

renderNotes();
