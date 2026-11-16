const KEEP_UPPER = new Set(["LLC", "LP", "LLP", "II", "III", "IV", "L.P.", "N.A.", "USA", "US"]);

/** "SMITH JOHN" -> "Smith John" ; laisse intacts les noms déjà en casse mixte. */
function tidyCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.split(/(\s+)/).map((w) => (KEEP_UPPER.has(w.replace(/,$/, "")) ? w : w.toLowerCase().replace(/(^|[-'.(])([a-z])/g, (_, a, b) => a + b.toUpperCase()))).join("");
}

/** "Musk Elon" (ordre SEC : nom prénom) -> "Elon Musk". Laisse dans l'ordre les noms à plus de deux mots et les sociétés. */
export function displayNameOf(secName: string): string {
  const name = tidyCase(secName.trim());
  const parts = name.split(/\s+/);
  const isCompany = /,|\b(llc|lp|inc|corp|fund|trust|capital|partners|advisors|holdings|management)\b/i.test(name);
  return parts.length === 2 && !isCompany ? `${parts[1]} ${parts[0]}` : name;
}
