/**
 * One-time fix: replace the problematic long string in analyze-chat route
 * that causes "Parsing ecmascript source code failed" (Unicode quotes in string).
 * Run from project root: node scripts/fix-analyze-route.js
 */

const fs = require("fs");
const path = require("path");

const routePath = path.join(__dirname, "..", "app", "api", "analyze-chat", "route.ts");
let content = fs.readFileSync(routePath, "utf8");

const oldPattern =
  /\s+parts\.push\(\s*\n\s*"[\s\S]*?Kontext für nextMessageSuggestions[\s\S]*?niemals 3 oder weniger\.[\s\S]*?\n\s*\);/;

const newBlock = [
  "",
  "  const kontext =",
  '    "\\nKontext für nextMessageSuggestions: Prüfe, wer die letzte Nachricht im Verlauf geschrieben hat. " +',
  "    \"Wenn der Kontakt (nicht 'Ich') zuletzt geschrieben hat: formuliere genau \" +",
  "    String(suggestionsCount) +",
  '    " Antwortvorschläge, die auf seine Nachricht eingehen. " +',
  "    \"Wenn 'Ich' (der Nutzer) zuletzt geschrieben hat: formuliere genau \" +",
  "    String(suggestionsCount) +",
  '    " kurze Follow-up-Vorschläge (freundlicher Nachfasser, nicht aufdringlich). " +',
  '    "Das Array nextMessageSuggestions muss immer genau " +',
  "    String(suggestionsCount) +",
  '    " Einträge haben.";',
  "  parts.push(kontext);",
].join("\n");

if (oldPattern.test(content)) {
  content = content.replace(oldPattern, "\n" + newBlock);
  fs.writeFileSync(routePath, content);
  console.log("Fixed: replaced problematic Kontext string in analyze-chat route.");
} else {
  const hasKontext = content.includes("Kontext für nextMessageSuggestions");
  const hasKontextVar = content.includes("const kontext =");
  if (hasKontextVar && hasKontext) {
    console.log("OK: file already uses safe kontext variable.");
  } else if (content.includes("niemals 3 oder weniger")) {
    console.log("Pattern not matched (encoding?). Replacing by line number.");
    const lines = content.split("\n");
    const idx = lines.findIndex((l) => l.includes("niemals 3 oder weniger"));
    if (idx >= 0) {
      const start = lines.slice(0, idx).findLastIndex((l) => l.trim().startsWith("parts.push("));
      if (start >= 0) {
        const before = lines.slice(0, start);
        const after = lines.slice(idx + 1).join("\n").replace(/^\s*\);\s*\n?/, "");
        const replacement = newBlock;
        content = before.join("\n") + "\n" + replacement + "\n" + after;
        fs.writeFileSync(routePath, content);
        console.log("Fixed: replaced by line-based search.");
      }
    }
  } else {
    console.log("No matching pattern found. File may already be fixed.");
  }
}
