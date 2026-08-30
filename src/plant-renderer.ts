import { setIcon } from "obsidian";
import type { PlantRenderer, PlantStage, SeedRecord } from "./types";

const STAGE_LABELS: Record<PlantStage, string> = {
  seed: "Seed",
  sprout: "Sprout",
  seedling: "Seedling",
  "young-tree": "Young tree",
  "mature-tree": "Mature tree"
};

export class SvgPlantRenderer implements PlantRenderer {
  private roots: HTMLElement[] = [];

  render(seed: SeedRecord, container: HTMLElement): void {
    const root = container.createDiv({ cls: `knowledge-forests-plant stage-${seed.stage}` });
    root.setAttribute("aria-label", `${seed.name}: ${STAGE_LABELS[seed.stage]}, ${seed.score} points`);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("role", "img");
    svg.classList.add("knowledge-forests-plant-svg");
    svg.append(...plantShapes(seed.stage));
    root.appendChild(svg);
    const meta = root.createDiv({ cls: "knowledge-forests-plant-meta" });
    meta.createDiv({ cls: "knowledge-forests-plant-name", text: seed.name });
    const score = meta.createDiv({ cls: "knowledge-forests-plant-score" });
    const icon = score.createSpan();
    setIcon(icon, "sprout");
    score.createSpan({ text: `${seed.score.toFixed(seed.score % 1 === 0 ? 0 : 1)} pts` });
    this.roots.push(root);
  }

  destroy(): void {
    for (const root of this.roots) root.remove();
    this.roots = [];
  }
}

function svgElement(name: string, attributes: Record<string, string>): SVGElement {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function plantShapes(stage: PlantStage): SVGElement[] {
  const ground = svgElement("ellipse", { cx: "60", cy: "105", rx: "35", ry: "7", class: "plant-ground" });
  if (stage === "seed") {
    return [ground, svgElement("ellipse", { cx: "60", cy: "91", rx: "13", ry: "9", class: "plant-seed", transform: "rotate(-18 60 91)" })];
  }

  const stem = svgElement("path", { d: stage === "sprout" ? "M60 98 C58 84 60 72 60 62" : "M60 100 C58 78 61 54 60 30", class: "plant-stem" });
  const shapes: SVGElement[] = [ground, stem];
  shapes.push(svgElement("path", { d: "M60 76 C45 69 39 58 42 51 C54 51 61 59 60 76", class: "plant-leaf" }));
  shapes.push(svgElement("path", { d: "M60 67 C70 54 82 51 88 56 C84 68 73 74 60 76", class: "plant-leaf plant-leaf-alt" }));
  if (stage === "sprout") return shapes;

  shapes.push(svgElement("path", { d: "M59 56 C48 49 45 39 49 33 C58 35 63 43 59 56", class: "plant-leaf" }));
  shapes.push(svgElement("path", { d: "M60 47 C69 36 78 34 84 40 C80 49 71 54 60 58", class: "plant-leaf plant-leaf-alt" }));
  if (stage === "seedling") return shapes;

  shapes.push(svgElement("path", { d: "M60 102 L53 60 L55 29 L65 29 L67 60 L70 102 Z", class: "plant-trunk" }));
  shapes.push(svgElement("circle", { cx: "60", cy: "38", r: stage === "young-tree" ? "29" : "37", class: "plant-canopy" }));
  shapes.push(svgElement("circle", { cx: "38", cy: "49", r: stage === "young-tree" ? "18" : "25", class: "plant-canopy plant-canopy-alt" }));
  shapes.push(svgElement("circle", { cx: "82", cy: "50", r: stage === "young-tree" ? "19" : "27", class: "plant-canopy" }));
  if (stage === "mature-tree") {
    shapes.push(svgElement("circle", { cx: "47", cy: "39", r: "4", class: "plant-fruit" }));
    shapes.push(svgElement("circle", { cx: "74", cy: "45", r: "4", class: "plant-fruit" }));
    shapes.push(svgElement("circle", { cx: "61", cy: "24", r: "4", class: "plant-fruit" }));
  }
  return shapes;
}
