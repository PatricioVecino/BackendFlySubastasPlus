// Orden de categorías: cada nivel puede entrar a su nivel o inferior.
const ORDER = ["comun", "especial", "plata", "oro", "platino"];

function rank(cat) {
  const i = ORDER.indexOf(String(cat || "").toLowerCase());
  return i === -1 ? 0 : i;
}

function puedeEntrarPorCategoria(usuarioCat, subastaCat) {
  return rank(usuarioCat) >= rank(subastaCat);
}

function pujaSinMaximo(usuarioCat) {
  const r = rank(usuarioCat);
  return r >= rank("oro");
}

module.exports = { ORDER, rank, puedeEntrarPorCategoria, pujaSinMaximo };
